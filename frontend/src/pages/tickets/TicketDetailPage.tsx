import { useState } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Clock, Timer, Paperclip, FolderKanban, X, CheckCircle2 } from 'lucide-react';
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
import ReopenControl from './detail/ReopenControl';
import TasksTab from './detail/TasksTab';
import CommentsTab from './detail/CommentsTab';
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
  statusChangedAt?: string | null;
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
  acknowledgedAt?: string | null;
  reopenedCount?: number | null;
  // Reopen window, computed server-side from the tenant's setting + resolvedAt.
  // Time only — who may reopen is the separate customer-side rule below.
  reopenWindowDays?: number | null;
  reopenDeadline?: string | null;
  reopenWindowOpen?: boolean;
  // When an unacknowledged resolution closes itself. Server-side: null unless
  // this ticket is actually waiting on a client's sign-off.
  autoCloseDays?: number | null;
  autoCloseAt?: string | null;
  // Set by the last reopen — the reason the client gave, when, and who.
  reopenReason?: string | null;
  reopenedAt?: string | null;
  reopenedByName?: string | null;
  // Σ worklog hours on the ticket, and the tasks still blocking a resolution.
  // Both come off the ticket itself so a customer — who cannot call the staff-only
  // worklog or task endpoints — still sees the time charged to their contract.
  totalHoursSpent?: number;
  openTaskCount?: number;
  createdAt: string;
  customFields: Record<string, unknown>;
  template: { id: string; name: string; category?: string | null };
  technicians: TicketTechnicianRow[];
  attachments: { id: string; fileName: string; filePath: string }[];
}

interface TemplateData { id: string; name: string; fields: MergedTemplateField[]; }
// Read-only support-hours pool for the ticket's product (or the client's shared
// contract) — same endpoint the Create Ticket form uses.
interface SupportHours {
  hasPool: boolean;
  unlimited?: boolean;
  scope?: 'PRODUCT' | 'CUSTOMER';
  coverage?: string | null;
  allocated: number | null;
  used: number;
  left: number | null;
}
interface PicklistOption { value: string; label: string; }
interface UserOption { id: string; username: string; }

const OMIT_FROM_TEMPLATE_FIELDS = new Set([
  'subject', 'description', 'attachments', 'templateName', 'createdDate', 'closedDate', 'ticketStatus', 'sla',
]);

