/**
 * Fixed vocabulary of the Email Configuration screen. Not an option list: the
 * ticket notifications (`TicketsService.fireEvent`) branch on these keys.
 * Mirrored in `frontend/src/pages/email-config/notificationMeta.ts`.
 */
export const NOTIFICATION_EVENTS = [
  'TICKET_CREATED',
  'TICKET_ASSIGNED',
  'TICKET_REASSIGNED',
  'TICKET_ACCEPTED',
  'INFO_REQUESTED',
  'REQUESTER_RESPONDED',
  'TICKET_IN_PROGRESS',
  'TICKET_RESOLVED',
  'TICKET_REOPENED',
  'TICKET_CLOSED',
  'SLA_BREACHED',
  'TICKET_ESCALATED',
] as const;
export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number];

export const NOTIFICATION_RECIPIENTS = [
  'REQUESTOR',
  'ASSIGNED_AGENT',
  'NEW_ASSIGNED_AGENT',
  'PREVIOUS_AGENT',
  'HELPDESK_EMAIL',
  'SUPPORT_MANAGER',
  'PROJECT_MANAGER',
  'CLIENT_ADMIN',
  'TENANT_ADMINS',
] as const;
export type NotificationRecipient = (typeof NOTIFICATION_RECIPIENTS)[number];

/**
 * An address, not a user: in a row that ticks Bell it still gets the email
 * only, while everyone else in the row gets both.
 */
export const EMAIL_ONLY_RECIPIENTS: readonly string[] = ['HELPDESK_EMAIL'];

export interface NotificationRuleInput {
  event: string;
  recipients: string[];
  email: boolean;
  bell: boolean;
}

const row = (event: NotificationEvent, recipients: NotificationRecipient[], email: boolean, bell: boolean) =>
  ({ event, recipients, email, bell }) as NotificationRuleInput;

/**
 * A tenant's starting matrix: the team lead's confirmed list, plus every
 * notice the ticket flow sent before the screen drove it (Admins' and the
 * project manager's bells, the client admin's copies, the helpdesk CC on every
 * ticket email), so nobody went quiet when it took over. An event may take
 * several rows — that is how one recipient gets a bell only while another gets
 * both.
 */
export const DEFAULT_RULES: NotificationRuleInput[] = [
  row('TICKET_CREATED', ['REQUESTOR', 'HELPDESK_EMAIL'], true, true),
  row('TICKET_CREATED', ['ASSIGNED_AGENT'], true, false),
  row('TICKET_CREATED', ['TENANT_ADMINS', 'PROJECT_MANAGER'], false, true),
  row('TICKET_ASSIGNED', ['ASSIGNED_AGENT', 'TENANT_ADMINS', 'HELPDESK_EMAIL'], true, true),
  row('TICKET_ASSIGNED', ['PROJECT_MANAGER'], false, true),
  row('TICKET_REASSIGNED', ['NEW_ASSIGNED_AGENT', 'REQUESTOR', 'CLIENT_ADMIN', 'TENANT_ADMINS', 'HELPDESK_EMAIL'], true, true),
  row('TICKET_REASSIGNED', ['PREVIOUS_AGENT', 'PROJECT_MANAGER'], false, true),
  row('TICKET_ACCEPTED', ['REQUESTOR', 'CLIENT_ADMIN', 'HELPDESK_EMAIL'], true, true),
  row('INFO_REQUESTED', ['REQUESTOR', 'HELPDESK_EMAIL'], true, true),
  row('REQUESTER_RESPONDED', ['ASSIGNED_AGENT', 'HELPDESK_EMAIL'], true, false),
  row('TICKET_IN_PROGRESS', ['REQUESTOR', 'HELPDESK_EMAIL'], true, false),
  row('TICKET_RESOLVED', ['REQUESTOR', 'HELPDESK_EMAIL'], true, true),
  row('TICKET_RESOLVED', ['CLIENT_ADMIN', 'PROJECT_MANAGER'], false, true),
  row('TICKET_REOPENED', ['ASSIGNED_AGENT', 'HELPDESK_EMAIL'], true, true),
  row('TICKET_REOPENED', ['TENANT_ADMINS', 'PROJECT_MANAGER'], false, true),
  row('TICKET_CLOSED', ['REQUESTOR', 'ASSIGNED_AGENT', 'HELPDESK_EMAIL'], true, true),
  row('TICKET_CLOSED', ['CLIENT_ADMIN', 'PROJECT_MANAGER'], false, true),
  row('SLA_BREACHED', ['ASSIGNED_AGENT', 'HELPDESK_EMAIL'], true, true),
  row('TICKET_ESCALATED', ['SUPPORT_MANAGER', 'HELPDESK_EMAIL'], true, true),
];
