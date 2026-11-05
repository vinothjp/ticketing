import { useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Building2, X } from 'lucide-react';
import { toast } from 'sonner';
import api from '../lib/api';
import { assetUrl } from '@/lib/assetUrl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import type { Control } from 'react-hook-form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DEFAULT_DATE_FORMAT, DEFAULT_TIME_FORMAT, formatWithPattern, useDateFormat } from '@/lib/dateFormat';

interface License {
  plan: string; maxUsers: number; expiryDate: string;
  status: 'ACTIVE' | 'EXPIRED' | 'CANCELLED';
}
interface MyClientDetail {
  id: string; name: string; code: string; status: 'ACTIVE' | 'SUSPENDED' | 'TRIAL';
  contactEmail?: string | null; contactPhone?: string | null; logoUrl?: string | null;
  ticketReopenWindowDays: number;
  ticketAutoCloseDays: number;
  dateFormat?: string | null;
  timeFormat?: string | null;
  currency?: string | null;
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
  // The token pattern every date on the ticket screens is rendered with. Free
  // text rather than an enum — the choices come from the DATE_FORMAT option
  // list, which an admin may add to.
  dateFormat: z.string().min(1, 'Pick a date format'),
  timeFormat: z.string().min(1, 'Pick a time format'),
  currency: z.string().min(1, 'Pick a currency'),
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
      ticketReopenWindowDays: '30', ticketAutoCloseDays: '3',
      dateFormat: DEFAULT_DATE_FORMAT, timeFormat: DEFAULT_TIME_FORMAT, currency: 'USD',
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
      dateFormat: client.dateFormat || DEFAULT_DATE_FORMAT,
      timeFormat: client.timeFormat || DEFAULT_TIME_FORMAT,
      currency: client.currency || 'USD',
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
                  <dt className="text-muted-foreground">Status</dt>
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
              {/* One two-column grid down the whole form: identity full-width,
                  then the settings in pairs, with Currency spanning back to full
                  width so the column never ends on a lone half-row. `sm:` so it
                  collapses to a single column on a narrow screen. */}
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
                  <FormLabel className="mb-2 block">Status</FormLabel>
                  {/* A badge, not an input — the status is set by the platform
                      admin, so it sits at the input's own height rather than
                      floating at the top of a taller cell. */}
                  <div className="flex h-9 items-center">
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

              {/* The two ticket windows. Their inputs fill the cell rather than
                  carrying a max-width of their own, or the pair reads as ragged
                  against every other row. */}
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="ticketReopenWindowDays"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Ticket reopen window (days)</FormLabel>
                      <FormControl>
                        <Input type="number" min={1} max={3650} step={1} {...field} />
                      </FormControl>
                      <p className="text-xs text-muted-foreground">
                        How long after a ticket is resolved it can still be reopened. Past this
                        window the ticket screen asks the user to raise a new ticket instead.
                      </p>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="ticketAutoCloseDays"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Auto-close after (days)</FormLabel>
                      <FormControl>
                        <Input type="number" min={1} max={365} step={1} {...field} />
                      </FormControl>
                      <p className="text-xs text-muted-foreground">
                        How long a resolved ticket waits for the client's acknowledgement before
                        it closes itself. Only client tickets wait — internal ones are closed by staff.
                      </p>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* The three Organization-module option lists. Same control
                  throughout — only the list and the preview differ. */}
              <div className="grid gap-4 sm:grid-cols-2">
                <OptionListField
                  control={form.control}
                  name="dateFormat"
                  label="Date format"
                  listId={listId('DATE_FORMAT')}
                  preview={(code) => formatWithPattern(new Date(), code)}
                  hint="How every date on the ticket screens is written for this organization."
                />
                <OptionListField
                  control={form.control}
                  name="timeFormat"
                  label="Time format"
                  listId={listId('TIME_FORMAT')}
                  preview={(code) => formatWithPattern(new Date(), code)}
                  hint="Appended to the date wherever a stamp carries the time too."
                />
              </div>

              <OptionListField
                control={form.control}
                name="currency"
                label="Currency"
                listId={listId('CURRENCY')}
                hint="The currency this organization trades in. Recorded on the organization; no screen reads it yet."
              />

              <p className="text-xs text-muted-foreground">
                Date format, time format and currency come from the{' '}
                <span className="font-medium">Organization</span> module on the Option List
                screen &mdash; add a value there and it appears here.
              </p>

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
  hint: string;
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
            <p className="text-xs text-muted-foreground">{hint}</p>
            <FormMessage />
          </FormItem>
        );
      }}
    />
  );
}
