import { type ChangeRequest } from '../changeRequestMeta';
import CrAttachments from './CrAttachments';

// Supportive Documents = a titled list of files/links (Emails, Minutes,
// Additional docs, …). Reuses the CR attachment slot entityType='supportive',
// with the Document Title driven by the `doc_title` option list.
export default function SupportiveDocumentsTab({ cr }: { cr: ChangeRequest }) {
  return (
    <div className="space-y-4">
      <section className="rounded-lg border p-4">
        <h2 className="mb-1 text-sm font-semibold text-foreground">Supportive Documents</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          Attach emails, meeting minutes, and additional documents. Pick a document title, then upload a file or paste a link.
        </p>
        <CrAttachments crId={cr.id} entityType="supportive" withTitle titleListKey="doc_title" />
      </section>
    </div>
  );
}
