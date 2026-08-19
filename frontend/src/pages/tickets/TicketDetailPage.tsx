import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Paperclip, FolderKanban, X } from 'lucide-react';
import { toast } from 'sonner';
import api from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { assetUrl } from '@/lib/assetUrl';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { getPriorityMeta, formatCountdown, getApprovalMeta, type TicketTechnicianRow } from './ticketHelpers';
import type { MergedTemplateField } from './DynamicTicketField';
import HistoryTab from './detail/HistoryTab';
import ResolutionTab from './detail/ResolutionTab';
import TasksTab from './detail/TasksTab';
import WorklogTab from './detail/WorklogTab';
import ApprovalsTab from './detail/ApprovalsTab';
import ConversationTab from './detail/ConversationTab';
import { ClientVisitsPanel } from '../client-visits/ClientVisitsPanel';

interface TicketDetail {
  id: string;
  ticketNumber: string;
  subject: string;
  description: string;
  priority?: string | null;
  ticketStatus: string;
  approvalStatus?: string | null;
  productId?: string | null;
  productName?: string | null;
  productCode?: string | null;
  moduleName?: string | null;
  consultantType?: string | null;
  rejectionReason?: string | null;
  requestorUserId?: string | null;
  ticketCategory?: string | null;
  subCategory?: string | null;
  department?: string | null;
  requestorName?: string | null;
  requestorContact?: string | null;
  customerName?: string | null;
  customerCompany?: { id: string; name: string } | null;
  projectId?: string | null;
  project?: { id: string; name: string; projectNumber: string } | null;
  notifyEmails: string[];
  dueDate?: string | null;
  expectedResolutionDate?: string | null;
  slaHours?: number | null;
  firstResponseAt?: string | null;
  closedDate?: string | null;
  resolution?: string | null;
  resolutionCode?: string | null;
  resolvedAt?: string | null;
  reopenedCount?: number | null;
  createdAt: string;
  customFields: Record<string, unknown>;
  template: { id: string; name: string; category?: string | null };
  technicians: TicketTechnicianRow[];
  attachments: { id: string; fileName: string; filePath: string }[];
}

interface TemplateData { id: string; name: string; fields: MergedTemplateField[]; }
interface PicklistOption { value: string; label: string; }
interface UserOption { id: string; username: string; }

const OMIT_FROM_TEMPLATE_FIELDS = new Set([
  'subject', 'description', 'attachments', 'templateName', 'createdDate', 'closedDate', 'ticketStatus', 'sla',
]);

function optionLabel(f: MergedTemplateField, value: string): string {
  return f.options?.find((o) => o.value === value)?.label ?? value;
}

function fieldDisplayValue(f: MergedTemplateField, ticket: TicketDetail): string | null {
  if (f.fieldKey === 'technicians') {
    return ticket.technicians.length ? ticket.technicians.map((t) => t.user.username).join(', ') : null;
  }
  const raw = f.isCustom || f.storage === 'json'
    ? ticket.customFields?.[f.fieldKey]
    : (ticket as unknown as Record<string, unknown>)[f.fieldKey];

  if (raw === null || raw === undefined || raw === '') return null;
  if (Array.isArray(raw)) {
    return raw.length ? raw.map((v) => optionLabel(f, String(v))).join(', ') : null;
  }
  if (typeof raw === 'boolean') return raw ? 'Yes' : 'No';
  if (f.dataType === 'SELECT' || f.dataType === 'RADIO') return optionLabel(f, String(raw));
  return String(raw);
}

