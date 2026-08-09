import { useState } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
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

  const { data: cr, isLoading } = useQuery<ChangeRequest>({
    queryKey: ['change-requests', id],
    queryFn: async () => (await api.get(`/api/change-requests/${id}`)).data,
    enabled: !!id,
  });

  if (isLoading || !cr) return <p className="text-muted-foreground">Loading...</p>;

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
      </div>

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
