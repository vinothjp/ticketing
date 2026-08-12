import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import api from '../../lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { OptionSelect } from './OptionSelect';

const emptyDraft = {
  title: '', description: '', customerCompanyId: '', customer: '',
  objective: '', reasonForCr: '', benefitToCustomer: '',
  projectName: '', priority: '', crType: '',
};

const Req = () => <span className="text-destructive">*</span>;

export default function ChangeRequestCreatePage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [draft, setDraft] = useState(emptyDraft);

  const { data: companies = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['customer-companies'],
    queryFn: async () => (await api.get('/api/customer-companies')).data,
  });

  // Everything a CR needs to be reviewable by the customer must be filled here.
  const canSave = !!(draft.title.trim() && draft.description.trim() && draft.customerCompanyId && draft.objective.trim() && draft.reasonForCr.trim());

  const createMutation = useMutation({
    mutationFn: async (send: boolean) => {
      const res = await api.post('/api/change-requests', {
        title: draft.title.trim(),
        description: draft.description.trim() || undefined,
        customerCompanyId: draft.customerCompanyId || undefined,
        customer: draft.customer || undefined,
        objective: draft.objective.trim() || undefined,
        reasonForCr: draft.reasonForCr.trim() || undefined,
        benefitToCustomer: draft.benefitToCustomer.trim() || undefined,
        projectName: draft.projectName || undefined,
        priority: draft.priority || undefined,
        crType: draft.crType || undefined,
      });
      // Send straight to the customer admin — no need to reopen the CR.
      if (send) await api.post(`/api/change-requests/${res.data.id}/send-approval`);
      return { id: res.data.id as string, send };
    },
    onSuccess: ({ id, send }) => {
      qc.invalidateQueries({ queryKey: ['change-requests'] });
      toast.success(send ? 'Change request created & sent for approval' : 'Change request created');
      navigate(`/change-requests/${id}`);
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error creating change request'),
  });

  return (
    <div className="mx-auto max-w-4xl">
      <Button variant="ghost" size="sm" onClick={() => navigate('/change-requests')} className="mb-3 -ml-2">
        <ArrowLeft className="size-4" /> All change requests
      </Button>

      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">New Change Request</h1>
        <p className="text-sm text-muted-foreground">
          Fill in everything the customer needs to review. Fields marked <Req /> are required before it can be sent.
        </p>
      </div>

      <div className="space-y-6">
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Title <Req /></label>
          <Input value={draft.title} onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))} placeholder="Short summary of the change" />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Customer company <Req /></label>
            <Select
              value={draft.customerCompanyId}
              onValueChange={(v) => {
                const co = companies.find((c) => c.id === v);
                setDraft((d) => ({ ...d, customerCompanyId: v, customer: co?.name ?? '' }));
              }}
            >
              <SelectTrigger><SelectValue placeholder="Select the customer to send this to" /></SelectTrigger>
              <SelectContent>
                {companies.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Project</label>
            <OptionSelect listKey="project" value={draft.projectName} onChange={(v) => setDraft((d) => ({ ...d, projectName: v }))} />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Priority</label>
            <OptionSelect listKey="priority" value={draft.priority} onChange={(v) => setDraft((d) => ({ ...d, priority: v }))} />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">CR Type</label>
            <OptionSelect listKey="type" value={draft.crType} onChange={(v) => setDraft((d) => ({ ...d, crType: v }))} />
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium">Description <Req /></label>
          <Textarea rows={3} value={draft.description} onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))} placeholder="What is changing?" />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Objective <Req /></label>
          <Textarea rows={3} value={draft.objective} onChange={(e) => setDraft((d) => ({ ...d, objective: e.target.value }))} placeholder="What should this change achieve?" />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Reason for the change <Req /></label>
          <Textarea rows={3} value={draft.reasonForCr} onChange={(e) => setDraft((d) => ({ ...d, reasonForCr: e.target.value }))} placeholder="Why is this change needed?" />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Benefit to the customer</label>
          <Textarea rows={2} value={draft.benefitToCustomer} onChange={(e) => setDraft((d) => ({ ...d, benefitToCustomer: e.target.value }))} placeholder="Optional — how the customer gains from it" />
        </div>

        <div className="flex flex-col gap-2 border-t pt-4 sm:flex-row sm:items-center sm:justify-end">
          {!canSave && (
            <span className="mr-auto text-xs text-muted-foreground">Fill all <Req /> fields to continue</span>
          )}
          <Button variant="outline" onClick={() => navigate('/change-requests')} disabled={createMutation.isPending}>
            Cancel
          </Button>
          <Button variant="outline" disabled={!canSave || createMutation.isPending} onClick={() => createMutation.mutate(false)}>
            Save without sending
          </Button>
          <Button disabled={!canSave || createMutation.isPending} onClick={() => createMutation.mutate(true)}>
            {createMutation.isPending ? 'Working…' : 'Create & send for approval'}
          </Button>
        </div>
      </div>
    </div>
  );
}
