import { useMemo } from 'react';
import RegisterSection, { type FieldCfg, type ColCfg } from './RegisterSection';
import { type ProjectDetail } from '../projectMeta';
import { attachmentTypesFor } from '../../../lib/uploads';
import { useOptionValues } from '@/lib/optionLists';

// Seeds (and backs) the `projectDocumentType` option list, which is what the
// form reads — see the Option List screen, Projects module.
const DOC_TYPES = ['Blueprint', 'Requirement', 'Design', 'Test Plan', 'Manual', 'Contract', 'Other'];
const columns: ColCfg[] = [
  { key: 'name', label: 'Document' },
  { key: 'docType', label: 'Type' },
  { key: 'versionNumber', label: 'Version' },
  { key: 'filePath', label: 'Link', kind: 'link' },
  { key: 'uploadedAt', label: 'Added', kind: 'date' },
];

export default function DocumentsTab({ project }: { project: ProjectDetail }) {
  const docTypes = useOptionValues('projectDocumentType', DOC_TYPES);
  const fields = useMemo<FieldCfg[]>(() => [
    { key: 'name', label: 'Document name', type: 'text' },
    { key: 'docType', label: 'Type', type: 'select', options: docTypes },
    { key: 'versionNumber', label: 'Version', type: 'text' },
    { key: 'url', label: 'Link (URL)', type: 'text' },
  ], [docTypes]);
  return <RegisterSection projectId={project.id} type="documents" singular="Document" fields={fields} columns={columns} attachEntityType="document" acceptTypes={attachmentTypesFor(project.features, 'document')} exportable />;
}
