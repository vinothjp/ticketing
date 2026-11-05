// Shared file-upload constraints for project attachments (size limit kept in sync
// with the backend Multer limit in project-attachments.controller.ts).

export const MAX_UPLOAD_MB = 5;
export const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;

// Catalog of selectable file types (extension → label), shown in project Settings.
export const UPLOAD_TYPE_CATALOG: { ext: string; label: string }[] = [
  { ext: '.pdf', label: '.pdf' },
  { ext: '.doc', label: '.doc' },
  { ext: '.docx', label: '.docx' },
  { ext: '.xls', label: '.xls' },
  { ext: '.xlsx', label: '.xlsx' },
  { ext: '.csv', label: '.csv' },
  { ext: '.png', label: '.png' },
  { ext: '.jpg', label: '.jpg' },
  { ext: '.jpeg', label: '.jpeg' },
  { ext: '.gif', label: '.gif' },
  { ext: '.txt', label: '.txt' },
  { ext: '.zip', label: '.zip' },
  { ext: '.ppt', label: '.ppt' },
  { ext: '.pptx', label: '.pptx' },
];

// Submodules whose attachments can be type-restricted in Settings.
export const ATTACHMENT_SUBMODULES: { entityType: string; label: string }[] = [
  { entityType: 'document', label: 'Documents' },
  { entityType: 'invoice', label: 'Invoices' },
  { entityType: 'expense', label: 'Expenses' },
  { entityType: 'risk', label: 'Risks' },
  { entityType: 'issue', label: 'Issues' },
];

// Used when a submodule has no explicit type config in Settings.
export const DEFAULT_UPLOAD_EXTS = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.csv', '.png', '.jpg', '.jpeg', '.gif', '.txt'];

export const allowedExts = (exts?: string[] | null) => (exts && exts.length ? exts : DEFAULT_UPLOAD_EXTS);
/** `accept` attribute for a file <input> given a submodule's configured extensions. */
export const acceptAttr = (exts?: string[] | null) => allowedExts(exts).join(',');
/** Small helper line under the upload controls, e.g. ".pdf, .docx · max 5 MB". */
export const uploadHint = (exts?: string[] | null) => `${allowedExts(exts).join(', ')} · max ${MAX_UPLOAD_MB} MB`;

const extOf = (name: string) => { const i = name.lastIndexOf('.'); return i >= 0 ? name.slice(i).toLowerCase() : ''; };

/** Partition picked files into allowed / over-size / wrong-type for the given config. */
export function splitAllowed(files: File[], exts?: string[] | null): { ok: File[]; tooBig: File[]; badType: File[] } {
  const allow = allowedExts(exts).map((e) => e.toLowerCase());
  const ok: File[] = [];
  const tooBig: File[] = [];
  const badType: File[] = [];
  for (const f of files) {
    if (!allow.includes(extOf(f.name))) badType.push(f);
    else if (f.size > MAX_UPLOAD_BYTES) tooBig.push(f);
    else ok.push(f);
  }
  return { ok, tooBig, badType };
}

/** Read a submodule's configured extensions from a project's features JSON. */
export function attachmentTypesFor(
  features: Record<string, any> | undefined | null,
  entityType: string,
): string[] | undefined {
  const cfg = features?.attachmentTypes as Record<string, string[]> | undefined;
  const list = cfg?.[entityType];
  return Array.isArray(list) && list.length ? list : undefined;
}
