import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { z } from 'zod';
import { toast } from 'sonner';
import api from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import DynamicTicketField, { type MergedTemplateField } from './DynamicTicketField';
import { FIELD_GROUP_LABELS, groupFieldRuns } from './ticketHelpers';
import { useDateFormat } from '@/lib/dateFormat';

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
type Track = 'TECHNICAL' | 'FUNCTIONAL';
interface SapProduct { id: string; name: string; code: string; autoAssign: boolean; modules: { id: string; name: string; tracks: Track[] }[]; }
interface SlaPolicy { id: string; priority: string; resolutionHours: number; responseHours?: number | null; isActive: boolean; }
// Read-only support-hours pool for the picked product (or the client's shared contract).
interface SupportHours {
  hasPool: boolean;
  scope?: 'PRODUCT' | 'CUSTOMER';
  coverage?: string | null;
  allocated: number | null;
  used: number;
  left: number | null;
}
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
  const { fmtDateTime } = useDateFormat();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // When launched from a project ("Create ticket"), link the new ticket back to it.
  const projectId = searchParams.get('projectId');
  const { user } = useAuth();
  const isCustomer = !!user?.roles.includes('Customer') && !user?.roles.includes('Admin');
  const isCustomerSide = !!user?.roles.includes('Customer') || !!user?.roles.includes('CustomerAdmin');
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>('');
  const [values, setValues] = useState<Record<string, any>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [attachmentFiles, setAttachmentFiles] = useState<File[]>([]);

  // Staff can tag the ticket with a customer company (customers are auto-tagged
  // server-side). Read from the my-company list, not `api/customer-companies` —
  // that one is Admin-only and an agent needs to pick a client here too.
  const { data: companies = [] } = useQuery<CompanyOption[]>({
    queryKey: ['ticket-clients'],
    queryFn: async () => (await api.get('/api/my-company/clients')).data,
    enabled: !isCustomerSide,   // staff-only route; a customer's client is implicit
  });

  // SAP routing: product/module the ticket is about + technical/functional. Drives
  // auto-assignment. The product list is scoped to one client — a customer's own
  // company, or the client staff tagged above. Staff who tag no client are raising
  // an internal ticket, and the API answers with the tenant's own catalogue.
  const { data: sapProducts = [], isFetching: productsFetching } = useQuery<SapProduct[]>({
    queryKey: ['ticket-products', isCustomerSide ? 'mine' : selectedCompanyId || 'internal'],
    queryFn: async () =>
      (await api.get('/api/my-company/products', {
        params: isCustomerSide ? undefined : { customerCompanyId: selectedCompanyId },
      })).data,
  });
  const [routing, setRouting] = useState<{ productId: string; moduleId: string; consultantType: string }>({ productId: '', moduleId: '', consultantType: '' });
  // Hours already spent against this product's support pool — visible to every
  // side (provider, agent, customer admin, customer contact) and read-only. Keyed
  // on the product alone, so it lands as soon as the product is picked and does
  // not wait on the module.
  const { data: supportHours } = useQuery<SupportHours>({
    queryKey: ['ticket-support-hours', isCustomerSide ? 'mine' : selectedCompanyId, routing.productId],
    queryFn: async () =>
      (await api.get('/api/my-company/product-support-hours', {
        params: { productId: routing.productId, ...(isCustomerSide ? {} : { customerCompanyId: selectedCompanyId }) },
      })).data,
    enabled: !!routing.productId && (isCustomerSide || !!selectedCompanyId),
  });
  const [productError, setProductError] = useState<string | null>(null);
  const selProduct = sapProducts.find((p) => p.id === routing.productId);
  const selModule = selProduct?.modules.find((m) => m.id === routing.moduleId);
  // A module with a single track needs no issue-type choice — auto-select it.
  const trackFor = (m?: { tracks: Track[] }) => (m && m.tracks.length === 1 ? m.tracks[0] : '');
  const chooseProduct = (pid: string) => {
    // Radix re-emits '' when the mounted options no longer contain the value; a
    // real pick is never empty, so ignore those.
    if (!pid) return;
    const p = sapProducts.find((x) => x.id === pid);
    const mod = p && p.modules.length === 1 ? p.modules[0] : undefined;
    setRouting({ productId: pid, moduleId: mod?.id ?? '', consultantType: trackFor(mod) });
    setProductError(null);
  };
  // The product list belongs to the client, so switching client invalidates the pick.
  const chooseCompany = (companyId: string) => {
    setSelectedCompanyId(companyId);
    setRouting({ productId: '', moduleId: '', consultantType: '' });
    setProductError(null);
  };
  const chooseModule = (mid: string) => {
    const m = selProduct?.modules.find((x) => x.id === mid);
    setRouting((r) => ({ ...r, moduleId: mid, consultantType: trackFor(m) }));
  };
  // Staff who leave the client empty are raising an INTERNAL ticket — the
  // tenant's own, with no customer contract behind it.
  const isInternalTicket = !isCustomerSide && !selectedCompanyId;
  const hasClient = isCustomerSide || !!selectedCompanyId || isInternalTicket;
  const productPlaceholder = !hasClient
    ? 'Select a client first'
    : productsFetching
      ? 'Loading products...'
      : sapProducts.length === 0
        ? isInternalTicket ? 'No active products' : 'No products for this client'
        : 'Select product';

  // The field reads what's left ("47.75 of 50 left"); the hint underneath carries
  // what's been spent, so both halves of the pool are legible at a glance.
  const hoursLabel = !supportHours
    ? 'Loading...'
    : supportHours.allocated == null
      ? 'No limit set'
      : `${supportHours.left} of ${supportHours.allocated} left`;
  const spentHint = !supportHours
    ? ''
    : supportHours.scope === 'CUSTOMER'
      ? `${supportHours.used} hours spent on the shared contract`
      : `${supportHours.used} hours spent`;

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

  // Sections follow the order the admin arranged in the Template Designer, not a fixed
  // Info -> Detail -> Root Cause sequence.
  const fieldRuns = useMemo(() => groupFieldRuns(visibleFields), [visibleFields]);

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
    enabled: needsUsers && !isCustomer, // staff list is not exposed to customers
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
      if (routing.productId) payload.productId = routing.productId;
      if (routing.moduleId) payload.moduleId = routing.moduleId;
      if (routing.consultantType) payload.consultantType = routing.consultantType;
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

      // Link the ticket to the originating project, if any.
      if (projectId) {
        await api.post(`/api/projects/${projectId}/tickets/${ticket.id}`);
      }

      return ticket;
    },
    onSuccess: (ticket, mode) => {
      toast.success(`Ticket ${ticket.ticketNumber} created${projectId ? ' and linked to the project' : ''}`);
      if (mode === 'saveAndNew') resetForm();
      else if (projectId) navigate(`/projects/${projectId}?tab=tickets`);
      else navigate('/dashboard');
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error creating ticket'),
  });

  const handleSubmit = (mode: 'submit' | 'saveAndNew') => {
    const result = schema.safeParse(values);
    const fieldErrors: Record<string, string> = {};
    if (!result.success) {
      for (const issue of result.error.issues) {
        const key = String(issue.path[0]);
        if (!fieldErrors[key]) fieldErrors[key] = issue.message;
      }
    }
    setErrors(fieldErrors);
    // Product is mandatory but lives outside the template-driven schema.
    const productMissing = !routing.productId;
    setProductError(productMissing ? 'Product is required' : null);
    if (productMissing || !result.success) {
      toast.error('Please fix the highlighted fields');
      return;
    }
    createMutation.mutate(mode);
  };

  const slaText = (): string => {
    if (!values.priority) return 'Select a priority to see the SLA target.';
    const p = slaPolicies.find((s) => s.priority === values.priority && s.isActive !== false);
    if (!p) return 'No SLA policy set for this priority.';
    const due = new Date(Date.now() + p.resolutionHours * 3600 * 1000);
    return `Resolve within ${p.resolutionHours}h — due ${fmtDateTime(due)}`;
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
          {!isCustomerSide && companies.length > 0 && (
            <>
              <label className="text-sm font-medium text-muted-foreground">Client</label>
              {/* No client picked = an internal ticket, raised against our own
                  catalogue and closed by staff rather than a client's sign-off. */}
              <Select value={selectedCompanyId || 'none'} onValueChange={(v) => chooseCompany(v === 'none' ? '' : v)}>
                <SelectTrigger className="w-48"><SelectValue placeholder="Internal ticket" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Internal ticket</SelectItem>
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
          <section className="mb-8">
            <h2 className="text-base font-semibold text-foreground">Which product is this about?</h2>
            {/* One row, or stacked — never a 2-up wrap, which would drop Support hours
                under Product instead of leaving it right of Module. */}
            <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-4">
              <div>
                <div className="mb-1 text-sm text-muted-foreground">Product <span className="text-destructive">*</span></div>
                <Select value={routing.productId || undefined} onValueChange={chooseProduct} disabled={!hasClient || sapProducts.length === 0}>
                  <SelectTrigger className="w-full" aria-invalid={!!productError}>
                    <SelectValue placeholder={productPlaceholder} />
                  </SelectTrigger>
                  <SelectContent>
                    {sapProducts.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                {productError && <p className="mt-1 text-xs text-destructive">{productError}</p>}
              </div>
              {/* Module: needed for products with more than one module (S/4HANA). */}
              {selProduct && selProduct.modules.length > 1 && (
                <div>
                  <div className="mb-1 text-sm text-muted-foreground">Module</div>
                  <Select value={routing.moduleId || undefined} onValueChange={chooseModule}>
                    <SelectTrigger className="w-full"><SelectValue placeholder="Select module" /></SelectTrigger>
                    <SelectContent>
                      {selProduct.modules.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {/* Type: only when the chosen module routes on more than one track. */}
              {selModule && selModule.tracks.length > 1 && (
                <div>
                  <div className="mb-1 text-sm text-muted-foreground">Issue type</div>
                  <Select value={routing.consultantType || undefined} onValueChange={(v) => setRouting((r) => ({ ...r, consultantType: v }))}>
                    <SelectTrigger className="w-full"><SelectValue placeholder="Technical / Functional" /></SelectTrigger>
                    <SelectContent>
                      {selModule.tracks.includes('FUNCTIONAL') && <SelectItem value="FUNCTIONAL">Functional</SelectItem>}
                      {selModule.tracks.includes('TECHNICAL') && <SelectItem value="TECHNICAL">Technical</SelectItem>}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {/* Support hours: appears with the product, but always LAST in the row.
                  Module and Issue type are each conditional (a single-module product
                  hides Module, a single-track module hides Issue type), so anchoring
                  it to the end is the only spot that never splits the routing selects. */}
              {/* An internal ticket draws on no customer contract, so there is no
                  pool to show. */}
              {routing.productId && !isInternalTicket && (
                <div>
                  <div className="mb-1 text-sm text-muted-foreground">Support hours</div>
                  <Input readOnly tabIndex={-1} value={hoursLabel} className="cursor-default" />
                  <p className="mt-1 text-xs text-muted-foreground">{spentHint}</p>
                </div>
              )}
            </div>
            {hasClient && !productsFetching && sapProducts.length === 0 && (
              <p className="mt-2 text-xs text-muted-foreground">
                {isCustomerSide
                  ? 'Your company has no active products yet — contact your provider.'
                  : isInternalTicket
                    ? 'No active products in your catalogue. Add one on the Products screen first.'
                    : 'This client has no active products assigned. Assign one on the client screen first.'}
              </p>
            )}
          </section>
          {fieldRuns.map((run, runIndex) => (
              <section key={`${run.group}-${runIndex}`} className="mb-8">
                <h2 className="text-base font-semibold text-foreground">{FIELD_GROUP_LABELS[run.group]}</h2>
                <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {run.fields.map((f) => (
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
                        hideHelperText
                      />
                    </div>
                  ))}
                </div>
              </section>
          ))}

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
