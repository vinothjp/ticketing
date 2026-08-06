import RegisterSection, { type FieldCfg, type ColCfg } from './RegisterSection';
import { type ProjectDetail } from '../projectMeta';
import { attachmentTypesFor } from '../../../lib/uploads';

const fields: FieldCfg[] = [
  { key: 'name', label: 'Document name', type: 'text' },
  { key: 'docType', label: 'Type', type: 'select', options: ['Blueprint', 'Requirement', 'Design', 'Test Plan', 'Manual', 'Contract', 'Other'] },
  { key: 'versionNumber', label: 'Version', type: 'text' },
  { key: 'url', label: 'Link (URL)', type: 'text' },
];
const columns: ColCfg[] = [
  { key: 'name', label: 'Document' },
  { key: 'docType', label: 'Type' },
  { key: 'versionNumber', label: 'Version' },
  { key: 'filePath', label: 'Link', kind: 'link' },
  { key: 'uploadedAt', label: 'Added', kind: 'date' },
];

export default function DocumentsTab({ project }: { project: ProjectDetail }) {
  return <RegisterSection projectId={project.id} type="documents" singular="Document" fields={fields} columns={columns} attachEntityType="document" acceptTypes={attachmentTypesFor(project.features, 'document')} exportable />;
}
