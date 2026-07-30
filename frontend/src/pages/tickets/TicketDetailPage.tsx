import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Paperclip } from 'lucide-react';
import { toast } from 'sonner';
import api from '../../lib/api';
import { assetUrl } from '@/lib/assetUrl';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { getPriorityMeta, formatCountdown, type TicketTechnicianRow } from './ticketHelpers';
import type { MergedTemplateField } from './DynamicTicketField';

interface TicketDetail {
  id: string;
  ticketNumber: string;
  subject: string;
  description: string;
  priority?: string | null;
  ticketStatus: string;
  ticketCategory?: string | null;
  subCategory?: string | null;
  department?: string | null;
  requestorName?: string | null;
  requestorContact?: string | null;
  customerName?: string | null;
  notifyEmails: string[];
  dueDate?: string | null;
  expectedResolutionDate?: string | null;
  closedDate?: string | null;
  customerConfirmation?: boolean | null;
  createdAt: string;
  rootCauseCategory?: string | null;
  rootCauseDescription?: string | null;
  correctionAction?: string | null;
  preventionAction?: string | null;
  lessonsLearned?: string | null;
  requestType: { id: string; name: string };
  technicians: TicketTechnicianRow[];
  attachments: { id: string; fileName: string; filePath: string }[];
}

interface TemplateData { id: string; name: string; fields: MergedTemplateField[]; }
interface PicklistOption { value: string; label: string; }
interface UserOption { id: string; username: string; }

const OMIT_FROM_TEMPLATE_FIELDS = new Set([
  'subject', 'description', 'attachments', 'templateName', 'requestType', 'createdDate', 'closedDate', 'ticketStatus',
]);

function fieldDisplayValue(f: MergedTemplateField, ticket: TicketDetail): string | null {
  const raw = (ticket as unknown as Record<string, unknown>)[f.fieldKey];
  if (f.fieldKey === 'technicians') {
    return ticket.technicians.length ? ticket.technicians.map((t) => t.user.username).join(', ') : null;
  }
  if (Array.isArray(raw)) return raw.length ? raw.join(', ') : null;
  if (typeof raw === 'boolean') return raw ? 'Yes' : 'No';
  if (raw === null || raw === undefined || raw === '') return null;
  return String(raw);
}