export default function TicketDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [tab, setTab] = useState('details');
  const { user } = useAuth();
  const isStaff = !!user?.roles.some((r) => r === 'Admin' || r === 'Viewer');
  const isTenantAdmin = !!user?.roles.includes('Admin');
  const isCustomerAdmin = !!user?.roles.includes('CustomerAdmin');
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  const { data: ticket, isLoading } = useQuery<TicketDetail>({
    queryKey: ['tickets', id],
    queryFn: async () => (await api.get(`/api/tickets/${id}`)).data,
    enabled: !!id,
  });

  const { data: template } = useQuery<TemplateData>({
    queryKey: ['templates', ticket?.template.id],
    queryFn: async () => (await api.get(`/api/templates/${ticket!.template.id}`)).data,
    enabled: !!ticket,
  });

  const { data: statusOptions = [] } = useQuery<PicklistOption[]>({
    queryKey: ['picklist-options', 'ticketStatus'],
    queryFn: async () => (await api.get('/api/picklist-options', { params: { listKey: 'ticketStatus' } })).data,
  });
  const { data: priorityOptions = [] } = useQuery<PicklistOption[]>({
    queryKey: ['picklist-options', 'priority'],
    queryFn: async () => (await api.get('/api/picklist-options', { params: { listKey: 'priority' } })).data,
  });
  const { data: users = [] } = useQuery<UserOption[]>({
    queryKey: ['users'],
    queryFn: async () => (await api.get('/api/users')).data,
    enabled: isStaff, // customers never assign technicians, so don't fetch staff list
  });

  const updateMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => api.put(`/api/tickets/${id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tickets', id] });
      qc.invalidateQueries({ queryKey: ['tickets'] });
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error updating ticket'),
  });

  const assignMutation = useMutation({
    mutationFn: (userIds: string[]) => api.put(`/api/tickets/${id}/technicians`, { userIds }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tickets', id] });
      qc.invalidateQueries({ queryKey: ['tickets'] });
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error assigning agent'),
  });

  const invalidateTicket = () => {
    qc.invalidateQueries({ queryKey: ['tickets', id] });
    qc.invalidateQueries({ queryKey: ['tickets'] });
    qc.invalidateQueries({ queryKey: ['ticket-activity', id] });
  };
  const approveMutation = useMutation({
    mutationFn: () => api.post(`/api/tickets/${id}/approve`),
    onSuccess: () => { invalidateTicket(); toast.success('Ticket approved'); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error approving ticket'),
  });
  const rejectMutation = useMutation({
    mutationFn: (reason: string) => api.post(`/api/tickets/${id}/reject`, { reason }),
    onSuccess: () => { invalidateTicket(); setRejectOpen(false); setRejectReason(''); toast.success('Ticket rejected'); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error rejecting ticket'),
  });
  // Stage 1: the customer company admin approves/rejects their employee's ticket.
  const custApproveMutation = useMutation({
    mutationFn: () => api.post(`/api/tickets/${id}/customer-approve`),
    onSuccess: () => { invalidateTicket(); toast.success('Approved — sent for provider approval'); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error approving ticket'),
  });
  const custRejectMutation = useMutation({
    mutationFn: (reason: string) => api.post(`/api/tickets/${id}/customer-reject`, { reason }),
    onSuccess: () => { invalidateTicket(); setRejectOpen(false); setRejectReason(''); toast.success('Ticket rejected'); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error rejecting ticket'),
  });
  // The Reject dialog serves whichever stage applies to this viewer.
  const submitReject = (reason: string) => {
    if (isCustomerAdmin && ticket?.approvalStatus === 'PENDING_CUSTOMER') custRejectMutation.mutate(reason);
    else rejectMutation.mutate(reason);
  };

  // Project association (staff only).
  const { data: projectOptions = [] } = useQuery<{ id: string; name: string; projectNumber: string }[]>({
    queryKey: ['projects'],
    queryFn: async () => (await api.get('/api/projects')).data,
    enabled: isStaff,
  });
  const linkProject = useMutation({
    mutationFn: (pid: string) => api.post(`/api/projects/${pid}/tickets/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['tickets', id] }); toast.success('Linked to project'); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error linking project'),
  });
  const unlinkProject = useMutation({
    mutationFn: (pid: string) => api.delete(`/api/projects/${pid}/tickets/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['tickets', id] }); toast.success('Unlinked from project'); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error unlinking project'),
  });

  if (isLoading || !ticket) {
    return <p className="text-muted-foreground">Loading...</p>;
  }

  const priority = getPriorityMeta(ticket.priority);
  const countdown = formatCountdown(ticket.dueDate, ticket.slaHours);
  const templateFieldRows = (template?.fields ?? [])
    .filter((f) => f.visibility === 'VISIBLE' && !OMIT_FROM_TEMPLATE_FIELDS.has(f.fieldKey))
    .map((f) => ({ field: f, value: fieldDisplayValue(f, ticket) }))
    .filter((row) => row.value !== null);

  return (
    <div>
      <Button variant="ghost" size="sm" asChild className="mb-3 -ml-2">
        <Link to="/tickets"><ArrowLeft className="size-4" /> All tickets</Link>
      </Button>

      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">#{ticket.ticketNumber}</span>
          <h1 className="text-xl font-bold text-foreground">{ticket.subject}</h1>
          <Badge variant={priority.code === 'P1' ? 'destructive' : 'secondary'}>{priority.label}</Badge>
          {getApprovalMeta(ticket.approvalStatus) && (
            <span className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${getApprovalMeta(ticket.approvalStatus)!.className}`}>
              {getApprovalMeta(ticket.approvalStatus)!.label}
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <Button onClick={() => setTab('conversation')}>Reply</Button>
        </div>
      </div>

      {/* Stage 1: the customer company admin reviews their employee's ticket. */}
      {isCustomerAdmin && ticket.approvalStatus === 'PENDING_CUSTOMER' && (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3">
          <div className="text-sm text-amber-700 dark:text-amber-300">
            A team member raised this ticket. Approve to send it on for provider approval, or reject it.
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setRejectOpen(true)}>Reject</Button>
            <Button size="sm" onClick={() => custApproveMutation.mutate()} disabled={custApproveMutation.isPending}>Approve</Button>
          </div>
        </div>
      )}
      {/* Stage 2: tenant Admin approves/rejects a customer-submitted ticket. */}
      {isTenantAdmin && ticket.approvalStatus === 'PENDING' && (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3">
          <div className="text-sm text-amber-700 dark:text-amber-300">
            This ticket was submitted by a customer and is awaiting your approval.
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setRejectOpen(true)}>Reject</Button>
            <Button size="sm" onClick={() => approveMutation.mutate()} disabled={approveMutation.isPending}>Approve</Button>
          </div>
        </div>
      )}
      {ticket.approvalStatus === 'REJECTED' && (
        <div className="mb-5 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3">
          <div className="text-sm font-medium text-destructive">This ticket request was rejected.</div>
          {ticket.rejectionReason && (
            <div className="mt-1 text-sm text-foreground whitespace-pre-wrap"><span className="text-muted-foreground">Reason: </span>{ticket.rejectionReason}</div>
          )}
        </div>
      )}

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Reject ticket request</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">The customer will be notified by email with this reason.</p>
          <Textarea
            rows={4}
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="Why is this request being rejected?"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectOpen(false)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={!rejectReason.trim() || rejectMutation.isPending || custRejectMutation.isPending}
              onClick={() => submitReject(rejectReason.trim())}
            >
              Reject &amp; notify
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="details">Details</TabsTrigger>
            <TabsTrigger value="conversation">Conversation</TabsTrigger>
            <TabsTrigger value="resolution">Resolution</TabsTrigger>
            {/* Tasks & Approvals are internal staff workflows — hidden from customers. */}
            {isStaff && <TabsTrigger value="tasks">Tasks</TabsTrigger>}
            {isStaff && <TabsTrigger value="time">Time</TabsTrigger>}
            {isStaff && <TabsTrigger value="approvals">Approvals</TabsTrigger>}
            {/* Client logs are Admin-only on the API — don't offer the tab to anyone else. */}
            {isTenantAdmin && <TabsTrigger value="client-visits">Client Visits</TabsTrigger>}
            <TabsTrigger value="history">History</TabsTrigger>
          </TabsList>

          <TabsContent value="details" className="space-y-4 pt-4">
            <Card>
              <CardContent className="py-4">
                <div className="mb-2 flex items-center gap-2">
                  <div className="flex size-8 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                    {(ticket.requestorName || '??').slice(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <div className="text-sm font-medium text-foreground">{ticket.requestorName || 'Unknown requestor'}</div>
                    <div className="text-xs text-muted-foreground">
                      {ticket.department ? `${ticket.department} · ` : ''}{new Date(ticket.createdAt).toLocaleString()}
                    </div>
                  </div>
                </div>
                <div className="rounded-lg bg-muted p-3 text-sm whitespace-pre-wrap text-foreground">
                  {ticket.description}
                </div>
                {ticket.attachments.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {ticket.attachments.map((a) => (
                      <a
                        key={a.id}
                        href={assetUrl(a.filePath)!}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-1 rounded-full border bg-background px-2.5 py-1 text-xs text-foreground hover:bg-accent"
                      >
                        <Paperclip className="size-3" /> {a.fileName}
                      </a>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {(ticket.productName || ticket.moduleName || ticket.consultantType) && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Product &amp; routing</CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-1 gap-4 pb-4 sm:grid-cols-3">
                  <div>
                    <div className="text-xs text-muted-foreground">Product</div>
                    <div className="text-sm text-foreground">{ticket.productName ?? '—'}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Module</div>
                    <div className="text-sm text-foreground">{ticket.moduleName ?? '—'}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Type</div>
                    <div className="text-sm text-foreground">
                      {ticket.consultantType ? ticket.consultantType.charAt(0) + ticket.consultantType.slice(1).toLowerCase() : '—'}
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {templateFieldRows.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Template fields · {template?.name}</CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-1 gap-4 pb-4 sm:grid-cols-2">
                  {templateFieldRows.map(({ field, value }) => (
                    <div key={field.fieldKey}>
                      <div className="text-xs text-muted-foreground">{field.label}</div>
                      <div className="text-sm text-foreground">{value}</div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="conversation" className="pt-4">
            <ConversationTab ticketId={ticket.id} />
          </TabsContent>
          <TabsContent value="resolution" className="pt-4">
            <ResolutionTab ticket={ticket} readOnly={!isStaff} />
          </TabsContent>
          <TabsContent value="tasks" className="pt-4">
            <TasksTab ticketId={ticket.id} />
          </TabsContent>
          <TabsContent value="time" className="pt-4">
            <WorklogTab ticketId={ticket.id} />
          </TabsContent>
          <TabsContent value="approvals" className="pt-4">
            <ApprovalsTab ticketId={ticket.id} />
          </TabsContent>
          <TabsContent value="client-visits" className="pt-4">
            <ClientVisitsPanel
              filter={{ ticketId: ticket.id }}
              title="Visits logged against this ticket"
              prefill={{
                ticketId: ticket.id,
                customerCompanyId: ticket.customerCompany?.id,
                productId: ticket.productId,
              }}
            />
          </TabsContent>

          <TabsContent value="history" className="pt-4">
            <HistoryTab ticketId={ticket.id} />
          </TabsContent>
        </Tabs>

        <div className="space-y-4">
          <Card className={countdown.overdue ? 'border-destructive/40 bg-destructive/5' : undefined}>
            <CardContent className="py-4">
              <div className={countdown.overdue ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}>SLA — resolution</div>
              <div className={countdown.overdue ? 'text-xl font-bold text-destructive' : 'text-xl font-bold text-foreground'}>
                {countdown.label}
              </div>
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className={countdown.overdue ? 'h-full bg-destructive' : 'h-full bg-primary'}
                  style={{ width: `${Math.round((countdown.overdue ? 1 : countdown.fraction) * 100)}%` }}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-3 py-4 text-sm">
              {/* Customers see status/priority read-only — only staff may change them. */}
              <div>
                <div className="mb-1 text-xs text-muted-foreground">Status</div>
                {isStaff ? (
                  <Select
                    value={ticket.ticketStatus}
                    onValueChange={(v) => {
                      updateMutation.mutate({ ticketStatus: v });
                      // On Resolved: jump to the Resolution tab. If a resolution note
                      // already exists just confirm; otherwise the tab prompts for one.
                      if (v.toLowerCase() === 'resolved') {
                        setTab('resolution');
                        if (ticket.resolution?.trim()) toast.success('Ticket resolved');
                      }
                    }}
                  >
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {statusOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                ) : (
                  <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm text-foreground">
                    {statusOptions.find((o) => o.value === ticket.ticketStatus)?.label ?? ticket.ticketStatus}
                  </div>
                )}
              </div>
              <div>
                <div className="mb-1 text-xs text-muted-foreground">Priority</div>
                {isStaff ? (
                  <Select
                    value={ticket.priority ?? undefined}
                    onValueChange={(v) => updateMutation.mutate({ priority: v })}
                  >
                    <SelectTrigger className="w-full"><SelectValue placeholder="Select..." /></SelectTrigger>
                    <SelectContent>
                      {priorityOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                ) : (
                  <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm text-foreground">
                    {priorityOptions.find((o) => o.value === ticket.priority)?.label ?? ticket.priority ?? '—'}
                  </div>
                )}
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Template</span>
                <span className="text-foreground">{ticket.template.name}</span>
              </div>
              {ticket.ticketCategory && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Category</span>
                  <span className="text-foreground">{ticket.ticketCategory}</span>
                </div>
              )}
              {ticket.slaHours != null && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">SLA</span>
                  <span className="text-foreground">Resolve in {ticket.slaHours}h</span>
                </div>
              )}
              {ticket.dueDate && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Due</span>
                  <span className="text-foreground">{new Date(ticket.dueDate).toLocaleDateString()}</span>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-sm">Assigned agent</CardTitle></CardHeader>
            <CardContent className="space-y-2 pb-4">
              {isStaff ? (
                // A ticket has at most one agent. Selecting a name (re)assigns; "Unassigned" clears it.
                (() => {
                  const assignedId = ticket.technicians[0]?.user.id ?? 'none';
                  const pending = ticket.approvalStatus === 'PENDING' || ticket.approvalStatus === 'REJECTED';
                  if (pending) {
                    return <p className="text-sm text-muted-foreground">Assignable once the ticket is approved.</p>;
                  }
                  return (
                    <Select
                      value={assignedId}
                      onValueChange={(v) => assignMutation.mutate(v === 'none' ? [] : [v])}
                    >
                      <SelectTrigger className="w-full"><SelectValue placeholder="Unassigned" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Unassigned</SelectItem>
                        {users.map((u) => <SelectItem key={u.id} value={u.id}>{u.username}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  );
                })()
              ) : (
                // Customers see who is handling their ticket, but cannot change it.
                ticket.technicians.length > 0
                  ? <div className="text-sm text-foreground">{ticket.technicians[0].user.username}</div>
                  : <p className="text-sm text-muted-foreground">Not yet assigned.</p>
              )}
            </CardContent>
          </Card>

          {isStaff && (
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-1.5 text-sm"><FolderKanban className="size-4" /> Project</CardTitle></CardHeader>
              <CardContent className="space-y-2 pb-4 text-sm">
                {ticket.project ? (
                  <div className="flex items-center justify-between gap-2 rounded-md border p-2">
                    <Link to={`/projects/${ticket.project.id}`} className="min-w-0">
                      <div className="truncate font-medium text-foreground hover:underline">{ticket.project.name}</div>
                      <div className="text-xs text-muted-foreground">{ticket.project.projectNumber}</div>
                    </Link>
                    <Button size="icon" variant="ghost" className="size-7 shrink-0"
                      onClick={() => unlinkProject.mutate(ticket.project!.id)} title="Unlink">
                      <X className="size-4" />
                    </Button>
                  </div>
                ) : (
                  <Select value="" onValueChange={(v) => linkProject.mutate(v)}>
                    <SelectTrigger className="w-full"><SelectValue placeholder="Associate a project…" /></SelectTrigger>
                    <SelectContent>
                      {projectOptions.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader><CardTitle className="text-sm">Requester</CardTitle></CardHeader>
            <CardContent className="space-y-1 pb-4 text-sm">
              <div className="text-foreground">{ticket.requestorName || '—'}</div>
              {ticket.requestorContact && <div className="text-muted-foreground">{ticket.requestorContact}</div>}
              {ticket.customerCompany && <div className="text-muted-foreground">Company: <span className="text-foreground">{ticket.customerCompany.name}</span></div>}
              {ticket.customerName && <div className="text-muted-foreground">Customer: {ticket.customerName}</div>}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
