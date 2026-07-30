export type FieldGroup = 'ticket_info' | 'ticket_detail' | 'root_cause';

export type FieldDataType =
  | 'TEXT'
  | 'TEXTAREA'
  | 'SELECT'
  | 'MULTI_SELECT_USER'
  | 'DATE'
  | 'DATETIME'
  | 'BOOLEAN'
  | 'EMAIL_LIST'
  | 'FILE'
  | 'SYSTEM';

export interface FieldCatalogEntry {
  key: string;
  label: string;
  group: FieldGroup;
  dataType: FieldDataType;
  picklistKey?: string;
  /** Not directly editable by the ticket creator — template config can only toggle visible/hidden. */
  systemManaged?: boolean;
  defaultHelperText: string;
}

/**
 * Fixed catalog of fields a Template can be built from (spec point 4).
 * New Templates/Request Types need no code — only picking/ordering/configuring
 * a subset of this catalog does. Adding a genuinely new field type is the one
 * thing that does require a code change here.
 */
export const FIELD_CATALOG: FieldCatalogEntry[] = [
  // Ticket Info
  {
    key: 'templateName',
    label: 'Template Name',
    group: 'ticket_info',
    dataType: 'SYSTEM',
    systemManaged: true,
    defaultHelperText: 'The template this ticket was created from.',
  },
  {
    key: 'requestorName',
    label: 'Requestor Name',
    group: 'ticket_info',
    dataType: 'TEXT',
    defaultHelperText: 'Name of the person raising this request.',
  },
  {
    key: 'customerName',
    label: 'Customer Name',
    group: 'ticket_info',
    dataType: 'TEXT',
    defaultHelperText: 'The customer or account this request is for.',
  },
  {
    key: 'department',
    label: 'Department',
    group: 'ticket_info',
    dataType: 'SELECT',
    picklistKey: 'department',
    defaultHelperText: 'Department the requestor belongs to.',
  },
  {
    key: 'requestorContact',
    label: 'Requestor Contact Detail',
    group: 'ticket_info',
    dataType: 'TEXT',
    defaultHelperText: 'Phone or email to reach the requestor.',
  },
  {
    key: 'requestType',
    label: 'Request Type',
    group: 'ticket_info',
    dataType: 'SYSTEM',
    systemManaged: true,
    defaultHelperText:
      'Classification of this request, set by the template chosen.',
  },
  {
    key: 'priority',
    label: 'Priority',
    group: 'ticket_info',
    dataType: 'SELECT',
    picklistKey: 'priority',
    defaultHelperText: 'How urgently this request needs attention.',
  },
  {
    key: 'ticketStatus',
    label: 'Ticket Status',
    group: 'ticket_info',
    dataType: 'SELECT',
    picklistKey: 'ticketStatus',
    systemManaged: true,
    defaultHelperText: 'Current stage in the ticket lifecycle.',
  },
  {
    key: 'ticketCategory',
    label: 'Ticket Category',
    group: 'ticket_info',
    dataType: 'SELECT',
    picklistKey: 'ticketCategory',
    defaultHelperText: 'Top-level category for this request.',
  },
  {
    key: 'subCategory',
    label: 'Sub Category',
    group: 'ticket_info',
    dataType: 'SELECT',
    picklistKey: 'subCategory',
    defaultHelperText: 'More specific classification within the category.',
  },
  {
    key: 'technicians',
    label: 'Technicians',
    group: 'ticket_info',
    dataType: 'MULTI_SELECT_USER',
    defaultHelperText: 'Who this ticket is assigned to.',
  },
  {
    key: 'notifyEmails',
    label: 'Email ID to Notify',
    group: 'ticket_info',
    dataType: 'EMAIL_LIST',
    defaultHelperText: 'Comma-separated emails to notify on updates.',
  },
  {
    key: 'createdDate',
    label: 'Created Date',
    group: 'ticket_info',
    dataType: 'SYSTEM',
    systemManaged: true,
    defaultHelperText: 'Set automatically when the ticket is submitted.',
  },
  {
    key: 'dueDate',
    label: 'Due Date',
    group: 'ticket_info',
    dataType: 'DATE',
    defaultHelperText: 'When this request is due.',
  },
  {
    key: 'expectedResolutionDate',
    label: 'Expected Resolution Date',
    group: 'ticket_info',
    dataType: 'DATE',
    defaultHelperText: 'Target date for resolution.',
  },
  {
    key: 'customerConfirmation',
    label: 'Customer Confirmation',
    group: 'ticket_info',
    dataType: 'BOOLEAN',
    defaultHelperText: 'Whether the customer has confirmed this request.',
  },
  {
    key: 'closedDate',
    label: 'Closed Date',
    group: 'ticket_info',
    dataType: 'SYSTEM',
    systemManaged: true,
    defaultHelperText: 'Set automatically when the ticket is closed.',
  },

  // Ticket Detail
  {
    key: 'subject',
    label: 'Subject',
    group: 'ticket_detail',
    dataType: 'TEXT',
    defaultHelperText: 'A short summary of the request.',
  },
  {
    key: 'description',
    label: 'Description',
    group: 'ticket_detail',
    dataType: 'TEXTAREA',
    defaultHelperText: 'Full details of the request.',
  },
  {
    key: 'attachments',
    label: 'Attachments',
    group: 'ticket_detail',
    dataType: 'FILE',
    defaultHelperText: 'Any supporting files, screenshots, or documents.',
  },

  // Root Cause Analysis
  {
    key: 'rootCauseCategory',
    label: 'Root Cause Category',
    group: 'root_cause',
    dataType: 'TEXT',
    defaultHelperText: 'Category of the underlying cause.',
  },
  {
    key: 'rootCauseDescription',
    label: 'Root Cause Description',
    group: 'root_cause',
    dataType: 'TEXTAREA',
    defaultHelperText: 'Describe what caused the issue.',
  },
  {
    key: 'correctionAction',
    label: 'Correction Action',
    group: 'root_cause',
    dataType: 'TEXTAREA',
    defaultHelperText: 'What was done to fix the issue.',
  },
  {
    key: 'preventionAction',
    label: 'Prevention Action',
    group: 'root_cause',
    dataType: 'TEXTAREA',
    defaultHelperText: 'What will prevent this from recurring.',
  },
  {
    key: 'lessonsLearned',
    label: 'Lessons Learned',
    group: 'root_cause',
    dataType: 'TEXTAREA',
    defaultHelperText: 'Key takeaways from this incident.',
  },
];

export const FIELD_CATALOG_MAP = new Map(FIELD_CATALOG.map((f) => [f.key, f]));

/** Fields that get sane visible+mandatory defaults when a new Template is auto-created. */
export const DEFAULT_VISIBLE_MANDATORY_FIELDS = [
  'subject',
  'description',
  'priority',
];
