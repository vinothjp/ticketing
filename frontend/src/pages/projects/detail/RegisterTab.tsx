import { useState } from 'react';
import { AlertTriangle, Bug, GitPullRequest } from 'lucide-react';
import { Button } from '@/components/ui/button';
import RegisterSection, { type FieldCfg, type ColCfg } from './RegisterSection';
import ChangeRequestsSection from './ChangeRequestsSection';
import { type ProjectDetail } from '../projectMeta';
import { attachmentTypesFor } from '../../../lib/uploads';

const SEVERITY = ['LOW', 'MEDIUM', 'HIGH'];
const PRIORITY = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];

type Reg = { key: string; type: string; label: string; singular: string; icon: typeof Bug; fields: FieldCfg[]; columns: ColCfg[]; attachEntityType?: string };

const REGISTERS: Reg[] = [
  {
    key: 'risks', type: 'risks', label: 'Risks', singular: 'Risk', icon: AlertTriangle, attachEntityType: 'risk',
    fields: [
      { key: 'title', label: 'Risk', type: 'text' },
      { key: 'probability', label: 'Probability', type: 'select', options: SEVERITY },
      { key: 'impact', label: 'Impact', type: 'select', options: SEVERITY },
      { key: 'mitigation', label: 'Mitigation', type: 'textarea' },
      { key: 'ownerName', label: 'Owner', type: 'text' },
      { key: 'status', label: 'Status', type: 'select', options: ['OPEN', 'MITIGATED', 'CLOSED'] },
    ],
    columns: [
      { key: 'title', label: 'Risk' }, { key: 'probability', label: 'Probability', kind: 'badge' },
      { key: 'impact', label: 'Impact', kind: 'badge' }, { key: 'ownerName', label: 'Owner' },
      { key: 'status', label: 'Status', kind: 'badge' },
    ],
  },
  {
    key: 'issues', type: 'issues', label: 'Issues', singular: 'Issue', icon: Bug, attachEntityType: 'issue',
    fields: [
      { key: 'title', label: 'Issue', type: 'text' },
      { key: 'priority', label: 'Priority', type: 'select', options: PRIORITY },
      { key: 'ownerName', label: 'Owner', type: 'text' },
      { key: 'targetDate', label: 'Target date', type: 'date' },
      { key: 'resolution', label: 'Resolution', type: 'textarea' },
      { key: 'status', label: 'Status', type: 'select', options: ['OPEN', 'IN_PROGRESS', 'RESOLVED'] },
    ],
    columns: [
      { key: 'title', label: 'Issue' }, { key: 'priority', label: 'Priority', kind: 'badge' },
      { key: 'ownerName', label: 'Owner' }, { key: 'targetDate', label: 'Target', kind: 'date' },
      { key: 'status', label: 'Status', kind: 'badge' },
    ],
  },
  {
    key: 'changes', type: 'change-requests', label: 'Change Requests', singular: 'Change Request', icon: GitPullRequest,
    fields: [
      { key: 'title', label: 'Title', type: 'text' },
      { key: 'description', label: 'Description', type: 'textarea' },
      { key: 'reason', label: 'Reason', type: 'text' },
      { key: 'scheduleImpact', label: 'Schedule impact', type: 'text' },
      { key: 'budgetImpact', label: 'Budget impact', type: 'number' },
      { key: 'requestedBy', label: 'Requested by', type: 'text' },
      { key: 'status', label: 'Status', type: 'select', options: ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED'] },
    ],
    columns: [
      { key: 'title', label: 'Title' }, { key: 'requestedBy', label: 'Requested by' },
      { key: 'scheduleImpact', label: 'Schedule' }, { key: 'budgetImpact', label: 'Budget', kind: 'money', align: 'right' },
      { key: 'status', label: 'Status', kind: 'badge' },
    ],
  },
];

export default function RegisterTab({ project }: { project: ProjectDetail }) {
  const [active, setActive] = useState('risks');
  const reg = REGISTERS.find((r) => r.key === active)!;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1 rounded-md border p-0.5">
        {REGISTERS.map((r) => (
          <Button key={r.key} size="sm" variant={active === r.key ? 'secondary' : 'ghost'} className="h-7 px-2" onClick={() => setActive(r.key)}>
            <r.icon className="size-4" /> {r.label}
          </Button>
        ))}
      </div>
      {reg.key === 'changes'
        ? <ChangeRequestsSection project={project} />
        : <RegisterSection projectId={project.id} type={reg.type} singular={reg.singular} fields={reg.fields} columns={reg.columns} attachEntityType={reg.attachEntityType} acceptTypes={reg.attachEntityType ? attachmentTypesFor(project.features, reg.attachEntityType) : undefined} />}
    </div>
  );
}