/** "1 hr" / "2.5 hrs" — the support-hours chip and its tooltip share one unit. */
function hrs(n: number): string {
  return `${n} ${n === 1 ? 'hr' : 'hrs'}`;
}

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
  // `?tab=` is the source of truth for the active tab, so a notification can
  // deep-link straight to the Conversation tab and a refresh keeps your place.
  // `replace` keeps tab clicks out of the back-button history.
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get('tab') ?? 'details';
  const setTab = (value: string) => {
    const next = new URLSearchParams(searchParams);
    next.set('tab', value);
    setSearchParams(next, { replace: true });
  };
  // Tasks is a wide grid — SLA, status, requester and the rest step aside there
  // so its columns are not squeezed into a horizontal scroll.
  const showOverview = tab !== 'tasks';
  const { user } = useAuth();
  const isStaff = !!user?.roles.some((r) => r === 'Admin' || r === 'Viewer');
  const isTenantAdmin = !!user?.roles.includes('Admin');
  const isCustomerAdmin = !!user?.roles.includes('CustomerAdmin');
  // Both external roles may sign off a resolution; findOne() still limits an
  // employee to the tickets they raised.
  const isCustomerSide = !!user?.roles.some((r) => r === 'Customer' || r === 'CustomerAdmin');
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
  // Resolving or closing needs time on the ticket and no work left outstanding.
  // Both totals ride on the ticket itself rather than the staff-only worklog and
  // task endpoints, so the figures are there for a customer too.
  const loggedHours = ticket?.totalHoursSpent ?? 0;
  const openTasks = ticket?.openTaskCount ?? 0;

  // The contract pool this ticket draws against — shown in the sticky header so
  // it stays visible while working the ticket. Staff read the ticket-scoped
  // endpoint (the same figure the Tasks tab totals); the customer-side one is
  // staff-guarded, so a customer reads the same maths through their own route.
  const { data: supportHours } = useQuery<SupportHours>({
    queryKey: ['ticket-support-hours', id, isStaff],
    queryFn: async () =>
      isStaff
        ? (await api.get(`/api/tickets/${id}/support-hours`)).data
        : (await api.get('/api/my-company/product-support-hours', {
            params: { productId: ticket!.productId },
          })).data,
    enabled: !!ticket && (isStaff || !!ticket.productId),
  });
  // No allocation and not flagged unlimited means there is no contract to report —
  // say nothing rather than imply an open-ended pool.
  const hoursLabel = !supportHours
    ? null
    : supportHours.allocated != null
      ? `${supportHours.left} of ${supportHours.allocated} left`
      : supportHours.unlimited
        ? 'Unlimited'
        : null;

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
  // The client signs off the resolution, which closes the ticket.
  const acknowledgeMutation = useMutation({
    mutationFn: () => api.post(`/api/tickets/${id}/acknowledge`),
    onSuccess: () => { invalidateTicket(); toast.success('Thanks — the ticket is now closed'); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error acknowledging resolution'),
  });
  // Reopening carries the client's reason to the assigned agents and the admins.
  const reopenMutation = useMutation({
    mutationFn: (reason: string) => api.post(`/api/tickets/${id}/reopen`, { reason }),
    onSuccess: () => { invalidateTicket(); toast.success('Ticket reopened — the team has been notified'); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error reopening'),
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
  // Statuses are tenant-configurable, so read the meaning off the picklist label —
  // the same rule the backend uses to decide what may be acknowledged.
  const statusMeaningOf = (value: string) =>
    (statusOptions.find((o) => o.value === value)?.label ?? value).trim().toLowerCase();
  const statusMeaning = statusMeaningOf(ticket.ticketStatus);
  const canAcknowledge =
    isCustomerSide && statusMeaning === 'resolved' && !ticket.acknowledgedAt && !ticket.closedDate;
  // The SLA countdown only means something while the ticket is still being
  // worked. Once it reads Resolved or Closed there is nothing left to breach, so
  // the card — and its overdue warning — comes off the rail entirely.
  // Read off the live status, not the `resolvedAt`/`closedDate` stamps: moving a
  // ticket back out of Closed from the status dropdown leaves those in place, and
  // a ticket that is Open again needs its clock back. (A reopen clears them too,
  // so either route brings the card back.)
  const slaClockRunning = statusMeaning !== 'resolved' && statusMeaning !== 'closed';
  // Resolved and waiting on the client's sign-off.
  const awaitingSignOff =
    statusMeaning === 'resolved' && !ticket.acknowledgedAt && !ticket.closedDate;
  // One green banner above the tabs carries the resolution state on every tab,
  // and every action on it. It stands whether the ticket is awaiting sign-off or
  // already acknowledged; the Resolution tab deliberately renders none of this.
  const showResolutionBanner = awaitingSignOff || !!ticket.acknowledgedAt;
  // The client's own people reopen their tickets; an internal ticket (no customer
  // on it) has no client, so the call stays with staff. Same rule as the API.
  const canReopenTicket = isCustomerSide || (isStaff && !ticket.customerCompany);
  // Secondary lifecycle detail for the banner's second row. Reopened only counts
  // from the second time round, the same threshold the status row always used.
  const resolutionMeta = [
    ticket.resolvedAt && `Resolved ${new Date(ticket.resolvedAt).toLocaleString()}`,
    ticket.acknowledgedAt && `Acknowledged ${new Date(ticket.acknowledgedAt).toLocaleString()}`,
    (ticket.reopenedCount ?? 0) > 1 && `Reopened ${ticket.reopenedCount}×`,
    // Silence closes the ticket, so the banner says so while the clock runs.
    awaitingSignOff &&
      ticket.autoCloseAt &&
      `Closes automatically on ${new Date(ticket.autoCloseAt).toLocaleDateString()} if not acknowledged`,
  ].filter(Boolean) as string[];
  const resolutionHeadline = ticket.acknowledgedAt
    ? 'Resolution acknowledged by the client — ticket closed.'
    : canAcknowledge
      ? 'This ticket has been resolved — acknowledge the resolution to close it.'
      : ticket.customerCompany
        ? 'This ticket is resolved. It closes when the client acknowledges the resolution.'
        : 'This ticket is resolved.';
  // Staff resolve a client's ticket; the client's acknowledgement is what closes it.
  // Internal tickets (no client on them) keep the direct close.
  const closedByClient = !!ticket.customerCompany && statusMeaning !== 'closed';
  const templateFieldRows = (template?.fields ?? [])
    .filter((f) => f.visibility === 'VISIBLE' && !OMIT_FROM_TEMPLATE_FIELDS.has(f.fieldKey))
    .map((f) => ({ field: f, value: fieldDisplayValue(f, ticket) }))
    .filter((row) => row.value !== null);

  return (
    <div>
      <Button variant="ghost" size="sm" asChild className="mb-3 -ml-2">
        <Link to="/tickets"><ArrowLeft className="size-4" /> All tickets</Link>
      </Button>

      {/* Ticket identity, the contract pool and Reply stay put while the body
          scrolls. `top-14` clears Layout's own sticky header; the negative margin
          lets the bar span the full width of the p-8 content column. */}
      <div className="sticky top-14 z-10 -mx-8 mb-6 border-b bg-background/95 px-8 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-sm text-muted-foreground">#{ticket.ticketNumber}</span>
            <h1 className="min-w-0 text-xl font-bold break-words text-foreground">{ticket.subject}</h1>
            <Badge variant={priority.code === 'P1' ? 'destructive' : 'secondary'}>{priority.label}</Badge>
            {getApprovalMeta(ticket.approvalStatus) && (
              <span className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${getApprovalMeta(ticket.approvalStatus)!.className}`}>
                {getApprovalMeta(ticket.approvalStatus)!.label}
              </span>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-3">
            {/* Total time on this ticket. Shown whatever the status — an ongoing
                ticket and a closed one both need to account for their hours. */}
            <div
              className="flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs"
              title="Total time logged against this ticket, including time recorded on its tasks"
            >
              <Timer className="size-3.5 text-muted-foreground" />
              <span className="text-muted-foreground">Time spent</span>
              <span className="font-medium text-foreground">{hrs(loggedHours)}</span>
            </div>
            {hoursLabel && (
              <div
                className="flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs"
                title={
                  supportHours!.scope === 'CUSTOMER'
                    ? `${hrs(supportHours!.used)} spent on the shared contract`
                    : `${hrs(supportHours!.used)} spent`
                }
              >
                <Clock className="size-3.5 text-muted-foreground" />
                <span className="text-muted-foreground">Support hours</span>
                <span className="font-medium text-foreground">{hoursLabel}</span>
                <span className="text-muted-foreground">· {hrs(supportHours!.used)} spent</span>
              </div>
            )}
            <Button onClick={() => setTab('conversation')}>Reply</Button>
          </div>
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
      {/* The one green bar on this screen, in two rows. Top row: the status
          message, and every action on it aligned right — Acknowledge & close,
          Reopen, and the compact info icon that explains the reopening window.
          Bottom row: the lifecycle trail, small and muted so it reads as detail
          under the message rather than a second announcement. It sits above the
          tabs so it reads the same whichever tab is open. Each action shows only
          where it applies: Acknowledge for the client on a ticket awaiting
          sign-off, Reopen for whoever owns that call and only while the window is
          open, the icon always (it says why a button is missing). */}
      {showResolutionBanner && (
        <div className="mb-5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
            <div className="flex min-w-0 items-center gap-2 text-sm font-medium text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="size-4 shrink-0" />
              <span>{resolutionHeadline}</span>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {canAcknowledge && (
                <Button size="sm" onClick={() => acknowledgeMutation.mutate()} disabled={acknowledgeMutation.isPending}>
                  Acknowledge &amp; close
                </Button>
              )}
              <ReopenControl
                ticket={ticket}
                canReopen={canReopenTicket}
                onReopen={(reason) => reopenMutation.mutate(reason)}
                reopening={reopenMutation.isPending}
              />
            </div>
          </div>
          {resolutionMeta.length > 0 && (
            <div className="mt-1 pl-6 text-xs text-muted-foreground">{resolutionMeta.join(' · ')}</div>
          )}
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

      {/* One horizontal row for all eight tabs, full width: beside a fixed side
          column History wrapped onto a second row. The overview column starts
          below the strip instead, level with the tab content.
          minmax(0,1fr) — a bare 1fr takes its minimum from the column's
          min-content, which pushed the fixed side column off-screen. The side
          column narrows a step at lg so both fit beside the sidebar. */}
      <Tabs value={tab} onValueChange={setTab} className="min-w-0">
        {/* Full width, evenly divided: the primitive is `inline-flex w-fit`, which
            left the strip stopping after History with the rest of the row empty.
            `flex-1` on each trigger shares the width out, so the set stays even
            however many tabs the viewer's roles actually show. `flex-wrap` is
            what keeps it usable narrow — the labels are `whitespace-nowrap`, so
            below a certain width they wrap to a second evenly-divided row rather
            than crushing. Scoped to this page: `tabs.tsx` is shared. */}
        <TabsList className="h-auto w-full flex-wrap">
          <TabsTrigger className="flex-1" value="details">Details</TabsTrigger>
          <TabsTrigger className="flex-1" value="conversation">Conversation</TabsTrigger>
          <TabsTrigger className="flex-1" value="resolution">Resolution</TabsTrigger>
          {/* Tasks & Approvals are internal staff workflows — hidden from customers. */}
          {isStaff && <TabsTrigger className="flex-1" value="tasks">Tasks</TabsTrigger>}
          {isStaff && <TabsTrigger className="flex-1" value="approvals">Approvals</TabsTrigger>}
          {/* Client logs are Admin-only on the API — don't offer the tab to anyone else. */}
          {isTenantAdmin && <TabsTrigger className="flex-1" value="client-visits">Client Visits</TabsTrigger>}
          <TabsTrigger className="flex-1" value="comments">Comments</TabsTrigger>
          <TabsTrigger className="flex-1" value="history">History</TabsTrigger>
        </TabsList>
        <div className={`grid grid-cols-1 gap-6 pt-4 ${showOverview
          ? 'lg:grid-cols-[minmax(0,1fr)_18rem] xl:grid-cols-[minmax(0,1fr)_20rem]'
          : ''}`}>
          <div className="min-w-0">

            <TabsContent value="details" className="space-y-4">
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

            <TabsContent value="conversation">
              <ConversationTab ticketId={ticket.id} />
            </TabsContent>
            <TabsContent value="resolution">
              <ResolutionTab
                ticket={ticket}
                readOnly={!isStaff}
                loggedHours={loggedHours}
                openTasks={openTasks}
                onLogTime={() => setTab('tasks')}
                onViewTasks={() => setTab('tasks')}
              />
            </TabsContent>
            <TabsContent value="tasks">
              <TasksTab ticketId={ticket.id} />
            </TabsContent>
            <TabsContent value="approvals">
              <ApprovalsTab ticketId={ticket.id} />
            </TabsContent>
            <TabsContent value="client-visits">
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

            <TabsContent value="comments">
              <CommentsTab ticketId={ticket.id} isStaff={isStaff} />
            </TabsContent>

            <TabsContent value="history">
              <HistoryTab ticketId={ticket.id} />
            </TabsContent>
          </div>

          {/* The overview column is dropped on Tasks: that grid needs every
              pixel it can get, and its columns were being squeezed into a
              horizontal scroll beside a fixed 18-20rem sidebar. */}
          {showOverview && (
          <div className="min-w-0 space-y-4">
            {slaClockRunning && (
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
            )}

            <Card>
              <CardContent className="space-y-3 py-4 text-sm">
                {/* Customers see status/priority read-only — only staff may change them. */}
                <div>
                  <div className="mb-1 text-xs text-muted-foreground">Status</div>
                  {isStaff ? (
                    <Select
                      value={ticket.ticketStatus}
                      onValueChange={(v) => {
                        // Mirrors of the backend rules, so the agent lands on the tab
                        // that fixes it instead of bouncing off a 400. Outstanding work
                        // is checked first — it is the one that needs doing, not just
                        // recording.
                        const meaning = statusMeaningOf(v);
                        const signingOff = meaning === 'resolved' || meaning === 'closed';
                        if (signingOff && openTasks > 0) {
                          toast.error(
                            `${openTasks} task${openTasks === 1 ? ' is' : 's are'} still open — complete or cancel ${openTasks === 1 ? 'it' : 'them'} before marking it ${meaning}`,
                          );
                          setTab('tasks');
                          return;
                        }
                        if (signingOff && loggedHours <= 0) {
                          toast.error(`Log the time spent on this ticket before marking it ${meaning} — add a task on the Tasks tab and log against it`);
                          setTab('tasks');
                          return;
                        }
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
                        {statusOptions.map((o) => (
                          <SelectItem
                            key={o.value}
                            value={o.value}
                            disabled={closedByClient && statusMeaningOf(o.value) === 'closed'}
                          >
                            {o.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm text-foreground">
                      {statusOptions.find((o) => o.value === ticket.ticketStatus)?.label ?? ticket.ticketStatus}
                    </div>
                  )}
                  {/* When it last moved. The full trail is on History; this is the
                      one stamp worth reading next to the control that sets it. */}
                  {ticket.statusChangedAt && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      In this status since{' '}
                      {new Date(ticket.statusChangedAt).toLocaleString(undefined, {
                        day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
                      })}
                    </p>
                  )}
                  {isStaff && closedByClient && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Resolve this ticket — it closes when {ticket.customerCompany?.name ?? 'the client'} acknowledges the resolution.
                    </p>
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
                <div className="text-muted-foreground">Company: <span className="text-foreground">{ticket.customerCompany?.name ?? 'Internal'}</span></div>
                {ticket.customerName && <div className="text-muted-foreground">Customer: {ticket.customerName}</div>}
              </CardContent>
            </Card>
          </div>
          )}
        </div>
      </Tabs>
    </div>
  );
}
