// The lists application code references by key, seeded into every tenant's
// Option List registry. They are `isSystem`: renameable, their values fully
// editable, but never re-keyed or deleted — a ticket status dropdown reading
// `listKey = 'ticketStatus'` must keep finding its list.
//
// `source` says which table holds the values:
//   PICKLIST        -> PicklistOption        (tickets, templates, KB)
//   CHANGE_REQUEST  -> ChangeRequestOption   (Change Management)

export const OPTION_SOURCES = ['PICKLIST', 'CHANGE_REQUEST'] as const;
export type OptionSource = (typeof OPTION_SOURCES)[number];

// Admin-facing label for a source. Still the fallback for a row that predates
// the `module` column; the Module column itself now reads `OptionList.module`.
export const SOURCE_LABELS: Record<OptionSource, string> = {
  PICKLIST: 'Ticketing',
  CHANGE_REQUEST: 'Change Mgmt',
};

/**
 * The screen areas a list can belong to — the Module column, filter and picker
 * on the Option List screen.
 *
 * A module is a *label over the registry*, not a value store: `source` still
 * decides which table holds the values, and `ORGANIZATION` writes into
 * `PicklistOption` exactly as `TICKETING` does. That is what lets the
 * Organization screen have its own module without becoming a third store.
 */
export const MODULES = [
  { value: 'TICKETING', label: 'Ticketing', source: 'PICKLIST' },
  { value: 'CHANGE_MGMT', label: 'Change Mgmt', source: 'CHANGE_REQUEST' },
  { value: 'KNOWLEDGE_BASE', label: 'Knowledge Base', source: 'PICKLIST' },
  { value: 'PROJECTS', label: 'Projects', source: 'PICKLIST' },
  { value: 'ORGANIZATION', label: 'Organization', source: 'PICKLIST' },
  { value: 'EMPLOYEE_MASTER', label: 'Employee Master', source: 'PICKLIST' },
  { value: 'ASSET_MASTER', label: 'Asset Master', source: 'PICKLIST' },
] as const;
export type OptionModule = (typeof MODULES)[number]['value'];

export const MODULE_KEYS = MODULES.map((m) => m.value);
export const MODULE_LABELS: Record<string, string> = Object.fromEntries(
  MODULES.map((m) => [m.value, m.label]),
);
/** Which table a module's values live in. */
export const MODULE_SOURCE: Record<string, OptionSource> = Object.fromEntries(
  MODULES.map((m) => [m.value, m.source as OptionSource]),
);
/** What a row with no `module` yet belongs to, by the store it already uses. */
export const SOURCE_MODULE: Record<OptionSource, OptionModule> = {
  PICKLIST: 'TICKETING',
  CHANGE_REQUEST: 'CHANGE_MGMT',
};

export interface DefaultList {
  code: string;
  name: string;
  source: OptionSource;
  // Which screen area owns the list. Defaults to the source's own module, so
  // only a list that breaks that pairing — the Organization ones — sets it.
  module?: OptionModule;
  listKey: string;
  parentListKey?: string;
  description?: string;
  // Seeded once, and only for a list that has no values at all — these are the
  // lists whose values used to be a hard-coded array in the app, so the seed has
  // to reproduce that array exactly or existing records stop matching.
  defaultValues?: string[];
}

