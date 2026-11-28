import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Mail, Plus, RotateCcw, Trash2, Users, X, Zap } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { toast } from 'sonner';
import api from '../lib/api';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  DEFAULT_RULES, EMAIL_ONLY_RECIPIENTS, NOTIFICATION_EVENTS, NOTIFICATION_RECIPIENTS,
  expandRows, groupRules, recipientLabel,
} from './email-config/notificationMeta';
import type { EventRow, EventTarget, NotificationRule } from './email-config/notificationMeta';

/** A column heading: its icon, then its label (same as the other list screens). */
function HeadLabel({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <span className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
      <Icon className="size-3.5 shrink-0" />
      {children}
    </span>
  );
}

/** A draft row carries a local key so React keeps each row's controls while rows are added and removed. */
type DraftRow = EventRow & { key: number };
let nextKey = 1;
const toDraft = (rules: NotificationRule[]): DraftRow[] =>
  groupRules(rules).map((r) => ({ ...r, targets: r.targets.map((t) => ({ ...t })), key: nextKey++ }));
const canonical = (rows: EventRow[]) => JSON.stringify(expandRows(rows));

/** One recipient line, in both columns, so a name and its Email / Bell sit side by side. */
const LINE = 'flex h-8 items-center';

/**
 * Email Configuration — one row per ticket event; each recipient on it has its
 * own Email / Bell. This is what the ticket emails and bells follow. Stored as
 * rules per distinct mode (`expandRows`), which the backend reads unchanged.
 * The whole table is a draft until Save.
 */
