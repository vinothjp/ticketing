import { useEffect, useState } from 'react';
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
import StagePipeline from './detail/StagePipeline';
import BusinessRequirementTab from './detail/BusinessRequirementTab';
import BluePrintTab from './detail/BluePrintTab';
import SupportiveDocumentsTab from './detail/SupportiveDocumentsTab';
import ImpactAnalysisTab from './detail/ImpactAnalysisTab';

export default function ChangeRequestDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState(searchParams.get('tab') ?? 'general');
  // The stage pipeline (General tab) is rendered full-width by this page, so the
  // stage whose fields the right-hand panel shows lives here. One is always
  // open: it defaults to, and follows, the record's current stage.
  const [selectedStage, setSelectedStage] = useState<string | null>(null);

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

  // Open the current stage by default, and follow it when the stage advances.
  const crStage = cr?.stage;
  useEffect(() => { if (crStage) setSelectedStage(crStage); }, [crStage]);

  if (isLoading || !cr) return <p className="text-muted-foreground">Loading...</p>;

  const stage = selectedStage ?? cr.stage ?? 'Submission';

  const appr = cr.approvalStatus ?? 'NONE';
  const apprBadge = appr === 'PENDING' ? { t: 'Awaiting customer approval', c: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30' }
    : appr === 'REJECTED' ? { t: 'Rejected by customer', c: 'bg-destructive/15 text-destructive border-destructive/30' } : null;

  // An internal change has nobody outside to approve it, and one already sent or
  // approved has nothing left to ask for.
  const canSendForApproval = cr.changeSource !== 'INTERNAL' && appr !== 'PENDING' && appr !== 'APPROVED';
  const sendForApproval = () => {
    // A customer can't review an empty CR — name what is missing rather than
    // sitting there disabled with no explanation.
    const missing = [
      !cr.customerCompanyId && 'a Customer name (Details)',
      !cr.description?.trim() && 'Description',
      !cr.objective?.trim() && 'Objective',
      !cr.reasonForCr?.trim() && 'Reason for the change (Details)',
    ].filter(Boolean) as string[];
    if (missing.length) {
      toast.error(`Add ${missing.join(', ')} before sending this for approval`);
      return;
    }
    sendApproval.mutate();
  };

  return (
    <div>
      <Button variant="ghost" size="sm" asChild className="mb-3 -ml-2">
        <Link to="/change-requests"><ArrowLeft className="size-4" /> Change Management</Link>
      </Button>

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <span className="text-sm text-muted-foreground">{cr.crNumber}</span>
        <h1 className="text-xl font-bold text-foreground">{cr.title}</h1>
        <Badge variant={crStatusVariant(cr.status)}>{cr.status}</Badge>
        {cr.priority && <Badge variant={crPriorityVariant(cr.priority)}>{cr.priority}</Badge>}
        {/* Where the change actually is. This replaced the "Approved by customer"
            pill; the remaining approval pills only flag a state needing attention. */}
        <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
          Stage: {cr.stage ?? 'Submission'}
        </span>
        {apprBadge && <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${apprBadge.c}`}>{apprBadge.t}</span>}
        {/* The approval bar that used to carry this was removed — the badge above
            already reported the outcome. Only the action needed a home, so it
            sits beside the badge it drives. Nothing to do once sent or approved. */}
        {canSendForApproval && (
          <Button size="sm" variant="outline" disabled={sendApproval.isPending} onClick={sendForApproval}>
            {appr === 'REJECTED' ? 'Resend for approval' : 'Send for customer approval'}
          </Button>
        )}
      </div>
      {cr.changeSource !== 'INTERNAL' && appr === 'REJECTED' && cr.approvalReason && (
        <div className="mb-6 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm">
          <span className="text-muted-foreground">Customer's rejection reason: </span>{cr.approvalReason}
        </div>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        {/* Section chooser: the remaining sections share the width equally.
            Development, Testing and Deployment are gone from here - they are now
            the Implementation, UAT and Release stages of the pipeline. */}
        <TabsList className="flex w-full items-center gap-1 [&>*]:flex-1">
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="business">Business Requirement</TabsTrigger>
          <TabsTrigger value="blueprint">Blue Print</TabsTrigger>
          <TabsTrigger value="documents">Supportive Documents</TabsTrigger>
          <TabsTrigger value="impact">Impact Analysis</TabsTrigger>
        </TabsList>

        {/* The pipeline spans the full width so every stage label fits. */}
        {tab === 'general' && (
          <div className="pt-4">
            <StagePipeline cr={cr} selected={stage} onSelect={setSelectedStage} />
          </div>
        )}

        <div className="min-w-0 pt-4">
          <TabsContent value="general"><GeneralTab cr={cr} stage={stage} /></TabsContent>
          <TabsContent value="business"><BusinessRequirementTab cr={cr} /></TabsContent>
          <TabsContent value="blueprint"><BluePrintTab cr={cr} /></TabsContent>
          <TabsContent value="documents"><SupportiveDocumentsTab cr={cr} /></TabsContent>
          <TabsContent value="impact"><ImpactAnalysisTab cr={cr} /></TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
