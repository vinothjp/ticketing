import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { z } from 'zod';
import { toast } from 'sonner';
import api from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import DynamicTicketField, { type MergedTemplateField } from './DynamicTicketField';

interface TemplateSummary {
  id: string;
  name: string;
  category?: string | null;
  isActive: boolean;
}

interface TemplateData {
  id: string;
  name: string;
  descriptionGuidance?: string | null;
  fields: MergedTemplateField[];
}

interface PicklistOption { value: string; label: string; parentValue?: string | null; }
interface UserOption { id: string; username: string; }
interface CompanyOption { id: string; name: string; }
interface SlaPolicy { id: string; priority: string; resolutionHours: number; responseHours?: number | null; isActive: boolean; }

const GROUP_LABELS: Record<MergedTemplateField['group'], string> = {
  ticket_info: 'Ticket Info',
  ticket_detail: 'Ticket Detail',
  root_cause: 'Root Cause Analysis',
};
const GROUP_ORDER: MergedTemplateField['group'][] = ['ticket_info', 'ticket_detail', 'root_cause'];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function isValidEmailList(v: string) {
  return v.split(',').map((s) => s.trim()).filter(Boolean).every((e) => EMAIL_RE.test(e));
}

function fieldSchema(f: MergedTemplateField) {
  const required = f.requirement === 'MANDATORY';
  switch (f.dataType) {
    case 'TEXT':
    case 'TEXTAREA':
    case 'PHONE':
    case 'DATE':
    case 'DATETIME':
    case 'SELECT':
    case 'RADIO':
      return required ? z.string().min(1, `${f.label} is required`) : z.string().optional();
    case 'NUMBER':
      return required
        ? z.string().min(1, `${f.label} is required`).refine((v) => !isNaN(Number(v)), 'Enter a number')
        : z.string().optional().refine((v) => !v || !isNaN(Number(v)), 'Enter a number');
    case 'MULTI_SELECT':
    case 'MULTI_SELECT_USER':
      return required
        ? z.array(z.string()).min(1, `${f.label} is required`)
        : z.array(z.string()).optional();
    case 'BOOLEAN':
      return z.boolean().optional();
    case 'EMAIL_LIST':
      return required
        ? z.string().min(1, `${f.label} is required`).refine(isValidEmailList, 'Enter valid, comma-separated emails')
        : z.string().optional().refine((v) => !v || isValidEmailList(v), 'Enter valid, comma-separated emails');
    default:
      return z.any().optional();
  }
}

function defaultValueFor(f: MergedTemplateField, descriptionGuidance?: string | null) {
  if (f.fieldKey === 'description' && descriptionGuidance) return descriptionGuidance;
  switch (f.dataType) {
    case 'BOOLEAN': return false;
    case 'MULTI_SELECT':
    case 'MULTI_SELECT_USER': return [] as string[];
    default: return '';
  }
}