export default function TicketDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [rootCause, setRootCause] = useState({
    rootCauseCategory: '', rootCauseDescription: '', correctionAction: '', preventionAction: '', lessonsLearned: '',
  });

  const { data: ticket, isLoading } = useQuery<TicketDetail>({
    queryKey: ['tickets', id],
    queryFn: async () => (await api.get(`/api/tickets/${id}`)).data,
    enabled: !!id,
  });

  const { data: template } = useQuery<TemplateData>({
    queryKey: ['templates', 'by-request-type', ticket?.requestType.id],
    queryFn: async () => (await api.get(`/api/templates/by-request-type/${ticket!.requestType.id}`)).data,
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
  });

  useEffect(() => {
    if (!ticket) return;
    setRootCause({
      rootCauseCategory: ticket.rootCauseCategory ?? '',
      rootCauseDescription: ticket.rootCauseDescription ?? '',
      correctionAction: ticket.correctionAction ?? '',
      preventionAction: ticket.preventionAction ?? '',
      lessonsLearned: ticket.lessonsLearned ?? '',
    });
  }, [ticket]);

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
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error assigning technicians'),
  });

  const notReady = () => toast.info('Coming soon');

  if (isLoading || !ticket) {
    return <p className="text-muted-foreground">Loading...</p>;
  }

  const priority = getPriorityMeta(ticket.priority);
  const countdown = formatCountdown(ticket.dueDate);
  const templateFieldRows = (template?.fields ?? [])
    .filter((f) => f.visibility === 'VISIBLE' && !OMIT_FROM_TEMPLATE_FIELDS.has(f.fieldKey))
    .map((f) => ({ field: f, value: fieldDisplayValue(f, ticket) }))
    .filter((row) => row.value !== null);

  return (
    <div>
      <Button variant="ghost" size="sm" asChild className="mb-3 -ml-2">
        <Link to="/tickets"><ArrowLeft className="size-4" /> All requests</Link>
      </Button>

      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">#{ticket.ticketNumber}</span>
          <h1 className="text-xl font-bold text-foreground">{ticket.subject}</h1>
          <Badge variant={priority.code === 'P1' ? 'destructive' : 'secondary'}>{priority.label}</Badge>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={notReady}>Reply</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
        <Tabs defaultValue="details">
          <TabsList>
            <TabsTrigger value="details">Details</TabsTrigger>
            <TabsTrigger value="resolution">Resolution</TabsTrigger>
            <TabsTrigger value="tasks">Tasks</TabsTrigger>
            <TabsTrigger value="approvals">Approvals</TabsTrigger>
            <TabsTrigger value="rootcause">Root Cause</TabsTrigger>
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

          <TabsContent value="resolution" className="pt-4">
            <p className="text-sm text-muted-foreground">Resolution tracking is coming soon.</p>
          </TabsContent>
          <TabsContent value="tasks" className="pt-4">
            <p className="text-sm text-muted-foreground">Tasks are coming soon.</p>
          </TabsContent>
          <TabsContent value="approvals" className="pt-4">
            <p className="text-sm text-muted-foreground">Approvals are coming soon.</p>
          </TabsContent>

          <TabsContent value="rootcause" className="pt-4">
            <Card>
              <CardContent className="space-y-4 py-4">
                <div>
                  <label className="text-sm font-medium text-foreground">Root Cause Category</label>
                  <Input
                    className="mt-1"
                    value={rootCause.rootCauseCategory}
                    onChange={(e) => setRootCause((p) => ({ ...p, rootCauseCategory: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-foreground">Root Cause Description</label>
                  <Textarea
                    className="mt-1"
                    rows={3}
                    value={rootCause.rootCauseDescription}
                    onChange={(e) => setRootCause((p) => ({ ...p, rootCauseDescription: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-foreground">Correction Action</label>
                  <Textarea
                    className="mt-1"
                    rows={3}
                    value={rootCause.correctionAction}
                    onChange={(e) => setRootCause((p) => ({ ...p, correctionAction: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-foreground">Prevention Action</label>
                  <Textarea
                    className="mt-1"
                    rows={3}
                    value={rootCause.preventionAction}
                    onChange={(e) => setRootCause((p) => ({ ...p, preventionAction: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-foreground">Lessons Learned</label>
                  <Textarea
                    className="mt-1"
                    rows={3}
                    value={rootCause.lessonsLearned}
                    onChange={(e) => setRootCause((p) => ({ ...p, lessonsLearned: e.target.value }))}
                  />
                </div>
                <Button onClick={() => updateMutation.mutate(rootCause)} disabled={updateMutation.isPending}>
                  {updateMutation.isPending ? 'Saving...' : 'Save Root Cause'}
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="history" className="pt-4">
            <p className="text-sm text-muted-foreground">Lifecycle history is coming soon.</p>
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
              <div>
                <div className="mb-1 text-xs text-muted-foreground">Status</div>
                <Select
                  value={ticket.ticketStatus}
                  onValueChange={(v) => updateMutation.mutate({ ticketStatus: v })}
                >
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {statusOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <div className="mb-1 text-xs text-muted-foreground">Priority</div>
                <Select
                  value={ticket.priority ?? undefined}
                  onValueChange={(v) => updateMutation.mutate({ priority: v })}
                >
                  <SelectTrigger className="w-full"><SelectValue placeholder="Select..." /></SelectTrigger>
                  <SelectContent>
                    {priorityOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Type</span>
                <span className="text-foreground">{ticket.requestType.name}</span>
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
                  <span className="text-foreground">{new Date(ticket.dueDate).toLocaleDateString()}</span>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-sm">Assigned to</CardTitle></CardHeader>
            <CardContent className="space-y-2 pb-4">
              {users.length === 0 && <p className="text-sm text-muted-foreground">No users available.</p>}
              {users.map((u) => {
                const selected = ticket.technicians.map((t) => t.user.id);
                return (
                  <label key={u.id} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={selected.includes(u.id)}
                      onCheckedChange={(checked) =>
                        assignMutation.mutate(checked ? [...selected, u.id] : selected.filter((uid) => uid !== u.id))
                      }
                    />
                    {u.username}
                  </label>
                );
              })}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-sm">Requester</CardTitle></CardHeader>
            <CardContent className="space-y-1 pb-4 text-sm">
              <div className="text-foreground">{ticket.requestorName || '—'}</div>
              {ticket.requestorContact && <div className="text-muted-foreground">{ticket.requestorContact}</div>}
              {ticket.customerName && <div className="text-muted-foreground">Customer: {ticket.customerName}</div>}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
