import { useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Building2, Info, X } from 'lucide-react';
import { toast } from 'sonner';
import api from '../lib/api';
import { assetUrl } from '@/lib/assetUrl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import type { Control } from 'react-hook-form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Combobox } from '@/components/ui/combobox';
import type { ComboboxOption } from '@/components/ui/combobox';
import { DEFAULT_DATE_FORMAT, DEFAULT_TIME_FORMAT, formatWithPattern, useDateFormat } from '@/lib/dateFormat';

/** The tenant's default zone, as the server's `Client.timeZone` default. */
const DEFAULT_TIME_ZONE = 'Asia/Kolkata';

/** "GMT+05:30" for a zone, read now (so daylight saving shows as it stands today). */
const zoneOffset = (tz: string) => {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' })
      .formatToParts(new Date()).find((p) => p.type === 'timeZoneName')?.value ?? '';
  } catch {
    return '';
  }
};

let zoneCache: ComboboxOption[] | null = null;
/** Every IANA zone the browser knows, typeable; a stored zone outside the list is still offered. */
function timeZoneOptions(current?: string): ComboboxOption[] {
  if (!zoneCache) {
    const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
    const zones = intl.supportedValuesOf?.('timeZone') ?? [DEFAULT_TIME_ZONE, 'UTC'];
    zoneCache = zones.map((z) => ({ value: z, label: z.replace(/_/g, ' '), hint: zoneOffset(z) }));
  }
  return current && !zoneCache.some((o) => o.value === current)
    ? [{ value: current, label: current, hint: zoneOffset(current) }, ...zoneCache]
    : zoneCache;
}

interface License {
  plan: string; maxUsers: number; expiryDate: string;
  status: 'ACTIVE' | 'EXPIRED' | 'CANCELLED';
}
interface MyClientDetail {
  id: string; name: string; code: string; status: 'ACTIVE' | 'SUSPENDED' | 'TRIAL';
  contactEmail?: string | null; contactPhone?: string | null; logoUrl?: string | null;
  ticketReopenWindowDays: number;
  ticketAutoCloseDays: number;
  ticketMaxReopens: number;
  dateFormat?: string | null;
  timeFormat?: string | null;
  timeZone?: string | null;
  currency?: string | null;
  criticalTicketEmail?: string | null;
  criticalTicketAlerts?: boolean;
  helpdeskEmail?: string | null;
  ticketMaxOpenPerAgent?: number | null;
  defaultIssueType?: string | null;
  license: License | null; _count: { users: number };
}

/** A row of the Option List registry — only the fields this screen needs. */
interface OptionListRow { id: string; code: string; }
/** One value of a list, in the Option List screen's vocabulary. */
interface OptionValue { id: string; code: string; description: string; isActive: boolean; seq: number; }

const orgSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  contactEmail: z.string().email('Enter a valid email').optional().or(z.literal('')),
  contactPhone: z.string().optional(),
  // Days a resolved ticket stays reopenable. Kept as a string so the input can be
  // cleared while typing; coerced on submit.
  ticketReopenWindowDays: z
    .string()
    .refine((v) => Number.isInteger(Number(v)) && Number(v) >= 1 && Number(v) <= 3650, 'Enter 1 to 3650 days'),
  // Days a resolved ticket waits for the client's acknowledgement before it
  // closes itself. Same string-then-coerce treatment as the reopen window.
  ticketAutoCloseDays: z
    .string()
    .refine((v) => Number.isInteger(Number(v)) && Number(v) >= 1 && Number(v) <= 365, 'Enter 1 to 365 days'),
  // How many times one ticket may be reopened. 0 = never.
  ticketMaxReopens: z
    .string()
    .refine((v) => v.trim() !== '' && Number.isInteger(Number(v)) && Number(v) >= 0 && Number(v) <= 100, 'Enter 0 to 100'),
  // The token pattern every date on the ticket screens is rendered with. Free
  // text rather than an enum — the choices come from the DATE_FORMAT option
  // list, which an admin may add to.
  dateFormat: z.string().min(1, 'Pick a date format'),
  timeFormat: z.string().min(1, 'Pick a time format'),
  // IANA zone ticket emails print their times in (the server runs on UTC).
  timeZone: z.string().min(1, 'Pick a time zone'),
  currency: z.string().min(1, 'Pick a currency'),
  // Critical ticket admin: CC'd on every email about a Critical ticket, and the switch.
  criticalTicketEmail: z.string().email('Enter a valid email').optional().or(z.literal('')),
  criticalTicketAlerts: z.boolean(),
  // CC'd on every ticket email.
  helpdeskEmail: z.string().email('Enter a valid email').optional().or(z.literal('')),
  // Ticket auto-assignment: open tickets an agent may hold before they count as
  // busy. Blank = no limit.
  ticketMaxOpenPerAgent: z
    .string()
    .refine((v) => v.trim() === '' || (Number.isInteger(Number(v)) && Number(v) >= 1 && Number(v) <= 1000), 'Enter 1 to 1000, or leave blank for no limit'),
  // The issue type a ticket with none is routed on.
  defaultIssueType: z.enum(['TECHNICAL', 'FUNCTIONAL', 'OTHERS']),
}).refine((v) => !v.criticalTicketAlerts || !!v.criticalTicketEmail?.trim(), {
  message: 'Enter the email that critical tickets go to',
  path: ['criticalTicketEmail'],
});
type OrgValues = z.infer<typeof orgSchema>;

