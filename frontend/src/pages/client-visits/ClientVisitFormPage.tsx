import { useState, useEffect } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import api from '../../lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import type {
  ClientVisit,
  CustomerCompanyOption,
  CustomerProductOption,
  CustomerConsultantOption,
  TicketOption,
  UserOption,
} from './clientVisitsMeta';
import {
  VISIT_STATUSES,
  VISIT_STATUS_LABELS,
} from './clientVisitsMeta';

const Req = () => <span className="text-destructive">*</span>;

/**
 * Radix resets a controlled Select whose value isn't among its items and emits
 * `onValueChange('')`. On the edit form the saved product/consultant are
 * restored before their option lists have finished loading, so that reset would
 * wipe the values we just hydrated. A real user pick is never empty, so ignore
 * empty emissions and let the value stand until its options arrive.
 */
const pick = (set: (v: string) => void) => (v: string) => { if (v) set(v); };

export function ClientVisitFormPage() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isEditing = !!id;

  // Opened from a client / product / ticket screen — start there.
  const preset = (key: string, fallback = '') => (isEditing ? fallback : searchParams.get(key) || fallback);

  const [purpose, setPurpose] = useState('');
  const [notes, setNotes] = useState('');
  const todayIso = new Date().toISOString().split('T')[0];
  const [visitDate, setVisitDate] = useState(todayIso);
  const [customerCompanyId, setCustomerCompanyId] = useState(() => preset('customerCompanyId'));
  const [productId, setProductId] = useState(() => preset('productId', 'none'));
  const [consultantId, setConsultantId] = useState('');
  const [hours, setHours] = useState('');
  const [status, setStatus] = useState<string>(VISIT_STATUSES[0]);
  const [ticketId, setTicketId] = useState(() => preset('ticketId', 'none'));

  const { data: visit } = useQuery<ClientVisit>({
    queryKey: ['client-visit', id],
    queryFn: async () => (await api.get(`/api/client-visits/${id}`)).data,
    enabled: isEditing,
  });

  useEffect(() => {
    if (!visit) return;
    setPurpose(visit.purpose || '');
    setNotes(visit.notes || '');
    setVisitDate(visit.visitDate ? visit.visitDate.split('T')[0] : '');
    setCustomerCompanyId(visit.customerCompanyId || '');
    setProductId(visit.productId || 'none');
    setConsultantId(visit.consultantId || '');
    setHours(visit.hours != null ? String(visit.hours) : '');
    // Fall back if the stored status isn't one of the current three — an
    // unrecognised value has no matching item and would render a blank box.
    setStatus((VISIT_STATUSES as readonly string[]).includes(visit.status) ? visit.status : VISIT_STATUSES[0]);
    setTicketId(visit.ticketId || 'none');
  }, [visit]);

  const { data: customerCompanies = [] } = useQuery<CustomerCompanyOption[]>({
    queryKey: ['customer-companies'],
    queryFn: async () => (await api.get('/api/customer-companies')).data,
  });

  /**
   * Whether the picked client is on per-product coverage. Their visits draw down
   * the named product's own allowance, so the product is required; a client on one
   * shared contract pools every visit, so it stays optional. The backend enforces
   * the same rule — this just stops the user reaching a 400.
   */
  // A visit the consultant sent back: the admin's job here is to give it a new
  // date, so the same date is refused and the form says what happens next.
  const originalDate = visit?.visitDate ? visit.visitDate.split('T')[0] : '';
  const awaitingNewDate = visit?.status === 'RESCHEDULE_REQUESTED';

  const selectedCompany = customerCompanies.find((c) => c.id === customerCompanyId);
  const productRequired = selectedCompany?.contractScope === 'PRODUCT';

  // Product + consultant choices are whatever this client actually has — the
  // products assigned to them and the consultants assigned to them on the
  // client screen, not the full catalogue or every staff user.
  const { data: customerProducts = [] } = useQuery<CustomerProductOption[]>({
    queryKey: ['customer-purchased-products', customerCompanyId],
    queryFn: async () => (await api.get(`/api/customer-companies/${customerCompanyId}/purchased-products`)).data,
    enabled: !!customerCompanyId,
  });

  const { data: customerConsultants = [], isSuccess: consultantsLoaded } = useQuery<CustomerConsultantOption[]>({
    queryKey: ['customer-consultants', customerCompanyId],
    queryFn: async () => (await api.get(`/api/customer-companies/${customerCompanyId}/consultants`)).data,
    enabled: !!customerCompanyId,
  });

  // Every internal staff member — the fallback when the visit isn't about a
  // product, so it can't be limited to the client's product consultants.
  const { data: staff = [] } = useQuery<UserOption[]>({
    queryKey: ['users'],
    queryFn: async () => (await api.get('/api/users')).data,
  });

  const { data: tickets = [] } = useQuery<TicketOption[]>({
    queryKey: ['tickets-options'],
    queryFn: async () => (await api.get('/api/tickets')).data,
  });

  // A visit isn't necessarily about a product — it can be a general call or a
  // ticket follow-up — so the consultant list is only narrowed once a product is
  // actually picked. With no product, any internal staff member can be sent.
  //
  // With a product: the client's own assignments for it, where a contract-level
  // row (productId null) covers every product. Collapsed to one entry per person.
  const productPicked = productId !== 'none';
  const consultantOptions = productPicked
    ? Array.from(
        customerConsultants
          .filter((c) => !c.productId || c.productId === productId)
          .reduce((acc, c) => {
            if (!acc.has(c.userId)) acc.set(c.userId, c.username || c.userId);
            return acc;
          }, new Map<string, string>()),
        ([userId, username]) => ({ userId, username }),
      )
    : staff
        .filter((u) => u.isActive !== false)
        .map((u) => ({ userId: u.id, username: u.username }));

  // Tickets narrow to the chosen client once one is picked.
  const customerTickets = customerCompanyId
    ? tickets.filter((t) => !t.customerCompanyId || t.customerCompanyId === customerCompanyId)
    : tickets;

  // Options carry "TCK-000099 - subject" so the choice is unambiguous, but a long
  // subject would blow out the closed trigger. Show just the number there.
  // Looked up against the unfiltered list so an edit form still resolves the
  // saved ticket while the client-scoped filter is settling.
  const ticketLabel = ticketId === 'none'
    ? 'None'
    : tickets.find((t) => t.id === ticketId)?.ticketNumber ?? '';

  // Keep the dependent picks honest when the client changes. A blanket reset
  // would wipe a deliberate ticket pick — only drop it when the chosen ticket
  // belongs to a different client.
  const onCustomerChange = (next: string) => {
    setCustomerCompanyId(next);
    setProductId('none');
    setConsultantId('');
    const picked = tickets.find((t) => t.id === ticketId);
    if (picked?.customerCompanyId && picked.customerCompanyId !== next) {
      setTicketId('none');
    }
  };

  // Narrowing by product can drop the chosen consultant out of the list. Only
  // once the list has actually loaded — mid-hydration it is still empty, and
  // clearing then would discard the consultant restored from the saved visit.
  //
  // Consultant sits above Product on the form, so this clears a field the user
  // already filled in from one they touched later. Say so rather than letting
  // the pick quietly disappear.
  useEffect(() => {
    // Only narrowing can invalidate a pick, and only a product narrows.
    if (!productPicked || !consultantsLoaded || !consultantId) return;
    if (consultantOptions.some((c) => c.userId === consultantId)) return;
    const dropped = customerConsultants.find((c) => c.userId === consultantId)?.username
      ?? staff.find((u) => u.id === consultantId)?.username;
    setConsultantId('');
    toast.info(
      dropped
        ? `${dropped} isn't assigned to this product — pick a consultant again.`
        : 'Consultant cleared — pick one for this product.',
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId, customerConsultants, consultantsLoaded]);

  const mutation = useMutation({
    mutationFn: async (data: any) => {
      const res = isEditing
        ? await api.patch(`/api/client-visits/${id}`, data)
        : await api.post('/api/client-visits', data);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['client-visits'] });
      queryClient.invalidateQueries({ queryKey: ['client-visit', id] });
      toast.success(`Client visit ${isEditing ? 'updated' : 'created'} successfully`);
      navigate('/client-visits');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'An error occurred');
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!visitDate || !customerCompanyId || !consultantId || !purpose.trim()) {
      toast.error('Please fill in all required fields');
      return;
    }
    if (status !== 'VISITED' && visitDate < todayIso) {
      toast.error('A visit that has not happened yet cannot be scheduled in the past');
      return;
    }
    if (awaitingNewDate && visitDate === originalDate) {
      toast.error('Pick a date other than the one this visit already has');
      return;
    }
    if (productRequired && productId === 'none') {
      toast.error(`${selectedCompany?.name ?? 'This client'} is on per-product coverage — pick the product this visit is booked against`);
      return;
    }
    mutation.mutate({
      visitDate,
      customerCompanyId,
      consultantId,
      productId: productId === 'none' ? null : productId,
      // Optional when an admin books a visit — nobody knows the hours until the
      // consultant reports back, and the report dialog is where they are required.
      hours: hours === '' ? 0 : parseFloat(hours),
      purpose: purpose.trim(),
      notes,
      status,
      ticketId: ticketId === 'none' ? null : ticketId,
    });
  };

  return (
    <div className="w-full">
      <Button variant="ghost" size="sm" onClick={() => navigate('/client-visits')} className="mb-1 -ml-2">
        <ArrowLeft className="size-4" /> All client visits
      </Button>

      <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{isEditing ? 'Edit Client Visit' : 'New Client Visit'}</h1>
          <p className="text-sm text-muted-foreground">
            Record a client visit. Fields marked <Req /> are required.
          </p>
        </div>

        {/* Client scopes every other choice on this form, so it leads from the
            header rather than sitting in the grid as one field among many. */}
        <div className="flex items-center gap-2">
          <Label htmlFor="client" className="whitespace-nowrap">Client <Req /></Label>
          <Select value={customerCompanyId} onValueChange={pick(onCustomerChange)}>
            <SelectTrigger id="client" className="w-[260px]">
              <SelectValue placeholder="Select client" />
            </SelectTrigger>
            <SelectContent>
              {customerCompanies.map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-[13fr_7fr]">
          <div className="space-y-1.5">
            <Label htmlFor="purpose">Purpose <Req /></Label>
            <Input
              id="purpose"
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              placeholder="Short summary of why the visit happened"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Consultant <Req /></Label>
            <Select value={consultantId} onValueChange={pick(setConsultantId)} disabled={!customerCompanyId}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={customerCompanyId ? 'Select consultant' : 'Select a client first'} />
              </SelectTrigger>
              <SelectContent>
                {consultantOptions.map((c) => (
                  <SelectItem key={c.userId} value={c.userId}>{c.username}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {customerCompanyId && consultantOptions.length === 0 && (
              <p className="text-xs text-muted-foreground">
                {productPicked
                  ? 'No consultants assigned to this client for this product.'
                  : 'No staff available.'}
              </p>
            )}
          </div>
        </div>

        {/* When / how much / how it went, then what it was about. Five columns on
            a wide screen, folding to three then two as it narrows.
            Weighted 18/12/20/30/20: a date and an hours figure are short and
            fixed-width, so the space they give up goes to the product name,
            which is the longest value in the row. */}
        <div className="grid gap-4 grid-cols-2 md:grid-cols-3 xl:grid-cols-[9fr_6fr_10fr_15fr_10fr]">
          <div className="space-y-1.5">
            <Label htmlFor="visitDate">Visit date <Req /></Label>
            {/* A visit still to come cannot be booked in the past; a VISITED row
                records what already happened, so back-dating that one is fine. */}
            <Input
              id="visitDate"
              type="date"
              min={status === 'VISITED' ? undefined : todayIso}
              value={visitDate}
              onChange={(e) => setVisitDate(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="hours">Hours</Label>
            <Input id="hours" type="number" min="0" step="0.5" value={hours} onChange={(e) => setHours(e.target.value)} placeholder="Set by the consultant" />
          </div>

          <div className="space-y-1.5">
            <Label>Status <Req /></Label>
            <Select value={status} onValueChange={pick(setStatus)}>
              <SelectTrigger className="w-full"><SelectValue placeholder="Select status" /></SelectTrigger>
              <SelectContent>
                {VISIT_STATUSES.map((vs) => (
                  <SelectItem key={vs} value={vs}>{VISIT_STATUS_LABELS[vs]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Product {productRequired && <Req />}</Label>
            <Select value={productId} onValueChange={pick(setProductId)} disabled={!customerCompanyId}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={customerCompanyId ? 'Select product' : 'Select a client first'} />
              </SelectTrigger>
              <SelectContent>
                {/* Only a pooled customer contract can absorb a visit with no
                    product; on per-product coverage there is nowhere to book it. */}
                {!productRequired && <SelectItem value="none">None</SelectItem>}
                {customerProducts.map((p) => (
                  <SelectItem key={p.productId} value={p.productId}>{p.productName ?? p.productId}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {customerCompanyId && customerProducts.length === 0 ? (
              <p className="text-xs text-muted-foreground">No products assigned to this client.</p>
            ) : productRequired ? (
              <p className="text-xs text-muted-foreground">
                This client is on per-product coverage — the visit is deducted from this product's allowance.
              </p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label>Related ticket</Label>
            <Select value={ticketId} onValueChange={pick(setTicketId)}>
              {/* min-w-0 lets the value span shrink inside the flex trigger so
                  `truncate` can clip it instead of pushing the chevron out. */}
              <SelectTrigger className="w-full [&>span]:min-w-0 [&>span]:truncate">
                <SelectValue placeholder="Optional">{ticketLabel}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                {customerTickets.map((t) => (
                  <SelectItem key={t.id} value={t.id}>{t.ticketNumber} - {t.subject}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="notes">Description</Label>
          {/* 20% taller than the 3 rows it falls back to: 3.6 lines at text-sm's
              1.25rem line-height, plus py-2 and the 1px borders. */}
          <Textarea
            id="notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="h-[calc(3.6*1.25rem_+_1rem_+_2px)]"
            placeholder="Add visit notes…"
          />
        </div>

        <div className="flex justify-end gap-2 border-t pt-3">
          <Button type="button" variant="outline" onClick={() => navigate('/client-visits')}>Cancel</Button>
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? 'Saving…' : 'Save visit'}
          </Button>
        </div>
      </form>
    </div>
  );
}
