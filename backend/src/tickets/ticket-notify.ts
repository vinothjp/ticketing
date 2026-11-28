import type { NotificationEvent, NotificationRecipient } from '../notification-rules/notification-vocab';
import type { TicketEmailContent } from './ticket-email';

/**
 * Who hears of a ticket event, and how, is the tenant's Email Configuration
 * matrix (`NotificationRule`). This file is the pure half of that: turning the
 * event's rows plus the people each recipient role names into one delivery per
 * person. `TicketsService.fireEvent` resolves the people and sends.
 */

/** Which wording a person gets: the client's, the working agent's, or a staff watcher's. */
export type Audience = 'client' | 'agent' | 'staff';
export type PersonRole = Exclude<NotificationRecipient, 'HELPDESK_EMAIL'>;

export const AUDIENCE: Record<PersonRole, Audience> = {
  REQUESTOR: 'client',
  CLIENT_ADMIN: 'client',
  ASSIGNED_AGENT: 'agent',
  NEW_ASSIGNED_AGENT: 'agent',
  PREVIOUS_AGENT: 'agent',
  SUPPORT_MANAGER: 'staff',
  PROJECT_MANAGER: 'staff',
  TENANT_ADMINS: 'staff',
};

/**
 * One person named by two roles (an Admin who is also the agent) is told once,
 * in the wording of the most specific role.
 */
const ROLE_PRIORITY: PersonRole[] = [
  'NEW_ASSIGNED_AGENT', 'PREVIOUS_AGENT', 'ASSIGNED_AGENT', 'REQUESTOR', 'CLIENT_ADMIN',
  'SUPPORT_MANAGER', 'PROJECT_MANAGER', 'TENANT_ADMINS',
];
/** Client sends go first, so the helpdesk copy rides on the client's email, as it always did. */
const AUDIENCE_ORDER: Audience[] = ['client', 'agent', 'staff'];

/** A person a role resolves to. `id` null = an address only (a requester with no login). */
export interface NotifyPerson {
  id: string | null;
  email: string | null;
  name?: string | null;
  username?: string | null;
}

export interface Delivery {
  person: NotifyPerson;
  role: PersonRole;
  audience: Audience;
  email: boolean;
  bell: boolean;
}

export interface RuleRow {
  recipients: string[];
  email: boolean;
  bell: boolean;
}

const personKey = (p: NotifyPerson) => p.id ?? `mail:${p.email?.trim().toLowerCase() ?? ''}`;

/**
 * Merge an event's rows into one delivery per person. A person's email and bell
 * are the union over every row naming them; a bell needs a user to land on, so
 * an address-only person (or the helpdesk) only ever takes the email. `helpdesk`
 * says whether any row emails the helpdesk address.
 */
export function planDelivery(
  rows: RuleRow[],
  people: Partial<Record<PersonRole, NotifyPerson[]>>,
  skip: (p: NotifyPerson, role: PersonRole) => boolean = () => false,
): { deliveries: Delivery[]; helpdesk: boolean } {
  const byKey = new Map<string, Delivery>();
  let helpdesk = false;
  for (const r of rows) {
    for (const role of r.recipients) {
      if (role === 'HELPDESK_EMAIL') {
        helpdesk ||= r.email;
        continue;
      }
      if (!(role in AUDIENCE)) continue;
      const pr = role as PersonRole;
      for (const p of people[pr] ?? []) {
        if (skip(p, pr)) continue;
        const key = personKey(p);
        if (key === 'mail:') continue;
        const d = byKey.get(key);
        if (!d) {
          byKey.set(key, { person: p, role: pr, audience: AUDIENCE[pr], email: r.email, bell: r.bell && !!p.id });
          continue;
        }
        if (ROLE_PRIORITY.indexOf(pr) < ROLE_PRIORITY.indexOf(d.role)) {
          d.role = pr;
          d.audience = AUDIENCE[pr];
        }
        d.email ||= r.email;
        d.bell ||= r.bell && !!p.id;
      }
    }
  }
  const deliveries = [...byKey.values()].sort(
    (a, b) => AUDIENCE_ORDER.indexOf(a.audience) - AUDIENCE_ORDER.indexOf(b.audience),
  );
  return { deliveries, helpdesk };
}

/** The roles any of an event's rows name — only these are worth looking up. */
export function rolesNamed(rows: RuleRow[]): Set<PersonRole> {
  const out = new Set<PersonRole>();
  for (const r of rows) for (const x of r.recipients) if (x in AUDIENCE) out.add(x as PersonRole);
  return out;
}

export interface EventMail {
  subject: string;
  content: TicketEmailContent;
}
export interface EventBell {
  type: string;
  title: string;
  body: string;
  link?: string;
}

/** How each event reads when no wording was written for the audience an admin added to it. */
const EVENT_TITLE: Record<NotificationEvent, string> = {
  TICKET_CREATED: 'Ticket Created',
  TICKET_ASSIGNED: 'Ticket Assigned',
  TICKET_REASSIGNED: 'Ticket Reassigned',
  TICKET_ACCEPTED: 'Ticket Accepted',
  INFO_REQUESTED: 'Additional Information Requested',
  REQUESTER_RESPONDED: 'Client Response',
  TICKET_IN_PROGRESS: 'Ticket In Progress',
  TICKET_RESOLVED: 'Ticket Resolved',
  TICKET_REOPENED: 'Ticket Reopened',
  TICKET_CLOSED: 'Ticket Closed',
  SLA_BREACHED: 'SLA Breached',
  TICKET_ESCALATED: 'Ticket Escalated',
};
const EVENT_PHRASE: Record<NotificationEvent, string> = {
  TICKET_CREATED: 'has been created',
  TICKET_ASSIGNED: 'has been assigned',
  TICKET_REASSIGNED: 'has been reassigned',
  TICKET_ACCEPTED: 'has been accepted by the support team',
  INFO_REQUESTED: 'is waiting for additional information from the requester',
  REQUESTER_RESPONDED: 'has a response from the requester',
  TICKET_IN_PROGRESS: 'is now in progress',
  TICKET_RESOLVED: 'has been resolved',
  TICKET_REOPENED: 'has been reopened',
  TICKET_CLOSED: 'has been closed',
  SLA_BREACHED: 'has breached its SLA',
  TICKET_ESCALATED: 'has been escalated',
};

/** The fallback letter for an (event, audience) pair the call site wrote no wording for. */
export function fallbackMail(event: NotificationEvent, audience: Audience, ticketNumber: string): EventMail {
  const phrase = EVENT_PHRASE[event];
  return {
    subject: `[${EVENT_TITLE[event]}] - ${ticketNumber}`,
    content:
      audience === 'client'
        ? {
            intro: `This is to inform you that your support ticket ${phrase}.`,
            fields: ['number', 'subject', 'priority', 'status', 'assignedAgent'],
            outro: 'You can track the status of your request through the ticketing portal.',
          }
        : {
            intro: `The following support ticket ${phrase}.`,
            fields: ['number', 'subject', 'requestedBy', 'client', 'priority', 'status', 'assignedAgent', 'dueDate'],
          },
  };
}

export function fallbackBell(event: NotificationEvent, label: string, detail?: string | null): EventBell {
  return { type: event, title: EVENT_TITLE[event], body: `${label}${detail ? ` · ${detail}` : ''}` };
}
