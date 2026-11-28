import { useEffect, useState } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Clock, Timer, Save, Paperclip, FolderKanban, X, CheckCircle2, RotateCcw, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import api from '../../lib/api';
import { ticketSourceLabel } from '@/lib/ticketSource';
import { useAuth } from '../../context/AuthContext';
import { assetUrl } from '@/lib/assetUrl';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Combobox } from '@/components/ui/combobox';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { getPriorityMeta, formatCountdown, getApprovalMeta, getReopenMeta, SLA_PANEL_CLASS, agentName, type TicketTechnicianRow } from './ticketHelpers';
import type { MergedTemplateField } from './DynamicTicketField';
import HistoryTab from './detail/HistoryTab';
import ResolutionTab from './detail/ResolutionTab';
import { EMPTY_RESOLVE, type ResolveDraft } from './detail/resolveDraft';
import { useWorklogInvalidate } from './detail/ticketQueries';
import ReopenControl from './detail/ReopenControl';
import TasksTab from './detail/TasksTab';
import CommentsTab from './detail/CommentsTab';
import ApprovalsTab from './detail/ApprovalsTab';
import ConversationTab from './detail/ConversationTab';
import { ClientVisitsPanel } from '../client-visits/ClientVisitsPanel';
import { useDateFormat } from '@/lib/dateFormat';
import { staffLabel } from '@/lib/staffLabel';

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
  /** Set while the SLA clock is paused (the ticket waits on the client). */
  slaPausedAt?: string | null;
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
  maxReopens?: number | null;
  reopenLimitReached?: boolean;
  // When an unacknowledged resolution closes itself. Server-side: null unless
  // this ticket is actually waiting on a client's sign-off.
  autoCloseDays?: number | null;
  autoCloseAt?: string | null;
  // Set by the last reopen — the reason the client gave, when, and who.
  reopenReason?: string | null;
  reopenedAt?: string | null;
  reopenedByName?: string | null;
  // A client's request to reopen it — decided by the client product's project
  // manager or an Admin. `reopenApproverName` null while pending = no project
  // manager set, so the Admins decide. `canDecideReopen` is this viewer's right.
  reopenRequestStatus?: string | null;
  reopenRequestReason?: string | null;
  reopenRequestedAt?: string | null;
  reopenRequestedByName?: string | null;
  reopenRequestedById?: string | null;
  reopenApproverName?: string | null;
  reopenDecidedAt?: string | null;
  reopenDecidedByName?: string | null;
  reopenDecisionNote?: string | null;
  canDecideReopen?: boolean;
  // Σ worklog hours on the ticket, and the tasks still blocking a resolution.
  // Both come off the ticket itself so a customer — who cannot call the staff-only
  // worklog or task endpoints — still sees the time charged to their contract.
  totalHoursSpent?: number;
  openTaskCount?: number;
  // Approval bars: who raised a held ticket, and who refused it.
  createdBy?: string | null;
  raisedByName?: string | null;
  raisedByCustomer?: boolean;
  rejectedByName?: string | null;
  rejectedAt?: string | null;
  createdAt: string;
  customFields: Record<string, unknown>;
  template: { id: string; name: string; category?: string | null; requiresApproval?: boolean };
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
interface UserOption { id: string; username: string; name?: string | null; }

const OMIT_FROM_TEMPLATE_FIELDS = new Set([
  'subject', 'description', 'attachments', 'templateName', 'createdDate', 'closedDate', 'ticketStatus', 'sla',
  // Shown beside Product and Module instead.
  'consultantType',
]);

/** Two decimals at most, trailing zeros trimmed — every figure in the header bar. */
function n2(n: number | null | undefined): string {
  return String(Number((Number(n) || 0).toFixed(2)));
}

/** "1 hr" / "2.5 hrs" — the support-hours chip and its tooltip share one unit. */
function hrs(n: number): string {
  const v = n2(n);
  return `${v} ${Number(v) === 1 ? 'hr' : 'hrs'}`;
}

function optionLabel(f: MergedTemplateField, value: string): string {
  return f.options?.find((o) => o.value === value)?.label ?? value;
}