// Two rules decide whether a dropdown belongs here.
//
// 1. A list of *records another screen owns* is not an option list. Templates,
//    projects, product modules, users and customers are created and managed on
//    their own screens; a typed-in copy here could never become the record it
//    names, so those fields read the real thing instead (see `EntitySelect` in
//    the CR module). That is why TEMPLATE_CATEGORY, CHANGE_PROJECT,
//    CHANGE_MODULE, CHANGE_PERSON and CHANGE_CUSTOMER are not registered.
//
// 2. A list application code *branches on* is not an option list either — an
//    admin renaming or deleting a value would change behaviour, not wording:
//   ticket task statuses (SETTLED_TASK_STATUSES gates the resolve),
//   project / task / milestone / sprint statuses + WBS types (completion maths),
//   client visit statuses (DEDUCTING_STATUS draws down the contract),
//   change stages and CAB_TYPES (the pipeline and the CAB gate),
//   KB articleType / status / audience (form branching and visibility),
//   consultant track, message channel, approval states, SLA operational hours,
//   project priority (badge tone + DTO validation), and ticket template category
//   (the Templates screen's own field). In Employee/Asset Master: every
//   vocabulary in `assets/allocation-status.ts` — allocation status (RETURNED is
//   what frees an asset for the next person, and `OPEN_ALLOCATION_STATUSES`
//   branches on that literal), return condition (BROKEN damages the unit),
//   retention (UNTIL_EXIT exempts a row from chasing and builds the exit
//   clearance list) and asset condition (DAMAGED / RETIRED decide the register
//   state a unit shows in).
//   In Projects specifically: risk probability/impact, issue priority and every
//   register status stay hard-coded — `RegisterSection` picks its badge tone off
//   the literals, the analytics screen orders by them, and a change request's
//   APPROVED is what feeds the revised-budget maths.
export const DEFAULT_LISTS: DefaultList[] = [
  // ---- Ticketing / KB (PicklistOption) ----
  { code: 'PRIORITY', name: 'Priority', source: 'PICKLIST', listKey: 'priority', description: 'Ticket priority; SLA policies key off these values.' },
  { code: 'TICKET_STATUS', name: 'Ticket Status', source: 'PICKLIST', listKey: 'ticketStatus', description: 'Lifecycle statuses shown on the ticket screens.' },
  { code: 'DEPARTMENT', name: 'Department', source: 'PICKLIST', listKey: 'department' },
  { code: 'TICKET_CATEGORY', name: 'Ticket Category', source: 'PICKLIST', listKey: 'ticketCategory' },
  { code: 'TICKET_SUB_CATEGORY', name: 'Ticket Sub Category', source: 'PICKLIST', listKey: 'subCategory', parentListKey: 'ticketCategory' },
  { code: 'REQUEST_TYPE', name: 'Request Type', source: 'PICKLIST', listKey: 'requestType' },

  // ---- Knowledge Base (PicklistOption, Knowledge Base module) ----
  { code: 'KB_MODULE', name: 'KB Module', source: 'PICKLIST', module: 'KNOWLEDGE_BASE', listKey: 'kbModule' },
  { code: 'KB_CATEGORY', name: 'KB Category', source: 'PICKLIST', module: 'KNOWLEDGE_BASE', listKey: 'kbCategory' },
  { code: 'KB_SUB_CATEGORY', name: 'KB Sub Category', source: 'PICKLIST', module: 'KNOWLEDGE_BASE', listKey: 'kbSubCategory', parentListKey: 'kbCategory' },
  {
    code: 'EXPENSE_CATEGORY', name: 'Project Expense Category', source: 'PICKLIST', module: 'PROJECTS', listKey: 'expenseCategory',
    description: 'Category on a project expense (Financials tab).',
    defaultValues: ['Consultant Cost', 'Travel', 'Accommodation', 'Food', 'Hardware', 'Software', 'Cloud', 'Third Party', 'Training', 'Other Expenses'],
  },
  {
    code: 'TIMESHEET_ACTIVITY', name: 'Timesheet Activity', source: 'PICKLIST', module: 'PROJECTS', listKey: 'timesheetActivity',
    description: 'The Activity column on the weekly timesheet.',
    defaultValues: ['Blueprint', 'System Configuration', 'Unit Testing', 'UAT', 'Training', 'Cut over', 'PRD Deployment', 'Go-Live Support'],
  },
  {
    code: 'PROJECT_DOCUMENT_TYPE', name: 'Project Document Type', source: 'PICKLIST', module: 'PROJECTS', listKey: 'projectDocumentType',
    description: 'Type of a document on the project Documents tab (ProjectDocument.docType).',
    defaultValues: ['Blueprint', 'Requirement', 'Design', 'Test Plan', 'Manual', 'Contract', 'Other'],
  },
  {
    code: 'PROJECT_INVOICE_TYPE', name: 'Project Invoice Type', source: 'PICKLIST', module: 'PROJECTS', listKey: 'projectInvoiceType',
    description: 'Commercial model on a project invoice (Financials tab).',
    defaultValues: ['Fixed Price', 'Time & Material', 'AMC', 'Internal'],
  },

  // ---- Organization (PicklistOption, Organization module) ----
  {
    code: 'DATE_FORMAT', name: 'Date Format', source: 'PICKLIST', module: 'ORGANIZATION', listKey: 'dateFormat',
    description: "Patterns offered for the tenant's date format on the Organization screen (Client.dateFormat).",
    // Token patterns, not display text: `frontend/src/lib/dateFormat.ts` renders
    // them, so a value added here must use the tokens it knows — yyyy yy MMMM
    // MMM MM M dd d HH hh mm ss a. The screen previews today's date beside each.
    defaultValues: [
      'dd/MM/yyyy', 'MM/dd/yyyy', 'yyyy-MM-dd', 'dd-MM-yyyy', 'dd.MM.yyyy',
      'dd MMM yyyy', 'MMM dd, yyyy', 'd MMMM yyyy',
    ],
  },
  {
    code: 'TIME_FORMAT', name: 'Time Format', source: 'PICKLIST', module: 'ORGANIZATION', listKey: 'timeFormat',
    description: "Clock offered for the tenant's time format on the Organization screen (Client.timeFormat); the ticket screens append it to the date format.",
    // Same token vocabulary as DATE_FORMAT — HH is 24-hour, hh + a is 12-hour.
    defaultValues: ['HH:mm', 'hh:mm a', 'HH:mm:ss', 'hh:mm:ss a'],
  },
  {
    code: 'CURRENCY', name: 'Currency', source: 'PICKLIST', module: 'ORGANIZATION', listKey: 'currency',
    description: 'Currency the organization trades in (Client.currency). Stored config — no screen reads it yet.',
    defaultValues: ['USD', 'EUR', 'GBP', 'INR', 'AED', 'SAR'],
  },

  // ---- Employee Master (PicklistOption, Employee Master module) ----
  // Only the *classification* fields are lists. The identity fields — employee
  // id, asset id, serial number, model, PO and invoice number — stay free text:
  // each names one person or one physical unit, so there is no shared vocabulary
  // to agree on and a dropdown of them would grow without bound.
  {
    code: 'EMPLOYEE_DEPARTMENT', name: 'Employee Department', source: 'PICKLIST', module: 'EMPLOYEE_MASTER', listKey: 'employeeDepartment',
    description: 'Department on an employee record (Employee Master).',
    // Deliberately its own list rather than sharing DEPARTMENT: that one is the
    // ticket field's list and carries a different vocabulary (it, hr, finance,
    // operations), so merging them would corrupt both dropdowns.
    defaultValues: [
      'Delivery', 'Support', 'Quality Assurance', 'Infrastructure',
      'Finance', 'Human Resources', 'Sales', 'Administration',
    ],
  },
  {
    code: 'DESIGNATION', name: 'Designation', source: 'PICKLIST', module: 'EMPLOYEE_MASTER', listKey: 'designation',
    description: 'Job title on an employee record (Employee Master).',
    defaultValues: [
      'Trainee', 'Junior Consultant', 'Consultant', 'Senior Consultant', 'Analyst',
      'QA Engineer', 'Senior QA Engineer', 'Support Engineer', 'Senior Support Engineer',
      'Network Engineer', 'System Administrator', 'Team Lead', 'Support Lead',
      'Delivery Manager', 'Support Manager', 'Finance Executive', 'Platform Administrator',
    ],
  },

  // ---- Asset Master (PicklistOption, Asset Master module) ----
  {
    code: 'ASSET_TYPE', name: 'Asset Type', source: 'PICKLIST', module: 'ASSET_MASTER', listKey: 'assetType',
    description: 'What kind of thing an asset is (Asset Master), e.g. Laptop.',
    defaultValues: [
      'Laptop', 'Desktop', 'Monitor', 'Mobile Phone', 'Tablet', 'Headset',
      'Docking Station', 'Peripheral', 'Printer', 'Projector', 'Server',
      'Network Device', 'Access Card', 'Software License',
    ],
  },
  {
    code: 'ASSET_CATEGORY', name: 'Asset Category', source: 'PICKLIST', module: 'ASSET_MASTER', listKey: 'assetCategory',
    description: 'How an asset is grouped for reporting (Asset Master), e.g. IT Equipment.',
    defaultValues: [
      'IT Equipment', 'Communication', 'Office Equipment', 'Data Centre',
      'Security', 'Furniture', 'Software',
    ],
  },

  // ---- Change Management (ChangeRequestOption) ----
  { code: 'CHANGE_TYPE', name: 'Change Type', source: 'CHANGE_REQUEST', listKey: 'change_type', description: 'Major / Minor / Standard need CAB sign-off; Emergency is exempt.' },
  { code: 'CHANGE_GROUP', name: 'Change Group', source: 'CHANGE_REQUEST', listKey: 'change_group' },
  { code: 'CHANGE_REQUEST_TYPE', name: 'Change Request Type', source: 'CHANGE_REQUEST', listKey: 'type' },
  { code: 'CHANGE_PRIORITY', name: 'Change Priority', source: 'CHANGE_REQUEST', listKey: 'priority' },
  { code: 'CHANGE_CATEGORY', name: 'Change Category', source: 'CHANGE_REQUEST', listKey: 'category' },
  { code: 'CHANGE_SUB_CATEGORY', name: 'Change Sub Category', source: 'CHANGE_REQUEST', listKey: 'subcategory', parentListKey: 'category' },
  { code: 'CHANGE_IMPACT', name: 'Change Impact', source: 'CHANGE_REQUEST', listKey: 'impact' },
  { code: 'CHANGE_RISK', name: 'Change Risk', source: 'CHANGE_REQUEST', listKey: 'risk' },
  { code: 'CHANGE_STATUS', name: 'Change Status', source: 'CHANGE_REQUEST', listKey: 'status' },
  { code: 'CHANGE_COMPLEXITY', name: 'Change Complexity', source: 'CHANGE_REQUEST', listKey: 'complexity' },
  { code: 'CHANGE_DEV_STATUS', name: 'Development Status', source: 'CHANGE_REQUEST', listKey: 'dev_status' },
  { code: 'CHANGE_TEST_STATUS', name: 'Testing Status', source: 'CHANGE_REQUEST', listKey: 'test_status' },
  { code: 'CHANGE_DOC_TITLE', name: 'Document Title', source: 'CHANGE_REQUEST', listKey: 'doc_title' },
  { code: 'CHANGE_YES_NO', name: 'Yes / No', source: 'CHANGE_REQUEST', listKey: 'yes_no' },
  { code: 'CHANGE_APPROVAL', name: 'Approval', source: 'CHANGE_REQUEST', listKey: 'approval' },
];
