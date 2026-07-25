import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { z } from 'zod';
import { toast } from 'sonner';
import api from '../../lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import DynamicTicketField, { type MergedTemplateField } from './DynamicTicketField';

interface RequestType {
  id: string;
  name: string;
  description?: string | null;
  isActive: boolean;
}

interface TemplateData {
  id: string;
  requestTypeId: string;
  name: string;
  descriptionGuidance?: string | null;
  fields: MergedTemplateField[];
}

interface PicklistOption { value: string; label: string; parentValue?: string | null; }
interface UserOption { id: string; username: string; }

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
    case 'DATE':
    case 'DATETIME':
    case 'SELECT':
      return required ? z.string().min(1, `${f.label} is required`) : z.string().optional();
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
    case 'MULTI_SELECT_USER': return [] as string[];
    default: return '';
  }
}

export default function CreateTicketPage() {
  const navigate = useNavigate();
  const [selectedRequestTypeId, setSelectedRequestTypeId] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, any>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [attachmentFiles, setAttachmentFiles] = useState<File[]>([]);

  const { data: requestTypes = [] } = useQuery<RequestType[]>({
    queryKey: ['request-types'],
    queryFn: async () => (await api.get('/api/request-types')).data,
  });
  const activeRequestTypes = requestTypes.filter((rt) => rt.isActive);

  useEffect(() => {
    if (selectedRequestTypeId || activeRequestTypes.length === 0) return;
    setSelectedRequestTypeId(activeRequestTypes[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRequestTypes.length]);

  const { data: template } = useQuery<TemplateData>({
    queryKey: ['templates', 'by-request-type', selectedRequestTypeId],
    queryFn: async () => (await api.get(`/api/templates/by-request-type/${selectedRequestTypeId}`)).data,
    enabled: !!selectedRequestTypeId,
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
    mutationFn: async () => {
      const payload: Record<string, any> = { requestTypeId: selectedRequestTypeId };
      for (const f of visibleFields) {
        if (f.dataType === 'SYSTEM' || f.dataType === 'FILE') continue;
        const v = values[f.fieldKey];
        if (f.fieldKey === 'technicians') {
          payload.technicianUserIds = v;
        } else if (f.fieldKey === 'notifyEmails') {
          payload.notifyEmails = (v || '').split(',').map((s: string) => s.trim()).filter(Boolean);
        } else {
          payload[f.fieldKey] = v === '' ? undefined : v;
        }
      }

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
    onSuccess: (ticket) => {
      toast.success(`Ticket ${ticket.ticketNumber} created`);
      navigate('/dashboard');
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error creating ticket'),
  });

  const handleSubmit = () => {
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
    createMutation.mutate();
  };

  const systemDisplayValue = (f: MergedTemplateField): string => {
    switch (f.fieldKey) {
      case 'templateName': return template?.name ?? '';
      case 'requestType': return activeRequestTypes.find((rt) => rt.id === selectedRequestTypeId)?.name ?? '';
      case 'ticketStatus': return picklistData.ticketStatus?.[0]?.label ?? 'New';
      case 'createdDate': return 'Set automatically on submission';
      case 'closedDate': return '—';
      default: return '';
    }
  };

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-foreground">New Ticket</h1>
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-muted-foreground">Template</label>
          <Select
            value={selectedRequestTypeId ?? undefined}
            onValueChange={setSelectedRequestTypeId}
            disabled={activeRequestTypes.length === 0}
          >
            <SelectTrigger className="w-56"><SelectValue placeholder="Select a template..." /></SelectTrigger>
            <SelectContent>
              {activeRequestTypes.map((rt) => (
                <SelectItem key={rt.id} value={rt.id}>{rt.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {activeRequestTypes.length === 0 ? (
        <p className="text-muted-foreground">No request types configured yet.</p>
      ) : !template ? (
        <p className="text-muted-foreground">Loading template...</p>
      ) : (
        <>
          {GROUP_ORDER.map((group) => {
            const groupFields = visibleFields.filter((f) => f.group === group);
            if (groupFields.length === 0) return null;
            return (
              <Card key={group} className="mb-6">
                <CardHeader>
                  <CardTitle>{GROUP_LABELS[group]}</CardTitle>
                  {group === 'ticket_detail' && <CardDescription>{template.descriptionGuidance}</CardDescription>}
                </CardHeader>
                <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {groupFields.map((f) => (
                    <div key={f.fieldKey} className={f.dataType === 'TEXTAREA' ? 'sm:col-span-2' : undefined}>
                      <DynamicTicketField
                        field={f}
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
                </CardContent>
              </Card>
            );
          })}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => navigate('/tickets')}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={createMutation.isPending}>
              {createMutation.isPending ? 'Submitting...' : 'Submit Ticket'}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
