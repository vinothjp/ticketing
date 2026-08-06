import { useState } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import api from '../../lib/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  PROJECT_STATUSES, PRIORITIES, labelOf, projectStatusVariant, priorityVariant,
  type ProjectDetail, type UserOption,
} from './projectMeta';
import OverviewTab from './detail/OverviewTab';
import TasksTab from './detail/TasksTab';
import SprintsTab from './detail/SprintsTab';
import TicketsTab from './detail/TicketsTab';
import SettingsTab from './detail/SettingsTab';
import ResourcesTab from './detail/ResourcesTab';
import TimesheetTab from './detail/TimesheetTab';
import RegisterTab from './detail/RegisterTab';
import MeetingsTab from './detail/MeetingsTab';
import DocumentsTab from './detail/DocumentsTab';
import FinancialsTab from './detail/FinancialsTab';
import CalendarTab from './detail/CalendarTab';

const NONE = '__none__';
const fmtDate = (v?: string | null) => (v ? new Date(v).toLocaleDateString() : '—');

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const qc = useQueryClient();
  const [tab, setTab] = useState(searchParams.get('tab') ?? 'overview');

  const { data: project, isLoading } = useQuery<ProjectDetail>({
    queryKey: ['projects', id],
    queryFn: async () => (await api.get(`/api/projects/${id}`)).data,
    enabled: !!id,
  });
  const { data: users = [] } = useQuery<UserOption[]>({
    queryKey: ['users'],
    queryFn: async () => (await api.get('/api/users')).data,
  });

  const updateMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => api.patch(`/api/projects/${id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['projects', id] });
      qc.invalidateQueries({ queryKey: ['projects'] });
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error updating project'),
  });

  if (isLoading || !project) return <p className="text-muted-foreground">Loading...</p>;

  const sprintsEnabled = project.features?.sprints !== false; // default on; Settings can disable
  const timeTrackingEnabled = project.features?.timeTracking === true; // opt-in via Settings

  return (
    <div>
      <Button variant="ghost" size="sm" asChild className="mb-3 -ml-2">
        <Link to="/projects"><ArrowLeft className="size-4" /> All projects</Link>
      </Button>

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <span className="text-sm text-muted-foreground">{project.projectNumber}</span>
        <h1 className="text-xl font-bold text-foreground">{project.name}</h1>
        {project.key && <span className="text-xs text-muted-foreground">· {project.key}</span>}
        <Badge variant={projectStatusVariant(project.status)}>{labelOf(project.status)}</Badge>
        {project.priority && <Badge variant={priorityVariant(project.priority)}>{labelOf(project.priority)}</Badge>}
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex w-full justify-between gap-0 [&>button]:px-2">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="tasks">Tasks</TabsTrigger>
            {sprintsEnabled && <TabsTrigger value="sprints">Sprints</TabsTrigger>}
            <TabsTrigger value="resources">Resources</TabsTrigger>
            {timeTrackingEnabled && <TabsTrigger value="timesheet">Timesheet</TabsTrigger>}
            <TabsTrigger value="financials">Financials</TabsTrigger>
            <TabsTrigger value="calendar">Calendar</TabsTrigger>
            <TabsTrigger value="register">Register</TabsTrigger>
            <TabsTrigger value="meetings">Meetings</TabsTrigger>
            <TabsTrigger value="documents">Documents</TabsTrigger>
            <TabsTrigger value="tickets">Tickets</TabsTrigger>
            <TabsTrigger value="settings">Settings</TabsTrigger>
          </TabsList>
          <div className={`grid grid-cols-1 gap-6 ${tab === 'overview' ? 'lg:grid-cols-[minmax(0,1fr)_300px]' : ''}`}>
          <div className="min-w-0">
          <TabsContent value="overview" className="pt-4"><OverviewTab project={project} /></TabsContent>
          <TabsContent value="tasks" className="pt-4"><TasksTab project={project} users={users} /></TabsContent>
          {sprintsEnabled && <TabsContent value="sprints" className="pt-4"><SprintsTab project={project} /></TabsContent>}
          <TabsContent value="resources" className="pt-4"><ResourcesTab project={project} users={users} /></TabsContent>
          {timeTrackingEnabled && <TabsContent value="timesheet" className="pt-4"><TimesheetTab project={project} users={users} /></TabsContent>}
          <TabsContent value="financials" className="pt-4"><FinancialsTab project={project} /></TabsContent>
          <TabsContent value="calendar" className="pt-4"><CalendarTab project={project} /></TabsContent>
          <TabsContent value="register" className="pt-4"><RegisterTab project={project} /></TabsContent>
          <TabsContent value="meetings" className="pt-4"><MeetingsTab project={project} users={users} /></TabsContent>
          <TabsContent value="documents" className="pt-4"><DocumentsTab project={project} /></TabsContent>
          <TabsContent value="tickets" className="pt-4"><TicketsTab project={project} /></TabsContent>
          <TabsContent value="settings" className="pt-4"><SettingsTab project={project} /></TabsContent>
          </div>

        {tab === 'overview' && (
        <div className="space-y-4">
          <Card>
            <CardContent className="space-y-3 py-4 text-sm">
              <div>
                <div className="mb-1 text-xs text-muted-foreground">Status</div>
                <Select value={project.status} onValueChange={(v) => updateMutation.mutate({ status: v })}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PROJECT_STATUSES.map((s) => <SelectItem key={s} value={s}>{labelOf(s)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <div className="mb-1 text-xs text-muted-foreground">Priority</div>
                <Select
                  value={project.priority ?? NONE}
                  onValueChange={(v) => updateMutation.mutate({ priority: v === NONE ? null : v })}
                >
                  <SelectTrigger className="w-full"><SelectValue placeholder="None" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>None</SelectItem>
                    {PRIORITIES.map((p) => <SelectItem key={p} value={p}>{labelOf(p)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <div className="mb-1 text-xs text-muted-foreground">Manager</div>
                <Select
                  value={project.managerUserId ?? NONE}
                  onValueChange={(v) => updateMutation.mutate({ managerUserId: v === NONE ? null : v })}
                >
                  <SelectTrigger className="w-full"><SelectValue placeholder="Unassigned" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Unassigned</SelectItem>
                    {users.map((u) => <SelectItem key={u.id} value={u.id}>{u.username}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-sm">Details</CardTitle></CardHeader>
            <CardContent className="space-y-2 pb-4 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Start</span>
                <span className="text-foreground">{fmtDate(project.startDate)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">End</span>
                <span className="text-foreground">{fmtDate(project.endDate)}</span>
              </div>
              {project.customerCompany && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Customer</span>
                  <span className="text-foreground">{project.customerCompany.name}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-muted-foreground">Created</span>
                <span className="text-foreground">{fmtDate(project.createdAt)}</span>
              </div>
            </CardContent>
          </Card>
        </div>
        )}
        </div>
      </Tabs>
    </div>
  );
}
