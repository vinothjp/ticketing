import { useState } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import api from '../../lib/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { crStatusVariant, crPriorityVariant, type ChangeRequest } from './changeRequestMeta';
import GeneralTab from './detail/GeneralTab';
import BusinessRequirementTab from './detail/BusinessRequirementTab';
import BluePrintTab from './detail/BluePrintTab';
import SupportiveDocumentsTab from './detail/SupportiveDocumentsTab';
import ImpactAnalysisTab from './detail/ImpactAnalysisTab';
import DevelopmentTab from './detail/DevelopmentTab';
import TestingTab from './detail/TestingTab';
import DeploymentTab from './detail/DeploymentTab';

export default function ChangeRequestDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState(searchParams.get('tab') ?? 'general');

  const qc = useQueryClient();
  const { data: cr, isLoading } = useQuery<ChangeRequest>({
    queryKey: ['change-requests', id],
    queryFn: async () => (await api.get(`/api/change-requests/${id}`)).data,
    enabled: !!id,
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['change-requests', id] });
  const sendApproval = useMutation({
    mutationFn: () => api.post(`/api/change-requests/${id}/send-approval`),
    onSuccess: () => { invalidate(); toast.success('Sent to the customer admin for approval'); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error'),
  });

  if (isLoading || !cr) return <p className="text-muted-foreground">Loading...</p>;

  const appr = cr.approvalStatus ?? 'NONE';
  const apprBadge = appr === 'PENDING' ? { t: 'Awaiting customer approval', c: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30' }
    : appr === 'APPROVED' ? { t: 'Approved by customer', c: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30' }
    : appr === 'REJECTED' ? { t: 'Rejected by customer', c: 'bg-destructive/15 text-destructive border-destructive/30' } : null;

  return (
    <div>
      <Button variant="ghost" size="sm" asChild className="mb-3 -ml-2">
        <Link to="/change-requests"><ArrowLeft className="size-4" /> All change requests</Link>
      </Button>

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <span className="text-sm text-muted-foreground">{cr.crNumber}</span>
        <h1 className="text-xl font-bold text-foreground">{cr.title}</h1>
        <Badge variant={crStatusVariant(cr.status)}>{cr.status}</Badge>
        {cr.priority && <Badge variant={crPriorityVariant(cr.priority)}>{cr.priority}</Badge>}
        {apprBadge && <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${apprBadge.c}`}>{apprBadge.t}</span>}
      </div>

      {/* Customer approval bar — the company is set via the Customer field in the General tab. */}
      <div className="mb-6 flex flex-wrap items-center gap-3 rounded-lg border bg-muted/30 px-4 py-3">
        <span className="text-sm font-medium text-foreground">Customer approval</span>
        <span className="text-sm text-muted-foreground">
          {cr.customerCompanyId
            ? `Linked to ${cr.customer}`
            : 'No customer linked yet — pick the Customer in the General tab below and Save'}
        </span>
        <div className="flex-1" />
        {appr === 'PENDING' ? (
          <span className="text-sm text-muted-foreground">Waiting for the customer admin to decide…</span>
        ) : appr === 'APPROVED' ? (
          <span className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
            Approved by the customer — you can proceed with delivery.
          </span>
        ) : (() => {
          // A customer can't review an empty CR — need the core content first.
          const missing = [
            !cr.description?.trim() && 'Description',
            !cr.objective?.trim() && 'Objective',
            !cr.reasonForCr?.trim() && 'Reason for the change',
          ].filter(Boolean) as string[];
          const ready = !!cr.customerCompanyId && missing.length === 0;
          return (
            <div className="flex flex-col items-end gap-1">
              <Button size="sm" disabled={!ready || sendApproval.isPending} onClick={() => sendApproval.mutate()}>
                {appr === 'REJECTED' ? 'Resend for approval' : 'Send for customer approval'}
              </Button>
              {cr.customerCompanyId && missing.length > 0 && (
                <span className="text-xs text-muted-foreground">Add {missing.join(', ')} (General / Business Requirement) first</span>
              )}
            </div>
          );
        })()}
      </div>
      {appr === 'REJECTED' && cr.approvalReason && (
        <div className="mb-6 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm">
          <span className="text-muted-foreground">Customer's rejection reason: </span>{cr.approvalReason}
        </div>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex w-full flex-wrap justify-start gap-0 [&>button]:px-2">
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="business">Business Requirement</TabsTrigger>
          <TabsTrigger value="blueprint">Blue Print</TabsTrigger>
          <TabsTrigger value="documents">Supportive Documents</TabsTrigger>
          <TabsTrigger value="impact">Impact Analysis</TabsTrigger>
          <TabsTrigger value="development">Development</TabsTrigger>
          <TabsTrigger value="testing">Testing</TabsTrigger>
          <TabsTrigger value="deployment">Deployment</TabsTrigger>
        </TabsList>
        <TabsContent value="general" className="pt-4"><GeneralTab cr={cr} /></TabsContent>
        <TabsContent value="business" className="pt-4"><BusinessRequirementTab cr={cr} /></TabsContent>
        <TabsContent value="blueprint" className="pt-4"><BluePrintTab cr={cr} /></TabsContent>
        <TabsContent value="documents" className="pt-4"><SupportiveDocumentsTab cr={cr} /></TabsContent>
        <TabsContent value="impact" className="pt-4"><ImpactAnalysisTab cr={cr} /></TabsContent>
        <TabsContent value="development" className="pt-4"><DevelopmentTab cr={cr} /></TabsContent>
        <TabsContent value="testing" className="pt-4"><TestingTab cr={cr} /></TabsContent>
        <TabsContent value="deployment" className="pt-4"><DeploymentTab cr={cr} /></TabsContent>
      </Tabs>
    </div>
  );
}
