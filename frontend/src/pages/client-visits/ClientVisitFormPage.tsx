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
  const [visitDate, setVisitDate] = useState(new Date().toISOString().split('T')[0]);
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

  const { data: tickets = [] } = useQuery<TicketOption[]>({
    queryKey: ['tickets-options'],
    queryFn: async () => (await api.get('/api/tickets')).data,
  });

  // Assignments are per product+module+track; a contract-level row (productId
  // null) covers every product. Collapse them to one entry per person.
  const relevantConsultants = customerConsultants.filter(
    (c) => productId === 'none' || !c.productId || c.productId === productId,
  );
  const consultantOptions = Array.from(
    relevantConsultants
      .reduce((acc, c) => {
        if (!acc.has(c.userId)) acc.set(c.userId, c.username || c.userId);
        return acc;
      }, new Map<string, string>()),
    ([userId, username]) => ({ userId, username }),
  );

  // Tickets narrow to the chosen client once one is picked.
  const customerTickets = customerCompanyId
    ? tickets.filter((t) => !t.customerCompanyId || t.customerCompanyId === customerCompanyId)
    : tickets;

  // Keep the dependent picks honest when the client changes. Ticket now sits
  // above the client, so a blanket reset would wipe a deliberate pick — only
  // drop it when the chosen ticket belongs to a different client.
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
  useEffect(() => {
    if (!consultantsLoaded || !consultantId) return;
    if (!consultantOptions.some((c) => c.userId === consultantId)) {
      setConsultantId('');
    }
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
    if (!visitDate || !customerCompanyId || !consultantId || !hours || !purpose.trim()) {
      toast.error('Please fill in all required fields');
      return;
    }
    mutation.mutate({
      visitDate,
      customerCompanyId,
      consultantId,
      productId: productId === 'none' ? null : productId,
      hours: parseFloat(hours),
      purpose: purpose.trim(),
      notes,
      status,
      ticketId: ticketId === 'none' ? null : ticketId,
    });
  };

  return (
    <div className="w-full">
      <Button variant="ghost" size="sm" onClick={() => navigate('/client-visits')} className="mb-2 -ml-2">
        <ArrowLeft className="size-4" /> All client visits
      </Button>

      <div className="mb-4">
        <h1 className="text-2xl font-bold tracking-tight">{isEditing ? 'Edit Client Visit' : 'New Client Visit'}</h1>
        <p className="text-sm text-muted-foreground">
          Record a client visit. Fields marked <Req /> are required.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Client <Req /></Label>
            <Select value={customerCompanyId} onValueChange={pick(onCustomerChange)}>
              <SelectTrigger className="w-full"><SelectValue placeholder="Select client" /></SelectTrigger>
              <SelectContent>
                {customerCompanies.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Ticket</Label>
            <Select value={ticketId} onValueChange={pick(setTicketId)}>
              <SelectTrigger className="w-full"><SelectValue placeholder="Select ticket" /></SelectTrigger>
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
          <Label htmlFor="purpose">Purpose <Req /></Label>
          <Input
            id="purpose"
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
            placeholder="Short summary of why the visit happened"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="notes">Description</Label>
          <Textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={5} />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="visitDate">Visit Date <Req /></Label>
            <Input id="visitDate" type="date" value={visitDate} onChange={(e) => setVisitDate(e.target.value)} />
          </div>

          <div className="space-y-1.5">
            <Label>Product</Label>
            <Select value={productId} onValueChange={pick(setProductId)} disabled={!customerCompanyId}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={customerCompanyId ? 'Select product' : 'Select a client first'} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                {customerProducts.map((p) => (
                  <SelectItem key={p.productId} value={p.productId}>{p.productName ?? p.productId}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {customerCompanyId && customerProducts.length === 0 && (
              <p className="text-xs text-muted-foreground">No products assigned to this client.</p>
            )}
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
                No consultants assigned to this client{productId !== 'none' ? ' for this product' : ''}.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="hours">Hours <Req /></Label>
            <Input id="hours" type="number" min="0" step="0.5" value={hours} onChange={(e) => setHours(e.target.value)} />
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

        </div>

        <div className="flex justify-end gap-2 border-t pt-4">
          <Button type="button" variant="outline" onClick={() => navigate('/client-visits')}>Cancel</Button>
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </form>
    </div>
  );
}