export default function CreateTicketPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isCustomer = !!user?.roles.includes('Customer') && !user?.roles.includes('Admin');
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>('');
  const [values, setValues] = useState<Record<string, any>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [attachmentFiles, setAttachmentFiles] = useState<File[]>([]);

  // Staff can tag the ticket with a customer company (customers are auto-tagged server-side).
  const { data: companies = [] } = useQuery<CompanyOption[]>({
    queryKey: ['customer-companies'],
    queryFn: async () => (await api.get('/api/customer-companies')).data,
    enabled: !isCustomer,
  });

  const { data: templates = [] } = useQuery<TemplateSummary[]>({
    queryKey: ['templates'],
    queryFn: async () => (await api.get('/api/templates')).data,
  });
  const activeTemplates = templates.filter((t) => t.isActive);

  useEffect(() => {
    if (selectedTemplateId || activeTemplates.length === 0) return;
    setSelectedTemplateId(activeTemplates[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTemplates.length]);

  const { data: template } = useQuery<TemplateData>({
    queryKey: ['templates', selectedTemplateId],
    queryFn: async () => (await api.get(`/api/templates/${selectedTemplateId}`)).data,
    enabled: !!selectedTemplateId,
  });

  const visibleFields = useMemo(
    () => (template?.fields ?? []).filter((f) => f.visibility === 'VISIBLE').sort((a, b) => a.sortOrder - b.sortOrder),
    [template],
  );

  const picklistKeys = useMemo(
    () => Array.from(new Set(visibleFields.map((f) => f.picklistKey).filter((k): k is string => !!k))),
    [visibleFields],
  );
  const needsUsers = visibleFields.some((f) => f.dataType === 'MULTI_SELECT_USER');

  const { data: picklistData = {} } = useQuery<Record<string, PicklistOption[]>>({
    queryKey: ['picklist-options', 'bulk', picklistKeys],
    queryFn: async () => {
      const entries = await Promise.all(
        picklistKeys.map(async (key) => {
          const res = await api.get('/api/picklist-options', { params: { listKey: key } });
          return [key, (res.data as (PicklistOption & { isActive: boolean })[]).filter((o) => o.isActive)] as const;
        }),
      );
      return Object.fromEntries(entries);
    },
    enabled: picklistKeys.length > 0,
  });

  const { data: users = [] } = useQuery<UserOption[]>({
    queryKey: ['users'],
    queryFn: async () => (await api.get('/api/users')).data,
    enabled: needsUsers,
  });

  const { data: slaPolicies = [] } = useQuery<SlaPolicy[]>({
    queryKey: ['sla-policies'],
    queryFn: async () => (await api.get('/api/sla-policies')).data,
  });

  const resetForm = () => {
    const initial: Record<string, any> = {};
    for (const f of visibleFields) {
      initial[f.fieldKey] = defaultValueFor(f, template?.descriptionGuidance);
    }
    setValues(initial);
    setErrors({});
    setAttachmentFiles([]);
  };

  useEffect(() => {
    if (!template) return;
    const initial: Record<string, any> = {};
    for (const f of visibleFields) {
      initial[f.fieldKey] = defaultValueFor(f, template.descriptionGuidance);
    }
    setValues(initial);
    setErrors({});
    setAttachmentFiles([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template?.id]);

  const schema = useMemo(
    () => z.object(Object.fromEntries(
      visibleFields.filter((f) => f.dataType !== 'SYSTEM' && f.dataType !== 'FILE').map((f) => [f.fieldKey, fieldSchema(f)]),
    )),
    [visibleFields],
  );

  const createMutation = useMutation({
    mutationFn: async (_mode: 'submit' | 'saveAndNew') => {
      const payload: Record<string, any> = { templateId: selectedTemplateId };
      if (selectedCompanyId) payload.customerCompanyId = selectedCompanyId;
      const customFields: Record<string, any> = {};
      for (const f of visibleFields) {
        if (f.dataType === 'SYSTEM' || f.dataType === 'FILE') continue;
        const v = values[f.fieldKey];

        // Custom fields and JSON-backed catalog fields go into customFields.
        if (f.isCustom || f.storage === 'json') {
          if (v === '' || v === undefined || v === null || (Array.isArray(v) && v.length === 0)) continue;
          customFields[f.fieldKey] = f.dataType === 'NUMBER' ? Number(v) : v;
          continue;
        }

        if (f.fieldKey === 'technicians') {
          payload.technicianUserIds = v;
        } else if (f.fieldKey === 'notifyEmails') {
          payload.notifyEmails = (v || '').split(',').map((s: string) => s.trim()).filter(Boolean);
        } else {
          payload[f.fieldKey] = v === '' ? undefined : v;
        }
      }
      if (Object.keys(customFields).length) payload.customFields = customFields;

      const res = await api.post('/api/tickets', payload);
      const ticket = res.data;

      if (attachmentFiles.length) {
        const formData = new FormData();
        attachmentFiles.forEach((file) => formData.append('attachments', file));
        await api.post(`/api/tickets/${ticket.id}/attachments`, formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
      }

      return ticket;
    },
    onSuccess: (ticket, mode) => {
      toast.success(`Ticket ${ticket.ticketNumber} created`);
      if (mode === 'saveAndNew') resetForm();
      else navigate('/dashboard');
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error creating ticket'),
  });

  const handleSubmit = (mode: 'submit' | 'saveAndNew') => {
    const result = schema.safeParse(values);
    if (!result.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of result.error.issues) {
        const key = String(issue.path[0]);
        if (!fieldErrors[key]) fieldErrors[key] = issue.message;
      }
      setErrors(fieldErrors);
      toast.error('Please fix the highlighted fields');
      return;
    }
    setErrors({});
    createMutation.mutate(mode);
  };

  const slaText = (): string => {
    if (!values.priority) return 'Select a priority to see the SLA target.';
    const p = slaPolicies.find((s) => s.priority === values.priority && s.isActive !== false);
    if (!p) return 'No SLA policy set for this priority.';
    const due = new Date(Date.now() + p.resolutionHours * 3600 * 1000);
    return `Resolve within ${p.resolutionHours}h — due ${due.toLocaleString()}`;
  };

  const systemDisplayValue = (f: MergedTemplateField): string => {
    switch (f.fieldKey) {
      case 'templateName': return template?.name ?? '';
      case 'ticketStatus': return picklistData.ticketStatus?.[0]?.label ?? 'Open';
      case 'sla': return slaText();
      case 'createdDate': return 'Set automatically on submission';
      case 'closedDate': return '—';
      default: return '';
    }
  };

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-foreground">New Ticket</h1>
        <div className="flex flex-wrap items-center gap-2">
          {!isCustomer && companies.length > 0 && (
            <>
              <label className="text-sm font-medium text-muted-foreground">Customer</label>
              <Select value={selectedCompanyId || 'none'} onValueChange={(v) => setSelectedCompanyId(v === 'none' ? '' : v)}>
                <SelectTrigger className="w-48"><SelectValue placeholder="No company" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No company</SelectItem>
                  {companies.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </>
          )}
          <label className="text-sm font-medium text-muted-foreground">Template</label>
          <Select
            value={selectedTemplateId ?? undefined}
            onValueChange={setSelectedTemplateId}
            disabled={activeTemplates.length === 0}
          >
            <SelectTrigger className="w-56"><SelectValue placeholder="Select a template..." /></SelectTrigger>
            <SelectContent>
              {activeTemplates.map((t) => (
                <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {activeTemplates.length === 0 ? (
        <p className="text-muted-foreground">No templates configured yet.</p>
      ) : !template ? (
        <p className="text-muted-foreground">Loading template...</p>
      ) : (
        <>
          {GROUP_ORDER.map((group) => {
            const groupFields = visibleFields.filter((f) => f.group === group);
            if (groupFields.length === 0) return null;
            return (
              <section key={group} className="mb-8">
                <h2 className="text-base font-semibold text-foreground">{GROUP_LABELS[group]}</h2>
                {group === 'ticket_detail' && template.descriptionGuidance && (
                  <p className="mt-0.5 text-sm text-muted-foreground">{template.descriptionGuidance}</p>
                )}
                <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {groupFields.map((f) => (
                    <div key={f.fieldKey} className={f.dataType === 'TEXTAREA' ? 'sm:col-span-2' : undefined}>
                      <DynamicTicketField
                        field={f.fieldKey === 'sla' ? { ...f, label: 'Expected Resolution Time' } : f}
                        value={values[f.fieldKey]}
                        onChange={(v) => setValues((prev) => ({ ...prev, [f.fieldKey]: v }))}
                        error={errors[f.fieldKey]}
                        options={f.picklistKey === 'subCategory'
                          ? (picklistData.subCategory ?? []).filter((o) => o.parentValue === values.ticketCategory)
                          : (f.picklistKey ? picklistData[f.picklistKey] : undefined)}
                        users={f.dataType === 'MULTI_SELECT_USER' ? users : undefined}
                        systemDisplayValue={f.dataType === 'SYSTEM' ? systemDisplayValue(f) : undefined}
                        files={f.fieldKey === 'attachments' ? attachmentFiles : undefined}
                        onFilesChange={f.fieldKey === 'attachments' ? setAttachmentFiles : undefined}
                      />
                    </div>
                  ))}
                </div>
              </section>
            );
          })}

          <div className="flex justify-end gap-2 border-t pt-5">
            <Button variant="outline" onClick={() => navigate('/tickets')}>Cancel</Button>
            <Button variant="outline" onClick={() => handleSubmit('saveAndNew')} disabled={createMutation.isPending}>
              Save &amp; New
            </Button>
            <Button onClick={() => handleSubmit('submit')} disabled={createMutation.isPending}>
              {createMutation.isPending ? 'Submitting...' : 'Submit Ticket'}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