export default function EmailConfigurationPage() {
  const qc = useQueryClient();
  const { data: saved, isLoading } = useQuery<NotificationRule[]>({
    queryKey: ['notification-rules'],
    queryFn: async () => (await api.get('/api/notification-rules')).data,
  });

  const [rows, setRows] = useState<DraftRow[]>([]);
  // Re-hydrate when the saved *content* changes, not the object identity, so a
  // refetch on window focus doesn't wipe edits (adjusted during render).
  const savedKey = saved ? canonical(groupRules(saved)) : '';
  const [hydratedKey, setHydratedKey] = useState('');
  if (saved && savedKey !== hydratedKey) {
    setHydratedKey(savedKey);
    setRows(toDraft(saved));
  }

  const dirty = useMemo(() => !!saved && canonical(rows) !== savedKey, [rows, saved, savedKey]);

  const save = useMutation({
    mutationFn: async (rules: NotificationRule[]) => (await api.put('/api/notification-rules', { rules })).data,
    onSuccess: (data: NotificationRule[]) => {
      qc.setQueryData(['notification-rules'], data);
      toast.success('Email configuration saved');
    },
    onError: (e: { response?: { data?: { message?: string | string[] } } }) => {
      const m = e.response?.data?.message;
      toast.error(Array.isArray(m) ? m[0] : m || 'Could not save the email configuration');
    },
  });

  const patchRow = (key: number, change: Partial<EventRow>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...change } : r)));
  const patchTarget = (row: DraftRow, recipient: string, change: Partial<EventTarget>) =>
    patchRow(row.key, { targets: row.targets.map((t) => (t.recipient === recipient ? { ...t, ...change } : t)) });

  const toggleRecipient = (row: DraftRow, value: string) => {
    const has = row.targets.some((t) => t.recipient === value);
    patchRow(row.key, {
      targets: has
        ? row.targets.filter((t) => t.recipient !== value)
        : [...row.targets, { recipient: value, email: true, bell: false }],
    });
  };

  const usedEvents = new Set(rows.map((r) => r.event).filter(Boolean));

  const onSave = () => {
    for (const r of rows) {
      const name = NOTIFICATION_EVENTS.find((e) => e.value === r.event)?.label;
      if (!r.event) return toast.error('Pick an event for every row');
      if (!r.targets.length) return toast.error(`${name}: add at least one recipient`);
      const idle = r.targets.find((t) => !t.email && !t.bell);
      if (idle) return toast.error(`${name}: tick Email, Bell or both for ${recipientLabel(idle.recipient)}`);
    }
    save.mutate(expandRows(rows));
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Email Configuration</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Who is notified on each ticket event, and how. Ticket emails and bells follow this table.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {dirty && (
            <Button variant="outline" onClick={() => saved && setRows(toDraft(saved))} disabled={save.isPending}>
              Discard
            </Button>
          )}
          <Button onClick={onSave} disabled={!dirty || save.isPending}>
            {save.isPending ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={usedEvents.size >= NOTIFICATION_EVENTS.length}
          title={usedEvents.size >= NOTIFICATION_EVENTS.length ? 'Every event already has a row' : undefined}
          onClick={() => setRows((rs) => [...rs, { event: '', targets: [], key: nextKey++ }])}
        >
          <Plus className="size-4" /> Add row
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setRows(toDraft(DEFAULT_RULES))}>
          <RotateCcw className="size-4" /> Reset to defaults
        </Button>
      </div>

      <div className="overflow-hidden rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50 hover:bg-muted/50">
              <TableHead className="w-1/2 border-r"><HeadLabel icon={Zap}>Event</HeadLabel></TableHead>
              <TableHead className="w-px border-r whitespace-nowrap"><HeadLabel icon={Users}>Email recipient</HeadLabel></TableHead>
              <TableHead className="w-1/2 border-r whitespace-nowrap"><HeadLabel icon={Mail}>Communication mode</HeadLabel></TableHead>
              <TableHead className="w-px"><span className="text-xs font-semibold text-muted-foreground">Actions</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={4} className="py-8 text-center text-sm text-muted-foreground">Loading…</TableCell></TableRow>
            ) : rows.length === 0 ? (
              <TableRow><TableCell colSpan={4} className="py-8 text-center text-sm text-muted-foreground">No rows — add one, or reset to the defaults.</TableCell></TableRow>
            ) : (
              rows.map((row) => (
                <TableRow key={row.key}>
                  <TableCell className="border-r align-top">
                    <Select value={row.event || undefined} onValueChange={(v) => { if (v) patchRow(row.key, { event: v }); }}>
                      <SelectTrigger className="h-8 w-full border-0 bg-transparent px-1 shadow-none dark:bg-transparent"><SelectValue placeholder="Pick an event" /></SelectTrigger>
                      <SelectContent>
                        {/* Each event has one row, so an event another row holds is not offered. */}
                        {NOTIFICATION_EVENTS.filter((e) => e.value === row.event || !usedEvents.has(e.value)).map((e) => (
                          <SelectItem key={e.value} value={e.value}>{e.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell className="border-r align-top whitespace-nowrap">
                    <div className="flex flex-col gap-1">
                      {row.targets.map((t) => (
                        <div key={t.recipient} className={LINE}>
                          <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
                            {recipientLabel(t.recipient)}
                            <button
                              type="button"
                              onClick={() => toggleRecipient(row, t.recipient)}
                              className="rounded-full hover:bg-primary/20"
                              aria-label={`Remove ${recipientLabel(t.recipient)}`}
                            >
                              <X className="size-3" />
                            </button>
                          </span>
                        </div>
                      ))}
                      <div className={LINE}>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="outline" size="sm" className="h-7 px-2 text-xs">
                              <Plus className="size-3.5" /> {row.targets.length ? 'Edit' : 'Add recipient'}
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="start" className="w-52">
                            {NOTIFICATION_RECIPIENTS.map((r) => (
                              <DropdownMenuCheckboxItem
                                key={r.value}
                                checked={row.targets.some((t) => t.recipient === r.value)}
                                onSelect={(e) => e.preventDefault()}
                                onCheckedChange={() => toggleRecipient(row, r.value)}
                              >
                                {r.label}
                              </DropdownMenuCheckboxItem>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="border-r align-top">
                    <div className="flex flex-col gap-1">
                      {row.targets.map((t) => {
                        const emailOnly = EMAIL_ONLY_RECIPIENTS.includes(t.recipient);
                        return (
                          <div key={t.recipient} className={`${LINE} gap-4 whitespace-nowrap`}>
                            <label className="flex cursor-pointer items-center gap-1.5 text-sm">
                              <Checkbox checked={t.email} onCheckedChange={(v) => patchTarget(row, t.recipient, { email: v === true })} />
                              Email
                            </label>
                            <label
                              className={`flex items-center gap-1.5 text-sm ${emailOnly ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
                              title={emailOnly ? 'The helpdesk email is an address, not a user — it gets the email only' : undefined}
                            >
                              <Checkbox
                                checked={t.bell}
                                disabled={emailOnly}
                                onCheckedChange={(v) => patchTarget(row, t.recipient, { bell: v === true })}
                              />
                              Bell
                            </label>
                          </div>
                        );
                      })}
                    </div>
                  </TableCell>
                  <TableCell className="align-top">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8 text-muted-foreground hover:text-destructive"
                      onClick={() => setRows((rs) => rs.filter((r) => r.key !== row.key))}
                      title="Delete row"
                      aria-label="Delete row"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