function fieldDisplayValue(f: MergedTemplateField, ticket: TicketDetail): string | null {
  if (f.fieldKey === 'technicians') {
    return ticket.technicians.length ? ticket.technicians.map((t) => agentName(t.user)).join(', ') : null;
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

/** The ticket fields edited on this screen, held until Save. */
type TicketDraft = { ticketStatus?: string; priority?: string; agentId?: string; projectId?: string | null };

export default function TicketDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  // Every date on this screen goes through the tenant's own format, set on the
  // Organization screen — not whatever the viewer's browser happens to use.
  const { fmtDate, fmtDateTime } = useDateFormat();
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
  const isStaff = !!user?.roles.some((r) => r === 'Admin' || r === 'Viewer' || r === 'Manager');
  const isTenantAdmin = !!user?.roles.includes('Admin');
  const isCustomerAdmin = !!user?.roles.includes('CustomerAdmin');
  // Both external roles may sign off a resolution; findOne() still limits an
  // employee to the tickets they raised.
  const isCustomerSide = !!user?.roles.some((r) => r === 'Customer' || r === 'CustomerAdmin');
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  // The reopen-request Reject dialog is its own — different audience, different words.
  const [reopenRejectOpen, setReopenRejectOpen] = useState(false);
  const [reopenRejectReason, setReopenRejectReason] = useState('');

  const { data: ticket, isLoading } = useQuery<TicketDetail>({
    queryKey: ['tickets', id],
    queryFn: async () => (await api.get(`/api/tickets/${id}`)).data,
    enabled: !!id,
  });
  // The service provider's own name — an internal ticket's sender. Same query
  // (and cache entry) as the header's.
  const { data: providerClient } = useQuery<{ name: string } | null>({
    queryKey: ['my-client'],
    queryFn: async () => (await api.get('/api/auth/me/client')).data,
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
  // The Assigned agent field's options, in the server's priority order (client
  // request): the client's consultants for this product, its default
  // consultants, then the product's project manager. Don't re-sort.
  const { data: assignable = [] } = useQuery<UserOption[]>({
    queryKey: ['ticket-assignable', id],
    queryFn: async () => (await api.get(`/api/tickets/${id}/assignable-agents`)).data,
    enabled: isStaff && !!id, // customers never assign agents
  });
  // Resolving or closing needs time on the ticket and no work left outstanding.
  // Both totals ride on the ticket itself rather than the staff-only worklog and
  // task endpoints, so the figures are there for a customer too.
  const loggedHours = ticket?.totalHoursSpent ?? 0;
  const openTasks = ticket?.openTaskCount ?? 0;

  // A refused sign-off doesn't only land the agent on Tasks — it flags the rows
  // that are in the way. A bumped nonce rather than a boolean, so a second
  // attempt re-fires the hint even after the first one has faded.
  const [taskHint, setTaskHint] = useState(0);
  const sendToOpenTasks = () => {
    setTaskHint((n) => n + 1);
    setTab('tasks');
  };

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
      ? `${n2(supportHours.left)} of ${n2(supportHours.allocated)} left`
      : supportHours.unlimited
        ? 'Unlimited'
        : null;

  // Nothing on the ticket screen saves on change (client request). Status,
  // priority, assigned agent and project are a draft here until the header's
  // Save; a key is only present while it differs from what is stored.
  const [draft, setDraft] = useState<TicketDraft>({});
  // Another ticket opened in place (e.g. from search) starts with a clean draft.
  // The resolution typed on the Resolution tab — kept here so switching tabs
  // keeps it. Its Resolve button acts at once (client request), not via Save.
  const [resolveDraft, setResolveDraft] = useState<ResolveDraft>(EMPTY_RESOLVE);
  // What a client ticket moved to "Awaiting End-user Response" asks the client
  // for — typed in the box under Status, sent with Save, required by the server.
  const [infoRequest, setInfoRequest] = useState('');
  const isAwaitingClient = (v?: string) =>
    !!v && (statusOptions.find((o) => o.value === v)?.label ?? v).trim().toLowerCase() === 'awaiting end-user response';
  const [draftFor, setDraftFor] = useState(id);
  if (draftFor !== id) { setDraftFor(id); setDraft({}); setResolveDraft(EMPTY_RESOLVE); setInfoRequest(''); }
  const invalidateWorklogs = useWorklogInvalidate(id ?? '');
  const savedValues = (t: TicketDetail): Required<TicketDraft> => ({
    ticketStatus: t.ticketStatus,
    priority: t.priority ?? '',
    agentId: t.technicians[0]?.user.id ?? 'none',
    projectId: t.project?.id ?? null,
  });
  const changes = ticket
    ? (Object.keys(draft) as (keyof TicketDraft)[]).filter((k) => draft[k] !== savedValues(ticket)[k])
    : [];
  const changeCount = changes.length;
  const dirty = changeCount > 0;
  const discardAll = () => { setDraft({}); setResolveDraft(EMPTY_RESOLVE); setInfoRequest(''); };
  const setField = <K extends keyof TicketDraft>(k: K, v: TicketDraft[K]) =>
    setDraft((d) => {
      const next = { ...d, [k]: v };
      if (ticket && savedValues(ticket)[k] === v) delete next[k];
      return next;
    });
  // Leaving the page with unsaved changes asks first (browser close / reload).
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  // …and so does a click on an in-app link that leaves this ticket (sidebar,
  // All tickets, header links). The app uses BrowserRouter, which has no
  // `useBlocker`, so this catches the click itself, in the capture phase, before
  // React Router's Link sees it — a prevented click is one Link ignores. Not
  // covered: the browser's Back button and code that calls `navigate()` (e.g. a
  // search result). Same-ticket links (its own ?tab=), new-tab and modifier
  // clicks pass through.
  useEffect(() => {
    if (!dirty) return;
    const guard = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download')) return;
      const to = new URL(a.href, window.location.href);
      if (to.origin !== window.location.origin || to.pathname === window.location.pathname) return;
      if (!window.confirm('You have unsaved changes on this ticket. Leave without saving?')) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    document.addEventListener('click', guard, true);
    return () => document.removeEventListener('click', guard, true);
  }, [dirty]);

  const saveMutation = useMutation({
    // One button, several endpoints. The status goes last: resolving or closing
    // is the step the others should not come after.
    mutationFn: async () => {
      const t = ticket!;
      const saved = savedValues(t);
      const has = (k: keyof TicketDraft) => k in draft && draft[k] !== saved[k];
      // Checked before anything is written, so a refused save changes nothing.
      const askingClient = has('ticketStatus') && !!t.customerCompany && isAwaitingClient(draft.ticketStatus);
      if (askingClient && !infoRequest.trim()) {
        throw new Error('Say what information you need from the client — it is emailed to them');
      }
      if (has('agentId')) {
        await api.put(`/api/tickets/${id}/technicians`, { userIds: draft.agentId === 'none' ? [] : [draft.agentId] });
      }
      if (has('projectId')) {
        if (t.project) await api.delete(`/api/projects/${t.project.id}/tickets/${id}`);
        if (draft.projectId) await api.post(`/api/projects/${draft.projectId}/tickets/${id}`);
      }
      const body: Record<string, unknown> = {};
      if (has('priority')) body.priority = draft.priority;
      if (has('ticketStatus')) body.ticketStatus = draft.ticketStatus;
      if (askingClient) body.requestedInformation = infoRequest.trim();
      if (Object.keys(body).length) await api.put(`/api/tickets/${id}`, body);
      return body.ticketStatus && statusMeaningOf(body.ticketStatus as string) === 'resolved' ? 'resolved' as const : undefined;
    },
    onSuccess: (outcome) => {
      discardAll();
      // On Resolved: land on the Resolution tab to confirm what the client
      // will be asked to acknowledge.
      if (outcome === 'resolved') {
        setTab('resolution');
        toast.success('Ticket resolved');
      } else {
        toast.success('Ticket saved');
      }
    },
    // A step that failed leaves the earlier ones saved: the refetch below drops
    // those from the draft (they now equal the stored values) and keeps the rest.
    onError: (e: any) => toast.error(e.response?.data?.message || e.message || 'Error saving ticket'),
    onSettled: () => { invalidateTicket(); invalidateWorklogs(); },
  });

  // The Resolution tab's Resolve: books the round's entry (when given) and
  // resolves in the same click — no header Save (client request).
  const resolveMutation = useMutation({
    mutationFn: async ({ resolution, log }: { resolution: string; log?: { hours: number; note: string } }) => {
      // Booked first, so these hours are what satisfy the resolve gate. Should
      // the resolve be refused, the box gives way to a bare Resolve on this entry.
      if (log) await api.post(`/api/tickets/${id}/worklogs`, log);
      await api.put(`/api/tickets/${id}/resolution`, { resolution });
    },
    onSuccess: () => {
      setResolveDraft(EMPTY_RESOLVE);
      setTab('resolution');
      toast.success('Ticket resolved');
    },
    onError: (e: any) => toast.error(e.response?.data?.message || e.message || 'Error resolving ticket'),
    onSettled: () => { invalidateTicket(); invalidateWorklogs(); },
  });

  const invalidateTicket = () => {
    qc.invalidateQueries({ queryKey: ['tickets', id] });
    qc.invalidateQueries({ queryKey: ['tickets'] });
    qc.invalidateQueries({ queryKey: ['ticket-activity', id] });
    qc.invalidateQueries({ queryKey: ['ticket-assignable', id] });
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
  // A customer ticket reopens only on approval: the client asks, the client
  // product's project manager (or an Admin) decides.
  const requestReopenMutation = useMutation({
    mutationFn: (reason: string) => api.post(`/api/tickets/${id}/reopen-request`, { reason }),
    onSuccess: () => { invalidateTicket(); toast.success('Reopen request sent for approval'); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error sending the reopen request'),
  });
  const withdrawReopenMutation = useMutation({
    mutationFn: () => api.post(`/api/tickets/${id}/reopen-request/withdraw`),
    onSuccess: () => { invalidateTicket(); toast.success('Reopen request withdrawn'); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error withdrawing the request'),
  });
  const approveReopenMutation = useMutation({
    mutationFn: () => api.post(`/api/tickets/${id}/reopen-request/approve`),
    onSuccess: () => { invalidateTicket(); toast.success('Approved — the ticket is open again'); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error approving the reopen'),
  });
  const rejectReopenMutation = useMutation({
    mutationFn: (reason: string) => api.post(`/api/tickets/${id}/reopen-request/reject`, { reason }),
    onSuccess: () => {
      invalidateTicket(); setReopenRejectOpen(false); setReopenRejectReason('');
      toast.success('Reopen request rejected — the ticket stays closed');
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error rejecting the reopen'),
  });
  // The Reject dialog serves whichever stage applies to this viewer.
  const submitReject = (reason: string) => {
    if (isCustomerAdmin && ticket?.approvalStatus === 'PENDING_CUSTOMER') custRejectMutation.mutate(reason);
    else rejectMutation.mutate(reason);
  };

  // Project association (staff only).
  const { data: projectOptions = [] } = useQuery<{ id: string; name: string; projectNumber: string; isActive: boolean }[]>({
    queryKey: ['projects'],
    queryFn: async () => (await api.get('/api/projects')).data,
    enabled: isStaff,
  });

  if (isLoading || !ticket) {
    return <p className="text-muted-foreground">Loading...</p>;
  }

  const priority = getPriorityMeta(ticket.priority);
  const countdown = formatCountdown(ticket.dueDate, ticket.slaHours, ticket.slaPausedAt);
  const slaPanel = SLA_PANEL_CLASS[countdown.tone];
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
  // A ticket closed by the auto-close sweep was never acknowledged, but it is
  // still closed and still reopenable, so it gets the bar too.
  const closedUnacknowledged = statusMeaning === 'closed' && !!ticket.resolvedAt && !ticket.acknowledgedAt;
  const showResolutionBanner = awaitingSignOff || !!ticket.acknowledgedAt || closedUnacknowledged;
  const reopenPending = ticket.reopenRequestStatus === 'PENDING';
  // The client's own people reopen their tickets; an internal ticket (no customer
  // on it) has no client, so the call stays with staff. Same rule as the API.
  const canReopenTicket = isCustomerSide || (isStaff && !ticket.customerCompany);
  // On an internal ticket only an Admin reopens directly; other staff ask, and
  // an Admin approves — the same request flow a client's ticket uses.
  const internalRequest = !ticket.customerCompany && isStaff && !isTenantAdmin;
  const reopenByRequest = !!ticket.customerCompany || internalRequest;
  // Whoever asked may withdraw: the client, or the staff member on an internal ticket.
  const mayWithdrawReopen = isCustomerSide || (!ticket.customerCompany && ticket.reopenRequestedById === user?.id);
  // The ticket's sender: the named requestor, else the client company it was
  // raised for, else — an internal ticket — the service provider itself.
  const sourceLabel = ticketSourceLabel(ticket.customerCompany?.name, providerClient?.name);
  const requesterLabel = ticket.requestorName?.trim() || sourceLabel;
  // Secondary lifecycle detail for the banner's second row. Reopened only counts
  // from the second time round, the same threshold the status row always used.
  const resolutionMeta = [
    ticket.resolvedAt && `Resolved ${fmtDateTime(ticket.resolvedAt)}`,
    ticket.acknowledgedAt && `Acknowledged ${fmtDateTime(ticket.acknowledgedAt)}`,
    (ticket.reopenedCount ?? 0) > 1 && `Reopened ${ticket.reopenedCount}×`,
    // Silence closes the ticket, so the banner says so while the clock runs.
    awaitingSignOff &&
      ticket.autoCloseAt &&
      `Closes automatically on ${fmtDate(ticket.autoCloseAt)} if not acknowledged`,
  ].filter(Boolean) as string[];
  const resolutionHeadline = ticket.acknowledgedAt
    ? 'Resolution acknowledged by the client — ticket closed.'
    : closedUnacknowledged
      ? 'This ticket is closed.'
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

  // The project the Details tab shows: the draft's pick, else the stored link.
  const draftProjectId = 'projectId' in draft ? draft.projectId : ticket.project?.id ?? null;
  const shownProject = draftProjectId === (ticket.project?.id ?? null)
    ? ticket.project
    : projectOptions.find((p) => p.id === draftProjectId) ?? null;

  return (
    <div>
      <Button variant="ghost" size="sm" asChild className="mb-3 -ml-2">
        <Link to="/tickets"><ArrowLeft className="size-4" /> All tickets</Link>
      </Button>

      {/* Ticket identity, the contract pool and Reply stay put while the body
          scrolls. `top-14` clears Layout's own sticky header; the negative margin
          lets the bar span the full width of the p-8 content column. */}
      <div className="sticky top-14 z-10 -mx-8 mb-6 border-b bg-background/95 px-8 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        {/* One row, on every tab: the subject gives way before the chips do, so the
            time and contract figures never wrap onto a second line. */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-x-3">
            <span className="shrink-0 text-sm text-muted-foreground">#{ticket.ticketNumber}</span>
            <h1 className="min-w-0 truncate text-xl font-bold text-foreground" title={ticket.subject}>{ticket.subject}</h1>
            <Badge variant={priority.code === 'P1' ? 'destructive' : 'secondary'} className="shrink-0">{priority.label}</Badge>
            {[getApprovalMeta(ticket.approvalStatus), getReopenMeta(ticket.reopenRequestStatus)].map((m) => m && (
              <span key={m.label} className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-medium ${m.className}`}>
                {m.label}
              </span>
            ))}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {/* Total time on this ticket. Shown whatever the status — an ongoing
                ticket and a closed one both need to account for their hours. */}
            <div
              className="flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs whitespace-nowrap"
              title="Total time logged against this ticket, including time recorded on its tasks"
            >
              <Timer className="size-3.5 text-muted-foreground" />
              <span className="text-muted-foreground">Time spent</span>
              <span className="font-medium text-foreground">{hrs(loggedHours)}</span>
            </div>
            {hoursLabel && (
              <div
                className="flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs whitespace-nowrap"
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
            {isStaff && dirty && (
              <Button variant="ghost" className="shrink-0" onClick={discardAll} disabled={saveMutation.isPending}>
                Discard
              </Button>
            )}
            {isStaff && (
              <Button
                variant={dirty ? 'default' : 'outline'}
                className="shrink-0"
                disabled={!dirty || saveMutation.isPending}
                title={dirty ? `Save ${changeCount} change${changeCount === 1 ? '' : 's'}` : 'No unsaved changes'}
                onClick={() => saveMutation.mutate()}
              >
                <Save className="size-4" /> {saveMutation.isPending ? 'Saving…' : 'Save'}
              </Button>
            )}
            <Button className="shrink-0" onClick={() => setTab('conversation')}>Reply</Button>
          </div>
        </div>
      </div>

      {/* Stage 1: the customer company admin reviews their employee's ticket. */}
      {isCustomerAdmin && ticket.approvalStatus === 'PENDING_CUSTOMER' && (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3">
          <div className="min-w-0 space-y-0.5 text-amber-700 dark:text-amber-300">
            <div className="text-sm font-medium">{ticket.template?.name ?? 'Ticket'} awaiting your approval</div>
            <div className="text-xs">
              Raised by {ticket.raisedByName ?? 'a member of your team'} on {fmtDateTime(ticket.createdAt)}.
              {ticket.template?.requiresApproval
                ? 'Approve to send it to your service provider for their approval, or reject it.'
                : 'Approve to send it to your service provider, or reject it.'}
            </div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setRejectOpen(true)}>Reject</Button>
            <Button size="sm" onClick={() => custApproveMutation.mutate()} disabled={custApproveMutation.isPending}>Approve</Button>
          </div>
        </div>
      )}
      {/* Stage 2: tenant Admin approves/rejects a ticket held by its template's
          "Needs admin approval" switch — raised by an agent or a customer. */}
      {isTenantAdmin && ticket.approvalStatus === 'PENDING' && (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3">
          <div className="min-w-0 space-y-0.5 text-amber-700 dark:text-amber-300">
            <div className="text-sm font-medium">{ticket.template?.name ?? 'Ticket'} awaiting your approval</div>
            <div className="text-xs">
              Raised by {ticket.raisedByName ?? 'someone'} ({ticket.raisedByCustomer ? 'customer' : 'agent'}) on {fmtDateTime(ticket.createdAt)}
              {ticket.customerCompany ? ` for ${ticket.customerCompany.name}` : ''}.
              Nobody can be assigned or work on it until it is approved; its SLA clock starts on approval.
            </div>
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
      {/* ONE bar, one state at a time: while a reopen request waits, the violet
          bar below takes this bar's place rather than sitting under it; once the
          request is decided the ticket is either open again (no bar) or closed
          again, which brings this green bar back. */}
      {showResolutionBanner && !reopenPending && (
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
                requestMode={reopenByRequest}
                approverName={ticket.reopenApproverName}
                deciderLabel={internalRequest ? 'an Admin' : undefined}
                onReopen={(reason) =>
                  reopenByRequest ? requestReopenMutation.mutate(reason) : reopenMutation.mutate(reason)}
                reopening={reopenMutation.isPending || requestReopenMutation.isPending}
              />
            </div>
          </div>
          {resolutionMeta.length > 0 && (
            <div className="mt-1 pl-6 text-xs text-muted-foreground">{resolutionMeta.join(' · ')}</div>
          )}
          {/* The last reopen request was turned down, so the ticket is closed
              again — said on one line inside this same bar, not a box of its own. */}
          {ticket.reopenRequestStatus === 'REJECTED' && (
            <div className="mt-1 flex items-start gap-1.5 pl-6 text-xs text-destructive">
              <XCircle className="mt-px size-3.5 shrink-0" />
              <span className="min-w-0">
                Reopen declined{ticket.reopenDecidedByName ? ` by ${ticket.reopenDecidedByName}` : ''}
                {ticket.reopenDecidedAt ? ` on ${fmtDateTime(ticket.reopenDecidedAt)}` : ''}
                {ticket.reopenDecisionNote ? `: ${ticket.reopenDecisionNote}` : ''}
              </span>
            </div>
          )}
        </div>
      )}
      {/* A client's reopen request waiting for a decision. The decider (the
          client product's project manager, or any Admin) gets the actions; the
          client gets Withdraw; every other member of staff just reads it. */}
      {reopenPending && (
        <div className="mb-5 rounded-lg border border-violet-500/30 bg-violet-500/10 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
            <div className="flex min-w-0 items-center gap-2 text-sm font-medium text-violet-700 dark:text-violet-300">
              {ticket.canDecideReopen ? <RotateCcw className="size-4 shrink-0" /> : <Clock className="size-4 shrink-0" />}
              <span>
                {ticket.canDecideReopen
                  ? 'Reopen Ticket Approval'
                  : isCustomerSide
                    ? `Reopen requested. Waiting for ${ticket.reopenApproverName ? `${ticket.reopenApproverName} (project manager)` : 'your provider'} to approve.`
                    : !ticket.customerCompany
                      ? ticket.reopenRequestedById === user?.id
                        ? 'Reopen requested. Waiting for an admin to approve.'
                        : `${ticket.reopenRequestedByName ?? 'A colleague'} asked to reopen this ticket. Waiting for an admin to approve.`
                      : `The client asked to reopen this ticket. Waiting for ${ticket.reopenApproverName ? `${ticket.reopenApproverName} (project manager)` : 'an admin'} to approve.`}
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {ticket.canDecideReopen && (
                <>
                  <Button size="sm" variant="outline" className="border-destructive/40 text-destructive hover:text-destructive" onClick={() => setReopenRejectOpen(true)}>
                    Reject
                  </Button>
                  <Button size="sm" onClick={() => approveReopenMutation.mutate()} disabled={approveReopenMutation.isPending}>
                    Approve &amp; reopen
                  </Button>
                </>
              )}
              {mayWithdrawReopen && (
                <Button size="sm" variant="outline" onClick={() => withdrawReopenMutation.mutate()} disabled={withdrawReopenMutation.isPending}>
                  Withdraw request
                </Button>
              )}
            </div>
          </div>
          <div className="mt-1 pl-6 text-xs text-muted-foreground">
            {[
              ticket.reopenRequestedByName && `Requested by ${ticket.reopenRequestedByName}`,
              ticket.reopenRequestedAt && fmtDateTime(ticket.reopenRequestedAt),
              ticket.closedDate && `Closed ${fmtDateTime(ticket.closedDate)}`,
              'The ticket stays closed until this is decided',
            ].filter(Boolean).join(' · ')}
          </div>
          {ticket.reopenRequestReason && (
            <div className="mt-2.5 ml-6 rounded-md border bg-background px-3 py-2 text-sm whitespace-pre-wrap">
              <span className="font-medium">Reason: </span>{ticket.reopenRequestReason}
            </div>
          )}
        </div>
      )}
      <Dialog open={reopenRejectOpen} onOpenChange={setReopenRejectOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Reject reopen request</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            The ticket stays closed. {ticket.reopenRequestedByName ?? 'The client'} is notified by email and sees the reason you give here.
          </p>
          <Textarea
            rows={4}
            value={reopenRejectReason}
            onChange={(e) => setReopenRejectReason(e.target.value)}
            placeholder="Why isn't this ticket being reopened?"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setReopenRejectOpen(false)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={!reopenRejectReason.trim() || rejectReopenMutation.isPending}
              onClick={() => rejectReopenMutation.mutate(reopenRejectReason.trim())}
            >
              Reject request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* A client's employee whose ticket waits on their own company admin. */}
      {isCustomerSide && !isCustomerAdmin && ticket.approvalStatus === 'PENDING_CUSTOMER' && (
        <div className="mb-5 flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-amber-700 dark:text-amber-300">
          <Clock className="mt-0.5 size-4 shrink-0" />
          <div className="min-w-0 space-y-0.5">
            <div className="text-sm font-medium">Waiting for your company admin's approval</div>
            <div className="text-xs">
              {ticket.template?.requiresApproval
                ? "Once your company admin approves it, it goes to your service provider for their approval. You'll get an email at each step."
                : "Once your company admin approves it, it goes to your service provider. You'll get an email at each step."}
            </div>
          </div>
        </div>
      )}
      {/* Everyone else on a held ticket — the agent or customer who raised it —
          sees why nothing is happening yet. No actions: the decision is the Admin's. */}
      {!isTenantAdmin && ticket.approvalStatus === 'PENDING' && (
        <div className="mb-5 flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-amber-700 dark:text-amber-300">
          <Clock className="mt-0.5 size-4 shrink-0" />
          <div className="min-w-0 space-y-0.5">
            <div className="text-sm font-medium">Waiting for admin approval</div>
            <div className="text-xs">
              {ticket.template?.name ?? 'This'} tickets need an Admin's approval before work starts.
              {ticket.createdBy === user?.id && " You'll get an email and a notification as soon as it's decided."}
            </div>
          </div>
        </div>
      )}
      {ticket.approvalStatus === 'REJECTED' && (
        <div className="mb-5 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3">
          <div className="text-sm font-medium text-destructive">This ticket request was rejected.</div>
          {ticket.rejectionReason && (
            <div className="mt-1 text-sm text-foreground whitespace-pre-wrap"><span className="text-muted-foreground">Reason: </span>{ticket.rejectionReason}</div>
          )}
          {(ticket.rejectedByName || ticket.rejectedAt) && (
            <div className="mt-1 text-xs text-muted-foreground">
              Rejected{ticket.rejectedByName ? ` by ${ticket.rejectedByName}` : ''}{ticket.rejectedAt ? ` · ${fmtDateTime(ticket.rejectedAt)}` : ''}
            </div>
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

            <TabsContent value="details" className="space-y-3">
              <Card>
                {/* No top padding: this card has no border of its own, so `py-4` only
                    pushed the requestor row below the top of the bordered SLA panel
                    beside it. Every other tab starts flush — this one now does too. */}
                <CardContent className="pb-4">
                  <div className="mb-2 flex items-center gap-2">
                    <div className="flex size-8 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                      {requesterLabel.slice(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <div className="text-sm font-medium text-foreground">{requesterLabel}</div>
                      <div className="text-xs text-muted-foreground">
                        {ticket.department ? `${ticket.department} · ` : ''}{fmtDateTime(ticket.createdAt)}
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

              {/* One flat facts grid: routing, template, the people on the
                  ticket, then the project link. Field labels rather than card
                  headings, so the whole block reads as one set of ticket facts
                  instead of four competing panels. */}
              <Card>
                <CardContent className="space-y-4 py-4">
                  {/* A single grid — repeat(3, minmax(0,1fr)) — owns every cell,
                      so labels and values line up column-for-column across all
                      three rows. Each field is exactly one grid item; none of
                      them sets its own width or offset, so the Assigned agent
                      dropdown cannot shift Requester or Company. Rows that do
                      not fill their three columns are ended by `sm:col-start-1`
                      on the next field, which is what keeps the template fields
                      (however many the template defines) off the people row. */}
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    {(ticket.productName || ticket.moduleName || ticket.consultantType) && (
                      <>
                        <div>
                          <div className="mb-1 text-xs text-muted-foreground">Product</div>
                          <div className="text-sm text-foreground">{ticket.productName ?? '—'}</div>
                        </div>
                        <div>
                          <div className="mb-1 text-xs text-muted-foreground">Module</div>
                          <div className="text-sm text-foreground">{ticket.moduleName ?? '—'}</div>
                        </div>
                        {/* Stored only when the template carries Issue type and one
                            was picked; otherwise the field is left out, not blank. */}
                        {ticket.consultantType && (
                          <div>
                            <div className="mb-1 text-xs text-muted-foreground">Issue type</div>
                            <div className="text-sm text-foreground">
                              {ticket.consultantType === 'OTHERS'
                                ? 'Other'
                                : ticket.consultantType.charAt(0) + ticket.consultantType.slice(1).toLowerCase()}
                            </div>
                          </div>
                        )}
                      </>
                    )}

                    {/* The template, then the values captured for its own fields. */}
                    <div className="sm:col-start-1">
                      <div className="mb-1 text-xs text-muted-foreground">Template</div>
                      <div className="text-sm text-foreground">{ticket.template.name}</div>
                    </div>
                    {templateFieldRows.map(({ field, value }) => (
                      <div key={field.fieldKey}>
                        <div className="mb-1 text-xs text-muted-foreground">{field.label}</div>
                        <div className="text-sm text-foreground">{value}</div>
                      </div>
                    ))}

                    <div className="sm:col-start-1">
                      <div className="mb-1 text-xs text-muted-foreground">Assigned agent</div>
                      {isStaff ? (
                        // A ticket has at most one agent. Selecting a name (re)assigns; "Unassigned" clears it.
                        (() => {
                          const assignedId = draft.agentId ?? ticket.technicians[0]?.user.id ?? 'none';
                          const pending = ticket.approvalStatus === 'PENDING' || ticket.approvalStatus === 'REJECTED';
                          if (pending) {
                            return <p className="text-sm text-muted-foreground">Assignable once the ticket is approved.</p>;
                          }
                          return (
                            // Typeable, 5 rows then scroll (client request). Still a
                            // draft like every field here — Save writes it.
                            <Combobox
                              value={assignedId}
                              options={[{ value: 'none', label: 'Unassigned' }, ...assignable.map((u) => ({ value: u.id, label: staffLabel(u) }))]}
                              onChange={(v) => { if (v) setField('agentId', v); }}
                              placeholder="Unassigned"
                              emptyText="No agent matches that"
                              maxRows={5}
                            />
                          );
                        })()
                      ) : (
                        // Customers see who is handling their ticket, but cannot change it.
                        ticket.technicians.length > 0
                          ? <div className="text-sm text-foreground">{agentName(ticket.technicians[0].user)}</div>
                          : <p className="text-sm text-muted-foreground">Not yet assigned.</p>
                      )}
                    </div>
                    <div>
                      <div className="mb-1 text-xs text-muted-foreground">Requester</div>
                      <div className="text-sm text-foreground">{ticket.requestorName || '—'}</div>
                      {ticket.requestorContact && <div className="text-xs text-muted-foreground">{ticket.requestorContact}</div>}
                    </div>
                    <div>
                      <div className="mb-1 text-xs text-muted-foreground">Company</div>
                      <div className="text-sm text-foreground">{sourceLabel}</div>
                      {ticket.customerName && <div className="text-xs text-muted-foreground">Customer: {ticket.customerName}</div>}
                    </div>
                  </div>

                  {/* Its own full-width row beneath the grid. */}
                  {isStaff && (
                    <div>
                      <div className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                        <FolderKanban className="size-3.5" /> Project
                      </div>
                      {shownProject ? (
                        <div className="flex items-center justify-between gap-2 rounded-md border p-2">
                          <Link to={`/projects/${shownProject.id}`} className="min-w-0">
                            <div className="truncate text-sm font-medium text-foreground hover:underline">{shownProject.name}</div>
                            <div className="text-xs text-muted-foreground">{shownProject.projectNumber}</div>
                          </Link>
                          <Button size="icon" variant="ghost" className="size-7 shrink-0"
                            onClick={() => setField('projectId', null)} title="Unlink (saved with Save)">
                            <X className="size-4" />
                          </Button>
                        </div>
                      ) : (
                        <Select value="" onValueChange={(v) => { if (v) setField('projectId', v); }}>
                          <SelectTrigger className="w-full"><SelectValue placeholder="Associate a project… (optional)" /></SelectTrigger>
                          <SelectContent>
                            {projectOptions.filter((p) => p.isActive).map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
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
                onViewTasks={sendToOpenTasks}
                closed={statusMeaning === 'closed'}
                draft={resolveDraft}
                onDraft={setResolveDraft}
                onResolve={(resolution, log) => resolveMutation.mutateAsync({ resolution, log })}
                resolving={resolveMutation.isPending}
              />
            </TabsContent>
            <TabsContent value="tasks">
              <TasksTab
                ticketId={ticket.id}
                // Reopening a completed task belongs to the ticket's own agent
                // (or an admin), never the task assignee who closed it.
                ticketAssigneeId={ticket.technicians[0]?.user.id ?? null}
                // Bumped when a sign-off was refused for outstanding work: the
                // grid then marks the rows that blocked it.
                hintNonce={taskHint}
                settled={!slaClockRunning}
              />
            </TabsContent>
            <TabsContent value="approvals">
              <ApprovalsTab
                ticketId={ticket.id}
                // Editing/withdrawing a request belongs to the side that asked for it:
                // a tenant Admin or the agent holding this ticket. Mirrors the server gate.
                canManage={isTenantAdmin || ticket.technicians.some((t) => t.user.id === user?.id)}
              />
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
          <div className="min-w-0 space-y-3">
            {/* `Card` is deliberately flat app-wide, so the outline is set here
                rather than in card.tsx — this one panel gets a light box so the
                countdown reads as its own thing beside the tab content. Its colour
                is the same green/amber/red grade the SLA pill on the ticket list
                carries, from the shared `SLA_PANEL_CLASS` table. */}
            {/* A held ticket has no deadline yet: its clock starts on approval. */}
            {ticket.approvalStatus === 'PENDING' && (
              <Card className="rounded-lg border bg-muted/40">
                <CardContent className="px-4 py-4">
                  <div className="text-xs text-muted-foreground">SLA — resolution</div>
                  <div className="text-xl font-bold text-muted-foreground">Starts on approval</div>
                  {ticket.slaHours ? (
                    <div className="mt-1 text-xs text-muted-foreground">
                      {ticket.priority ? `${ticket.priority} · ` : ''}resolve in {ticket.slaHours}h once approved
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            )}
            {slaClockRunning && ticket.approvalStatus !== 'PENDING' && (
              <Card className={`rounded-lg border ${slaPanel.box}`}>
                <CardContent className="px-4 py-4">
                  <div className={`text-xs ${slaPanel.label}`}>SLA — resolution</div>
                  <div className={`text-xl font-bold ${slaPanel.value}`}>{countdown.label}</div>
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-background/60">
                    <div
                      className={`h-full ${slaPanel.bar}`}
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
                  {/* A Closed ticket's status is frozen (the server refuses too):
                      only a reopen brings it back, which moves the status itself. */}
                  {isStaff && statusMeaning !== 'closed' ? (
                    <Select
                      value={draft.ticketStatus ?? ticket.ticketStatus}
                      onValueChange={(v) => {
                        if (!v) return; // Radix's empty re-emit, never a real pick
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
                          sendToOpenTasks();
                          return;
                        }
                        if (signingOff && loggedHours <= 0) {
                          toast.error(`Log the time spent on this ticket before marking it ${meaning} — use Log time on the Resolution tab`);
                          setTab('resolution');
                          return;
                        }
                        // Nothing is signed off with nothing said about how. Only
                        // on the way in — a ticket already resolved may still be
                        // moved on without re-authoring its notes.
                        if (signingOff && !ticket.resolvedAt && !ticket.resolution?.trim()) {
                          toast.error(`Write a resolution message before marking this ticket ${meaning}`);
                          setTab('resolution');
                          return;
                        }
                        // Held as a draft — the header's Save writes it.
                        setField('ticketStatus', v);
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
                  {/* Picking "Awaiting End-user Response" on a client ticket asks
                      what is needed, right here under the dropdown; it goes out
                      with Save. */}
                  {isStaff && ticket.customerCompany && draft.ticketStatus !== undefined && isAwaitingClient(draft.ticketStatus) && (
                    <div className="mt-2 space-y-1">
                      <label htmlFor="info-request" className="text-xs font-medium text-foreground">
                        Information required from the client
                      </label>
                      <Textarea
                        id="info-request"
                        rows={3}
                        value={infoRequest}
                        onChange={(e) => setInfoRequest(e.target.value)}
                        placeholder="e.g. Please share a screenshot of the error and when it occurred"
                      />
                      <p className="text-xs text-muted-foreground">
                        Emailed to the client and posted in the chat on Save. The SLA clock pauses until they respond.
                      </p>
                    </div>
                  )}
                  {isStaff && statusMeaning === 'closed' && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {ticket.customerCompany
                        ? 'Closed — changes only through a client reopen request.'
                        : 'Closed — use Reopen to change it.'}
                    </p>
                  )}
                  {/* When it last moved. The full trail is on History; this is the
                      one stamp worth reading next to the control that sets it. */}
                  {ticket.statusChangedAt && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      In this status since{' '}
                      {fmtDateTime(ticket.statusChangedAt)}
                    </p>
                  )}
                </div>
                <div>
                  <div className="mb-1 text-xs text-muted-foreground">Priority</div>
                  {isStaff ? (
                    <Select
                      value={(draft.priority ?? ticket.priority) || undefined}
                      onValueChange={(v) => { if (v) setField('priority', v); }}
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
                {ticket.dueDate && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Due</span>
                    <span className="text-foreground">{fmtDate(ticket.dueDate)}</span>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
          )}
        </div>
      </Tabs>
    </div>
  );
}