const statusVariant: Record<MyClientDetail['status'], 'success' | 'destructive' | 'secondary'> = {
  ACTIVE: 'success',
  SUSPENDED: 'destructive',
  TRIAL: 'secondary',
};

export default function OrganizationPage() {
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  // The saved format, so the licence expiry reads the same as every other date
  // in the tenant. It follows the dropdown one save behind, not while typing.
  const { fmtDate } = useDateFormat();

  const { data: client, isLoading } = useQuery<MyClientDetail>({
    queryKey: ['my-client-detail'],
    queryFn: async () => (await api.get('/api/my-client')).data,
  });

  const form = useForm<OrgValues>({
    resolver: zodResolver(orgSchema),
    defaultValues: {
      name: '', contactEmail: '', contactPhone: '',
      ticketReopenWindowDays: '30', ticketAutoCloseDays: '3', ticketMaxReopens: '3',
      dateFormat: DEFAULT_DATE_FORMAT, timeFormat: DEFAULT_TIME_FORMAT, timeZone: DEFAULT_TIME_ZONE, currency: 'USD',
      criticalTicketEmail: '', criticalTicketAlerts: false, helpdeskEmail: '',
      ticketMaxOpenPerAgent: '10', defaultIssueType: 'TECHNICAL',
    },
  });

  useEffect(() => {
    if (!client) return;
    form.reset({
      name: client.name,
      contactEmail: client.contactEmail ?? '',
      contactPhone: client.contactPhone ?? '',
      ticketReopenWindowDays: String(client.ticketReopenWindowDays ?? 30),
      ticketAutoCloseDays: String(client.ticketAutoCloseDays ?? 3),
      ticketMaxReopens: String(client.ticketMaxReopens ?? 3),
      dateFormat: client.dateFormat || DEFAULT_DATE_FORMAT,
      timeFormat: client.timeFormat || DEFAULT_TIME_FORMAT,
      timeZone: client.timeZone || DEFAULT_TIME_ZONE,
      currency: client.currency || 'USD',
      criticalTicketEmail: client.criticalTicketEmail ?? '',
      criticalTicketAlerts: !!client.criticalTicketAlerts,
      helpdeskEmail: client.helpdeskEmail ?? '',
      ticketMaxOpenPerAgent: client.ticketMaxOpenPerAgent == null ? '' : String(client.ticketMaxOpenPerAgent),
      defaultIssueType: (['TECHNICAL', 'FUNCTIONAL', 'OTHERS'] as const).find((t) => t === client.defaultIssueType) ?? 'TECHNICAL',
    });
  }, [client, form]);

  // Every dropdown on this screen is an Organization-module option list, so the
  // choices come from the registry rather than a constant here: an admin adds a
  // value on the Option List screen and it is offered immediately. Read through
  // `GET /api/option-lists` because that is what lazily seeds a tenant's system
  // lists — a tenant that has never opened that screen still finds the values.
  const { data: lists = [] } = useQuery<OptionListRow[]>({
    queryKey: ['option-lists'],
    queryFn: async () => (await api.get('/api/option-lists')).data,
  });
  const listId = (code: string) => lists.find((l) => l.code === code)?.id;

  const updateMutation = useMutation({
    mutationFn: (values: OrgValues) =>
      api.put('/api/my-client', {
        ...values,
        contactEmail: values.contactEmail || undefined,
        contactPhone: values.contactPhone || undefined,
        ticketReopenWindowDays: Number(values.ticketReopenWindowDays),
        ticketAutoCloseDays: Number(values.ticketAutoCloseDays),
        ticketMaxReopens: Number(values.ticketMaxReopens),
        // Empty clears it on the server.
        criticalTicketEmail: values.criticalTicketEmail?.trim() ?? '',
        helpdeskEmail: values.helpdeskEmail?.trim() ?? '',
        // Blank = no limit.
        ticketMaxOpenPerAgent: values.ticketMaxOpenPerAgent.trim() === '' ? null : Number(values.ticketMaxOpenPerAgent),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my-client-detail'] });
      qc.invalidateQueries({ queryKey: ['my-client'] });
      toast.success('Organization details updated');
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error updating organization'),
  });

  const uploadLogoMutation = useMutation({
    mutationFn: (file: File) => {
      const formData = new FormData();
      formData.append('logo', file);
      return api.post('/api/my-client/logo', formData);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my-client-detail'] });
      qc.invalidateQueries({ queryKey: ['my-client'] });
      toast.success('Logo updated');
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error uploading logo'),
  });

  const removeLogoMutation = useMutation({
    mutationFn: () => api.delete('/api/my-client/logo'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my-client-detail'] });
      qc.invalidateQueries({ queryKey: ['my-client'] });
      toast.success('Logo removed');
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error removing logo'),
  });

  if (isLoading || !client) return <p className="text-muted-foreground">Loading...</p>;

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-foreground">Organization</h1>

      <Card>
        <CardHeader><CardTitle>Organization Information</CardTitle></CardHeader>
        <CardContent>
          {/* License is four read-only rows, so it is *floated* rather than given
              a column of its own: the fields beside it are narrowed to fit, and
              everything past its bottom edge reclaims the full width instead of
              running down a half-page with dead space to its right.

              This works without measuring anything because every row below is a
              grid or flex container, and those establish an independent
              formatting context — a float cannot intrude into one, so each row
              either sits beside the panel or clears it, on its own. Full width
              and unfloated below `sm`, where there is no room to sit beside. */}
          <aside className="mb-6 rounded-lg border bg-muted/20 p-4 sm:float-right sm:ml-6 sm:w-72">
            <h2 className="mb-3 text-sm font-semibold text-foreground">License</h2>
            {client.license ? (
              <dl className="space-y-3 text-sm">
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Plan</dt>
                  <dd className="font-medium text-foreground">{client.license.plan}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Seats</dt>
                  <dd className="font-medium text-foreground">{client._count.users} / {client.license.maxUsers}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Expiry</dt>
                  <dd className="font-medium text-foreground">{fmtDate(client.license.expiryDate)}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">License status</dt>
                  <dd>
                    <Badge variant={client.license.status === 'ACTIVE' ? 'success' : 'destructive'}>
                      {client.license.status}
                    </Badge>
                  </dd>
                </div>
              </dl>
            ) : (
              <p className="text-sm text-muted-foreground">
                No license on file. Contact your platform administrator.
              </p>
            )}
            <p className="mt-3 text-xs text-muted-foreground">
              Managed by your platform administrator.
            </p>
          </aside>

          <div className="mb-6 flex items-center gap-4">
            {client.logoUrl ? (
              <img src={assetUrl(client.logoUrl)!} alt={client.name} className="size-16 rounded-lg border object-cover" />
            ) : (
              <div className="flex size-16 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Building2 className="size-7" />
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) uploadLogoMutation.mutate(file);
                  e.target.value = '';
                }}
              />
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadLogoMutation.isPending}
                >
                  {uploadLogoMutation.isPending ? 'Uploading...' : 'Change Logo'}
                </Button>
                {client.logoUrl && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => removeLogoMutation.mutate()}
                    disabled={removeLogoMutation.isPending}
                  >
                    <X className="size-4" /> Remove
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">PNG or JPG, up to 2MB.</p>
            </div>
          </div>

          <Form {...form}>
            <form onSubmit={form.handleSubmit((v) => updateMutation.mutate(v))} className="space-y-4">
              {/* Identity full-width, contacts in a pair, then the ticket
                  settings and the three option lists three to a row. `sm:` so
                  it collapses to a single column on a narrow screen. */}
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name</FormLabel>
                    <FormControl><Input {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <FormLabel className="mb-2 block">Code</FormLabel>
                  <Input value={client.code} disabled />
                </div>
                <div>
                  {/* A badge, not an input — the status is set by the platform
                      admin, so it sits on the label's own line. */}
                  <div className="flex items-center gap-2">
                    <FormLabel>Organization status</FormLabel>
                    <Badge variant={statusVariant[client.status]}>{client.status}</Badge>
                  </div>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="contactEmail"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Contact Email</FormLabel>
                      <FormControl><Input type="email" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="contactPhone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Contact Phone</FormLabel>
                      <FormControl><Input {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* The ticket reopen/close settings, three to a row. Their inputs
                  fill the cell rather than carrying a max-width of their own, or
                  the row reads as ragged against every other one. */}
              <div className="grid gap-4 sm:grid-cols-3">
                <FormField
                  control={form.control}
                  name="ticketReopenWindowDays"
                  render={({ field }) => (
                    <FormItem>
                      <LabelWithHint hint="Days after it is resolved that a ticket can still be reopened. After that, the user raises a new ticket.">Ticket reopen window (days)</LabelWithHint>
                      <FormControl>
                        <Input type="number" min={1} max={3650} step={1} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="ticketAutoCloseDays"
                  render={({ field }) => (
                    <FormItem>
                      <LabelWithHint hint="Days a resolved client ticket waits for acknowledgement before closing itself. Internal tickets are closed by staff.">Auto-close after (days)</LabelWithHint>
                      <FormControl>
                        <Input type="number" min={1} max={365} step={1} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="ticketMaxReopens"
                  render={({ field }) => (
                    <FormItem>
                      <LabelWithHint hint="How many times one ticket can be reopened. Once used up, the user raises a new ticket.">Ticket reopens allowed</LabelWithHint>
                      <FormControl>
                        <Input type="number" min={0} max={100} step={1} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* The three Organization-module option lists. Same control
                  throughout — only the list and the preview differ. */}
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <OptionListField
                  control={form.control}
                  name="dateFormat"
                  label="Date format"
                  listId={listId('DATE_FORMAT')}
                  preview={(code) => formatWithPattern(new Date(), code)}
                />
                <OptionListField
                  control={form.control}
                  name="timeFormat"
                  label="Time format"
                  listId={listId('TIME_FORMAT')}
                  preview={(code) => formatWithPattern(new Date(), code)}
                />
                <OptionListField
                  control={form.control}
                  name="currency"
                  label="Currency"
                  listId={listId('CURRENCY')}
                />
                <FormField
                  control={form.control}
                  name="timeZone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Time zone</FormLabel>
                      <Combobox
                        value={field.value}
                        options={timeZoneOptions(field.value)}
                        onChange={(v) => { if (v) field.onChange(v); }}
                        placeholder="Pick a time zone"
                        emptyText="No matching time zone"
                        maxRows={8}
                      />
                      <p className="text-xs text-muted-foreground">Times in ticket emails are shown in this zone.</p>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* Critical ticket admin: the address, with the switch that turns
                  the emails on sitting beside its label. */}
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="criticalTicketEmail"
                  render={({ field }) => (
                    <FormItem>
                      <div className="flex items-center gap-3">
                        <FormLabel>Critical ticket admin</FormLabel>
                        <FormField
                          control={form.control}
                          name="criticalTicketAlerts"
                          render={({ field: alerts }) => (
                            <div className="flex items-center gap-1.5">
                              <Switch checked={alerts.value} onCheckedChange={alerts.onChange} aria-label="CC critical ticket emails" />
                              <span className="text-xs text-muted-foreground">{alerts.value ? 'On' : 'Off'}</span>
                            </div>
                          )}
                        />
                      </div>
                      <FormControl>
                        <Input type="email" placeholder="e.g. support-lead@yourcompany.com" {...field} />
                      </FormControl>
                      <p className="text-xs text-muted-foreground">
                        This address is CC'd on every email about a Critical ticket — a copy of the
                        ticket email itself, not a separate alert.
                      </p>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="helpdeskEmail"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Helpdesk email</FormLabel>
                      <FormControl>
                        <Input type="email" placeholder="e.g. helpdesk@yourcompany.com" {...field} />
                      </FormControl>
                      <p className="text-xs text-muted-foreground">
                        CC'd on every ticket email — creation, assignment, approvals, resolution, closing and
                        reopening. Leave blank for none.
                      </p>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* Ticket auto-assignment, for clients that have it switched on. */}
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="ticketMaxOpenPerAgent"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Max open tickets per agent</FormLabel>
                      <FormControl>
                        <Input type="number" min={1} max={1000} step={1} placeholder="No limit" {...field} />
                      </FormControl>
                      <p className="text-xs text-muted-foreground">
                        Auto-assignment skips an agent holding this many open tickets (On Hold, Awaiting and
                        Approval Pending don't count) and gives the ticket to the agent with the fewest.
                        Leave blank for no limit. Manual assignment is never limited.
                      </p>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="defaultIssueType"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Default issue type</FormLabel>
                      <Select value={field.value} onValueChange={(v) => { if (v) field.onChange(v); }}>
                        <FormControl>
                          <SelectTrigger className="w-full"><SelectValue placeholder="Pick an issue type" /></SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="TECHNICAL">Technical</SelectItem>
                          <SelectItem value="FUNCTIONAL">Functional</SelectItem>
                          <SelectItem value="OTHERS">Other</SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        A ticket is auto-assigned on this issue type when its template has no Issue type field,
                        or the field was left blank.
                      </p>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* Right-aligned, so the eye lands on it after reading down the
                  right-hand column rather than jumping back to the margin. */}
              <div className="flex justify-end pt-2">
                <Button type="submit" disabled={updateMutation.isPending}>
                  {updateMutation.isPending ? 'Saving...' : 'Save'}
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * One Organization setting whose choices are an option list.
 *
 * The list is fetched by id rather than passed in, so each field owns its own
 * query and a slow one never holds up the others. The saved value is always
 * offered even when it is no longer in the list: a Radix Select silently resets
 * a value it cannot match and fires an empty change, which would overwrite the
 * tenant's setting with a blank while the list is still in flight.
 */
function OptionListField({
  control,
  name,
  label,
  listId,
  preview,
  hint,
}: {
  control: Control<OrgValues>;
  name: 'dateFormat' | 'timeFormat' | 'currency';
  label: string;
  listId?: string;
  /** Renders the value as it will actually be seen, beside the code. */
  preview?: (code: string) => string;
  hint?: string;
}) {
  const { data: values = [] } = useQuery<OptionValue[]>({
    queryKey: ['option-list-values', listId],
    queryFn: async () => (await api.get(`/api/option-lists/${listId}/values`)).data,
    enabled: !!listId,
  });

  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => {
        const options = [
          ...values.filter((v) => v.isActive).sort((a, b) => a.seq - b.seq),
          ...(field.value && !values.some((v) => v.code === field.value)
            ? [{ id: field.value, code: field.value, description: field.value, isActive: true, seq: 999 }]
            : []),
        ];
        return (
          <FormItem>
            <FormLabel>{label}</FormLabel>
            {/* A real pick is never empty — ignore the empty change Radix fires
                when it resets a value it cannot yet match. */}
            <Select
              value={field.value || undefined}
              onValueChange={(v) => { if (v) field.onChange(v); }}
            >
              <FormControl>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={`Pick a ${label.toLowerCase()}`} />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                {options.map((v) => (
                  <SelectItem key={v.id} value={v.code}>
                    <span className="tabular-nums">{v.code}</span>
                    {preview && <span className="ml-2 text-muted-foreground">{preview(v.code)}</span>}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
            <FormMessage />
          </FormItem>
        );
      }}
    />
  );
}

/** A field label with its explanation behind an info icon, shown on hover. */
function LabelWithHint({ children, hint }: { children: React.ReactNode; hint: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <FormLabel>{children}</FormLabel>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" aria-label="What this means" className="text-muted-foreground hover:text-foreground">
              <Info className="size-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent>{hint}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}
