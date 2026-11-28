import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TemplatesService } from '../templates/templates.service';
import { ActivityService } from '../activity/activity.service';
import { MailerService } from '../mail/mailer.service';
import { ProductsService } from '../products/products.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CustomerProductsService } from '../customer-companies/customer-products.service';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { UpdateTicketDto } from './dto/update-ticket.dto';
import { CreateWorklogDto, UpdateWorklogDto } from './dto/worklog.dto';
import { SETTLED_TASK_STATUSES } from '../tasks/task-status';
import { productOffForClient } from '../customer-companies/module-switch';
import { exportSheet as buildSheet, tenantDateFormat } from '../lib/spreadsheet';
import { TICKET_COLUMNS, type TicketSheetRow } from './ticket-sheet';
import {
  FREE_STATUS_LABELS, issueTypeLabel, offeredIssueTypes, pickLeastLoaded, routingIssueType, type AgentPicker,
} from './auto-assign';
import { formatTenantStamp, renderTicketEmail, type TicketEmailContent, type TicketEmailFacts } from './ticket-email';
import { NotificationRulesService } from '../notification-rules/notification-rules.service';
import type { NotificationEvent } from '../notification-rules/notification-vocab';
import {
  fallbackBell, fallbackMail, planDelivery, rolesNamed,
  type Audience, type Delivery, type EventBell, type EventMail, type NotifyPerson, type PersonRole,
} from './ticket-notify';

const FIELD_KEY_TO_DTO_PROP: Record<string, keyof CreateTicketDto> = {
  requestorName: 'requestorName',
  customerName: 'customerName',
  department: 'department',
  requestorContact: 'requestorContact',
  priority: 'priority',
  ticketCategory: 'ticketCategory',
  subCategory: 'subCategory',
  consultantType: 'consultantType',
  technicians: 'technicianUserIds',
  notifyEmails: 'notifyEmails',
  dueDate: 'dueDate',
  expectedResolutionDate: 'expectedResolutionDate',
  subject: 'subject',
  description: 'description',
};

const DAY_MS = 24 * 60 * 60 * 1000;
/** Fallback reopen window for a tenant whose row predates the setting. */
const DEFAULT_REOPEN_WINDOW_DAYS = 30;
const DEFAULT_MAX_REOPENS = 3;
/** Fallback auto-close window for a tenant whose row predates the setting. */
const DEFAULT_AUTO_CLOSE_DAYS = 3;
/** The Ticket Status value every reopen writes (client request); see `reopenedStatus`. */
const REOPENED_STATUS = 'Reopened';
/*
 * Statuses the status emails and the SLA escalation key off — by the tenant's
 * *label*, lower-cased (`statusLabel`), so a renamed value still counts.
 */
/** Waiting on the client: asks them for information (template 5), and pauses escalation. */
const AWAITING_CLIENT_STATUS = 'awaiting end-user response';
/** Waiting on someone else: pauses escalation too. */
const ON_HOLD_STATUS = 'on hold';
/** Being worked on: tells the client so (template 7); where a client's response returns it. */
const IN_PROGRESS_STATUS = 'in progress';

function isEmpty(value: unknown) {
  return (
    value === undefined ||
    value === null ||
    value === '' ||
    (Array.isArray(value) && value.length === 0)
  );
}

/** The authenticated user viewing/acting on tickets. Admins see all; others only their assigned tickets. */
export type TicketViewer = { id: string; roles: string[]; customerCompanyId?: string | null };
/** The coordinates a worklog's hours are charged against: the ticket's customer + product. */
type WorklogTicket = { id: string; customerCompanyId: string | null; productId: string | null };
/** An agent on either side of a reassignment. */
type Agent = { id: string; username: string; name?: string | null; email: string | null };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** A person as other people read them: their full name, else their login. */
const displayName = (u: { name?: string | null; username?: string | null }) =>
  u.name?.trim() || u.username || '';

/** What every ticket email needs to load its facts (`ticketEmailFacts`). */
type EmailTicket = { id: string; ticketNumber: string; subject: string };
/** A ticket as `fireEvent` reads it: who it is for, and the people around it. */
type NotifyTicket = EmailTicket & {
  customerCompanyId: string | null;
  productId: string | null;
  requestorUserId: string | null;
  requestorEmail: string | null;
  requestorName: string | null;
  resolvedById?: string | null;
};
/** What one ticket event says, per recipient role or audience; anything unset falls back to a plain notice. */
type EventContext = {
  ticket: NotifyTicket;
  /** Whoever caused it. Staff are never told of their own action; a client is (it is their receipt). */
  actorId?: string | null;
  /** People a role names that the ticket row can't tell (e.g. the agents either side of a reassignment). */
  people?: Partial<Record<PersonRole, NotifyPerson[]>>;
  mail?: Partial<Record<PersonRole | Audience, EventMail>>;
  bell?: Partial<Record<PersonRole | Audience, EventBell>>;
  /** Appended to a fallback bell's body. */
  detail?: string | null;
  /** Roles this one occurrence leaves out because they are told another way. */
  skipRoles?: PersonRole[];
  skipUserIds?: (string | null | undefined)[];
  /** Bells only this time (a client's emailed reply has already reached the agent). */
  emailOff?: boolean;
};

/*
 * The team lead's email templates, one per event (wording theirs; the rows of
 * each "Ticket Details" table are the template's own). Kept together so two
 * events sending the same template — e.g. Created on raising and on a company
 * admin's approval — can't drift apart.
 */
const MAIL = {
  /** 1. Ticket Created — to the requester. */
  created: (lead: string): TicketEmailContent => ({
    intro: `${lead}\nOur support team will review your request and take the necessary action.`,
    fields: ['number', 'subject', 'category', 'priority', 'status', 'createdDate', 'department'],
    description: true,
    outro: 'You can track the status of your request and add additional comments through the ticketing portal.',
    thanks: 'Thank you for contacting the Support Team.',
    signOff: 'Regards',
  }),
  /** 2. Ticket Assigned — to the agent. */
  assigned: (): TicketEmailContent => ({
    intro: 'A support ticket has been assigned to you.\nPlease review the ticket details and take the necessary action within the defined SLA.',
    fields: ['number', 'subject', 'requestedBy', 'client', 'department', 'category', 'priority', 'assignedTeam', 'dueDate'],
    description: true,
    outro: 'Please acknowledge and begin working on the ticket.',
    linkLabel: 'View Assigned Ticket',
  }),
  /** 3. Ticket Reassigned — to the new agent. */
  reassigned: (previous: string, next: string): TicketEmailContent => ({
    intro: 'The following support ticket has been reassigned to you.\nPlease review the ticket history, previous comments and actions before proceeding.',
    fields: [
      'number', 'subject', 'requestedBy', 'client', 'category', 'priority',
      ['Previous Assigned Agent', previous], ['New Assigned Agent', next], 'assignedTeam', 'dueDate',
    ],
    outro: 'Please take ownership and proceed with the necessary action.',
  }),
  /** 4. Ticket Accepted — to the requester, once an agent has it. */
  accepted: (): TicketEmailContent => ({
    intro: 'Your support request has been reviewed and accepted by our support team.\nThe ticket is now assigned to the responsible support personnel for further action.',
    fields: ['number', 'subject', 'category', 'priority', 'status', 'assignedTeam', 'assignedAgent', { key: 'dueDate', label: 'Expected SLA Due Date' }],
    outro: 'Our team will keep you informed about further progress.',
    thanks: 'Thank you for your patience.',
  }),
  /** 10. Ticket Closed — to the requester. */
  closed: (): TicketEmailContent => ({
    intro: 'Your support ticket has been successfully closed.\nThank you for confirming the resolution or for allowing the ticket to be closed in accordance with our support policy.',
    fields: ['number', 'subject', 'category', 'priority', 'status', 'assignedAgent', 'createdDate', 'closedDate'],
    resolution: 'Final Resolution',
    outro: 'If you experience the same issue again, please raise a new support ticket through the portal and refer to this ticket number where relevant.',
    linkLabel: 'View Closed Ticket',
    thanks: 'Thank you for using our Support Desk.',
  }),
  /** 5. Additional Information Requested — to the requester. */
  infoRequested: (info: string): TicketEmailContent => ({
    intro: 'Our support team is reviewing your request. However, we require some additional information to proceed with the investigation.',
    fields: ['number', 'subject', 'priority', 'assignedAgent', { key: 'status', label: 'Current Status' }],
    sections: [{ title: 'Additional Information Required', body: info }],
    outro: 'Please provide the requested information or attach the necessary documents through the ticketing portal.\n' +
      'Your response will help us resolve the issue more efficiently.',
    linkLabel: 'Respond to Ticket',
    linkQuery: '?tab=conversation',
  }),
  /** 6. Requestor Responded — to the assigned agent. */
  requesterResponded: (response: string): TicketEmailContent => ({
    intro: 'The requestor has provided an update to the following support ticket.',
    fields: ['number', 'subject', 'requestedBy', 'client', 'department', 'priority', { key: 'status', label: 'Current Status' }],
    sections: [{ title: 'Requestor Response', body: response }],
    outro: "Please review the requestor's response and proceed with the necessary action.",
    linkQuery: '?tab=conversation',
  }),
  /** 7. Ticket In Progress — to the requester. */
  inProgress: (latestUpdate: string | null): TicketEmailContent => ({
    intro: 'We would like to inform you that our support team has started working on your request.',
    fields: ['number', 'subject', 'priority', 'status', 'assignedAgent', { key: 'assignedTeam', label: 'Support Team' }],
    sections: [{ title: 'Latest Update', body: latestUpdate }],
    outro: 'Our support team is actively investigating the issue and will keep you informed of further developments.',
    linkLabel: 'Track Ticket',
  }),
  /** 11. SLA Breached — to the assigned agent, sent with the escalation. */
  slaBreached: (breachedOn: string | null, delay: string, remarks: string | null, escalatedTo: string | null): TicketEmailContent => ({
    intro: 'This is to notify you that the following support ticket assigned to you has breached its defined Service Level Agreement (SLA).\n' +
      'Immediate attention is required to review the delay and ensure appropriate action is taken.',
    fields: [
      'number', 'subject', 'requestedBy', 'client', 'category', 'priority',
      { key: 'status', label: 'Current Status' }, 'assignedAgent', { key: 'assignedTeam', label: 'Support Team' },
      'dueDate', ['SLA Breach Date', breachedOn], ['Delay Duration', delay],
    ],
    sections: [{ title: 'Current Ticket Remarks', body: remarks ?? 'No update has been recorded on the ticket yet.' }],
    outro: 'Please review the ticket and take the necessary corrective action.' +
      (escalatedTo ? ` The ticket has also been escalated to ${escalatedTo}.` : ''),
    linkLabel: 'View Breached Ticket',
  }),
  /** 12. Ticket Escalated (with 11. SLA Breached's timings) — to the project manager. */
  escalated: (breachedOn: string | null, delay: string, remarks: string | null): TicketEmailContent => ({
    intro: 'The following support ticket has been escalated to you and requires your attention.\n' +
      'The escalation has been raised automatically because the ticket has breached its resolution SLA.',
    fields: [
      'number', 'subject', 'requestedBy', 'client', 'department', 'category', 'priority',
      { key: 'status', label: 'Current Status' }, { key: 'assignedAgent', label: 'Current Assigned Agent' },
      { key: 'assignedTeam', label: 'Support Team' }, ['Escalation Level', 'Level 1 — Project Manager'],
      'dueDate', ['SLA Breach Date', breachedOn], ['Delay Duration', delay],
    ],
    sections: [
      { title: 'Escalation Reason', body: 'The ticket was not resolved within its SLA resolution time.' },
      { title: 'Escalation Remarks', body: remarks ?? 'No update has been recorded on the ticket by the support team.' },
    ],
    outro: 'Please review the ticket and provide the necessary direction to ensure timely resolution.',
    linkLabel: 'View Escalated Ticket',
  }),
  /** Closed — the agents' copy (no template of its own; same rows the staff templates use). */
  closedForAgents: (intro: string): TicketEmailContent => ({
    intro,
    fields: ['number', 'subject', 'requestedBy', 'client', 'priority', 'status', 'resolvedDate', 'closedDate'],
  }),
};
const isAdmin = (viewer: TicketViewer) => viewer.roles.includes('Admin');
// Customer side = a company's own admin + its employees.
const isCustomerAdmin = (viewer: TicketViewer) => viewer.roles.includes('CustomerAdmin');
const isCustomerSide = (viewer: TicketViewer) =>
  viewer.roles.includes('Customer') || viewer.roles.includes('CustomerAdmin');
// An employee is a customer-side user who is NOT their company's admin.
const isCustomerEmployee = (viewer: TicketViewer) => isCustomerSide(viewer) && !isCustomerAdmin(viewer);

@Injectable()
export class TicketsService {
  private readonly logger = new Logger(TicketsService.name);

  constructor(
    private prisma: PrismaService,
    private templatesService: TemplatesService,
    private activity: ActivityService,
    private mailer: MailerService,
    private products: ProductsService,
    private notifications: NotificationsService,
    private customerProducts: CustomerProductsService,
    private notificationRules: NotificationRulesService,
  ) {}

  async create(dto: CreateTicketDto, clientId: string, actorId: string, viewer?: TicketViewer) {
    // A customer ticket becomes active immediately and is auto-routed to a
    // consultant — unless its template needs approval (below). A customer can
    // only raise a ticket under their own company and can't self-assign
    // technicians (forced server-side).
    const isCustomerTicket = viewer ? isCustomerSide(viewer) : false;
    let requestorDefaults: { name?: string; email?: string; companyId?: string } = {};
    if (viewer && isCustomerSide(viewer)) {
      // A customer must belong to a company; otherwise the ticket would be
      // orphaned (no company) and invisible even to its own creator.
      if (!viewer.customerCompanyId) {
        throw new BadRequestException('Your account is not linked to a customer company');
      }
      const me = await this.prisma.user.findUnique({
        where: { id: viewer.id },
        select: { username: true, name: true, email: true },
      });
      dto = {
        ...dto,
        customerCompanyId: viewer.customerCompanyId ?? undefined,
        technicianUserIds: [],
        requestorUserId: viewer.id,
      } as CreateTicketDto & { requestorUserId?: string };
      // The requester of record by full name (it greets them in every email) —
      // a username is often an employee id (client request).
      requestorDefaults = { name: me ? displayName(me) : undefined, email: me?.email, companyId: viewer.customerCompanyId ?? undefined };
      // A client whose support hours are spent may be barred from raising more
      // tickets — configured per pool on the client screen. Staff-raised tickets
      // are never gated.
      await this.customerProducts.assertMayRaiseTicket(
        clientId, viewer.customerCompanyId, dto.productId ?? null,
      );
    } else if (!dto.requestorName?.trim() && !dto.requestorEmail?.trim()) {
      // Staff raising a ticket with no requester named: the person who raised it
      // is the requester of record (client request — it used to read "—"). Name
      // only: no email, so no client-facing mail is redirected to the raiser.
      const me = await this.prisma.user.findUnique({ where: { id: actorId }, select: { username: true, name: true } });
      if (me) requestorDefaults = { name: me.name?.trim() || me.username };
    }
    // Modules switched off for this client on their product screen can't be
    // named on their new tickets, and with every module off the product itself
    // is inactive for them. The form no longer offers either; this closes the
    // API behind it. Internal tickets have no client, so nothing to check.
    if (dto.customerCompanyId && dto.productId) {
      const link = await this.prisma.customerCompanyProduct.findFirst({
        where: { customerCompanyId: dto.customerCompanyId, productId: dto.productId, customerCompany: { clientId } },
        select: { inactiveModuleIds: true, product: { select: { name: true, modules: { select: { id: true } } } } },
      });
      if (link && productOffForClient(link.product.modules.map((m) => m.id), link.inactiveModuleIds)) {
        throw new BadRequestException(`${link.product.name} is inactive for this client — every one of its modules is switched off.`);
      }
      if (dto.moduleId && link?.inactiveModuleIds.includes(dto.moduleId)) {
        throw new BadRequestException(`That module is switched off for this client and can't be used on a new ticket.`);
      }
    }

    const template = await this.templatesService.getById(
      dto.templateId,
      clientId,
    );
    // A template that needs approval (Change Request) holds an agent's or a
    // customer's ticket at PENDING until a tenant Admin decides it; an Admin's
    // own ticket goes straight through. While it waits nobody is assigned and
    // its SLA clock does not run — both start in `approve()`.
    const needsProviderApproval = template.requiresApproval && !(viewer && isAdmin(viewer));
    // On a template that needs approval, a customer's *employee* asks their own
    // company admin first (PENDING_CUSTOMER), who forwards it to the provider's
    // Admin (PENDING). Any other ticket an employee raises is live at once — the
    // every-ticket company-admin approval was withdrawn (client request). A
    // customer admin's own request, and an agent's, go straight to the Admin; a
    // company with no active customer admin has nobody to ask, so it does too.
    const needsCustomerApproval =
      needsProviderApproval && !!viewer && isCustomerEmployee(viewer) &&
      (await this.hasCustomerAdmin(clientId, viewer.customerCompanyId));
    // Held: no assignee, no routing and no deadline until the last approval.
    const needsApproval = needsProviderApproval || needsCustomerApproval;
    if (needsApproval) dto = { ...dto, technicianUserIds: [] };

    // Server-side is the source of truth for "required" — it's tenant-configured
    // data, so the client's zod validation alone can't be trusted. We also
    // collect custom-field values into the JSONB bag here.
    const missing: string[] = [];
    const customFields: Record<string, unknown> = {};
    for (const field of template.fields) {
      if (field.visibility !== 'VISIBLE') continue;

      // Custom fields and JSON-backed catalog fields (request type, customer
      // confirmation, root cause) persist into the customFields JSONB bag.
      const jsonBacked = field.isCustom || field.storage === 'json';
      if (jsonBacked) {
        const value = dto.customFields?.[field.fieldKey];
        if (
          field.requirement === 'MANDATORY' &&
          !field.systemManaged &&
          isEmpty(value)
        ) {
          missing.push(field.label);
        }
        // FILE fields aren't persisted in JSONB (no per-field upload yet).
        if (!isEmpty(value) && field.dataType !== 'FILE') {
          customFields[field.fieldKey] = value;
        }
        continue;
      }

      if (field.systemManaged || field.requirement !== 'MANDATORY') continue;
      const dtoProp = FIELD_KEY_TO_DTO_PROP[field.fieldKey];
      if (!dtoProp) continue; // e.g. attachments — enforced client-side only for now
      if (isEmpty(dto[dtoProp])) missing.push(field.label);
    }
    const hasIssueType = template.fields.some((f) => f.fieldKey === 'consultantType' && f.visibility === 'VISIBLE');
    if (missing.length > 0) {
      throw new BadRequestException(
        `Missing required field(s): ${missing.join(', ')}`,
      );
    }

    const defaultStatusOption = await this.prisma.picklistOption.findFirst({
      where: { clientId, listKey: 'ticketStatus', isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
    const ticketStatus = defaultStatusOption?.value ?? 'New';

    // SLA: auto-fill resolution target + Due Date from the SLA policy for this priority.
    let slaHours: number | undefined;
    let slaDue: Date | undefined;
    if (dto.priority) {
      const sla = await this.prisma.slaPolicy.findFirst({
        where: { clientId, priority: dto.priority, isActive: true },
      });
      if (sla) {
        slaHours = sla.resolutionHours;
        slaDue = new Date(Date.now() + sla.resolutionHours * 3600 * 1000);
      }
    }

    const ticket = await this.prisma.$transaction(async (tx) => {
      const client = await tx.client.update({
        where: { id: clientId },
        data: { ticketSequence: { increment: 1 } },
      });
      const ticketNumber = `TCK-${String(client.ticketSequence).padStart(6, '0')}`;

      return tx.ticket.create({
        data: {
          clientId,
          ticketNumber,
          templateId: template.id,
          ticketStatus,
          // Seeded on creation so a brand-new ticket already reports how long it
          // has stood in its opening status, rather than nothing until someone
          // touches it.
          statusChangedAt: new Date(),
          approvalStatus: needsCustomerApproval ? 'PENDING_CUSTOMER' : needsApproval ? 'PENDING' : 'NONE',
          productId: dto.productId,
          moduleId: dto.moduleId,
          // Stored only when the template carries Issue type and one was picked
          // (client request); otherwise blank, and routing uses the default.
          consultantType: hasIssueType ? dto.consultantType : undefined,
          requestorName: dto.requestorName ?? requestorDefaults.name,
          requestorEmail: dto.requestorEmail ?? requestorDefaults.email,
          requestorUserId: (dto as { requestorUserId?: string }).requestorUserId,
          customerName: dto.customerName,
          customerCompanyId: dto.customerCompanyId,
          department: dto.department,
          requestorContact: dto.requestorContact,
          priority: dto.priority,
          ticketCategory: dto.ticketCategory,
          subCategory: dto.subCategory,
          notifyEmails: dto.notifyEmails ?? [],
          // A held ticket keeps its SLA hours but no deadline yet: the clock
          // starts on approval, so time spent waiting never counts against it.
          dueDate: dto.dueDate ? new Date(dto.dueDate) : needsApproval ? undefined : slaDue,
          expectedResolutionDate: dto.expectedResolutionDate
            ? new Date(dto.expectedResolutionDate)
            : needsApproval ? undefined : slaDue,
          slaHours,
          subject: dto.subject ?? '',
          description: dto.description ?? '',
          customFields: customFields as Prisma.InputJsonValue,
          createdBy: actorId,
          updatedBy: actorId,
          technicians: dto.technicianUserIds?.length
            ? { create: dto.technicianUserIds.map((userId) => ({ userId })) }
            : undefined,
        },
        include: { technicians: true, template: true },
      });
    });

    await this.activity.log({
      ticketId: ticket.id,
      actorUserId: actorId,
      type: 'CREATED',
      summary: 'Ticket created',
    });

    // A ticket held for approval is not live yet: its raiser is told it waits
    // for approval (the approval flow, not one of the Email Configuration
    // events), and 1. Created goes out on its last approval (`openHeldTicket`).
    if (isCustomerTicket && viewer && needsApproval) {
      const me = await this.prisma.user.findUnique({ where: { id: viewer.id }, select: { username: true, name: true, email: true } });
      await this.mailEach(
        clientId,
        ticket,
        [{ email: me?.email || ticket.requestorEmail, username: me?.username, name: me?.name }],
        `${ticket.ticketNumber} - Created`,
        {
          ...MAIL.created('Your support request has been successfully registered in our service desk.'),
          intro: 'Your support request has been successfully registered in our service desk.\n' +
            'It needs approval before our support team can take action, and you will be informed at each step.',
        },
        `the receipt for ${ticket.ticketNumber}`,
      );
      await this.bellHeldReceipt(clientId, ticket, viewer.id, needsCustomerApproval);
    }

    if (needsCustomerApproval) {
      await this.notifyCustomerApprovalRequested(clientId, ticket, template.name, actorId, needsProviderApproval);
    } else if (needsApproval) {
      await this.notifyApprovalRequested(clientId, ticket, template.name, actorId);
    }

    // Live now: a client's ticket is routed, then Created and the assignment go out.
    if (!needsApproval) {
      await this.goLive(clientId, ticket, actorId, {
        routes: isCustomerTicket,
        lead: 'Your support request has been successfully registered in our service desk.',
      });
    }

    return this.prisma.ticket.findUnique({ where: { id: ticket.id }, include: { technicians: { include: { user: { select: { id: true, username: true, name: true } } } }, template: true } });
  }

  /**
   * Auto-route a customer ticket (client request). Three steps, in order:
   * (1) the client's consultants for this product, (2) the client's default
   * consultants, (3) the Products screen's consultants — each read per module
   * or for the whole product, as the product's "Assign consultants" mode says.
   * Within a step only the ticket's issue type is offered (`routingIssueType`:
   * the one picked, else the organization's default), and the agent holding the
   * fewest open tickets takes it — the primary on a tie — so long as they are
   * active and below the organization's max (`agentPicker`). A step is left
   * only when everyone in it is full; when every step is, the ticket stays
   * unassigned for the project manager to assign.
   *
   * The whole block is gated on the client's own `autoAssignTickets` switch —
   * off means every ticket they raise is assigned by hand. Racy by design: two
   * tickets created in the same instant can both see the same agent's load.
   *
   * Runs at creation, or at approval for a ticket that was held. Notifies
   * nobody itself — `goLive` announces what it found.
   */
  private async autoRoute(
    clientId: string,
    ticket: {
      id: string; ticketNumber: string; subject: string;
      customerCompanyId: string | null; productId: string | null; moduleId: string | null; consultantType: string | null;
    },
    actorId: string,
  ): Promise<{ agent: Agent | null; unassigned: string | null }> {
    if (!(await this.customerProducts.autoAssignEnabled(clientId, ticket.customerCompanyId))) {
      // Manual routing for this client: the project manager assigns it.
      return { agent: null, unassigned: 'auto-assignment is off for this client' };
    }
    const [org, product] = await Promise.all([
      this.prisma.client.findUnique({ where: { id: clientId }, select: { defaultIssueType: true } }),
      ticket.productId
        ? this.prisma.product.findFirst({
            where: { id: ticket.productId, clientId },
            select: { consultantMode: true, tracks: true, modules: { where: { id: ticket.moduleId ?? '__none__' }, select: { id: true, tracks: true } } },
          })
        : null,
    ]);
    const byModule = product?.consultantMode === 'MODULES';
    const mod = byModule ? product?.modules[0] : undefined;
    const track = routingIssueType(
      ticket.consultantType,
      org?.defaultIssueType ?? 'TECHNICAL',
      offeredIssueTypes(mod ? mod.tracks : product?.tracks ?? []),
    );
    const pick = await this.agentPicker(clientId);
    // 1) & 2) The client's consultants for this product, then their defaults.
    let assignedConsultantId = await this.customerProducts.resolveCustomerConsultant(
      clientId, ticket.customerCompanyId, ticket.productId, byModule ? ticket.moduleId : null, track, pick,
    );
    // 3) The Products screen's consultants, in the product's own mode.
    if (!assignedConsultantId && ticket.productId && product) {
      assignedConsultantId = byModule
        ? mod ? await this.products.resolveConsultant(clientId, mod.id, track, pick) : null
        : await this.products.resolveProductConsultant(clientId, ticket.productId, track, pick);
    }
    if (!assignedConsultantId) {
      // Everyone at every step is full: it waits for the project manager.
      return { agent: null, unassigned: 'every consultant for it is busy' };
    }
    await this.prisma.ticketTechnician.create({ data: { ticketId: ticket.id, userId: assignedConsultantId } });
    const c = await this.prisma.user.findUnique({
      where: { id: assignedConsultantId },
      select: { id: true, username: true, name: true, email: true },
    });
    await this.activity.log({
      ticketId: ticket.id,
      actorUserId: actorId,
      type: 'ASSIGNED',
      // Full name, not username — a username is often an employee id (client request).
      summary: `Auto-assigned to ${c ? displayName(c) : 'consultant'}`,
      meta: { userId: assignedConsultantId, auto: true },
    });
    return { agent: c, unassigned: null };
  }

  /**
   * A ticket becomes live work — on creation, or on its last approval. A
   * client's ticket is routed first (`autoRoute`), then 1. Created goes out,
   * then 2. Assigned / 4. Accepted for the agent it was routed to — or, when
   * nobody could take it, the project manager's "needs an agent" alert, which
   * replaces their Created notice (one bell, not two; client request).
   */
  private async goLive(
    clientId: string,
    ticket: NotifyTicket & { moduleId: string | null; consultantType: string | null },
    actorId: string,
    opts: { routes: boolean; lead: string; ackBody?: string; skipRoles?: PersonRole[] },
  ) {
    const route = opts.routes ? await this.autoRoute(clientId, ticket, actorId) : null;
    const n = ticket.ticketNumber;
    const label = `${n} — ${ticket.subject}`;
    const forStaff: EventMail = {
      subject: `${n} - Created`,
      content: {
        intro: 'A new support ticket has been raised.',
        fields: ['number', 'subject', 'requestedBy', 'client', 'department', 'category', 'priority', 'assignedTeam', 'dueDate'],
        description: true,
        linkLabel: 'View Ticket',
      },
    };
    await this.fireEvent(clientId, 'TICKET_CREATED', {
      ticket,
      actorId,
      skipRoles: [...(opts.skipRoles ?? []), ...(route?.unassigned ? (['PROJECT_MANAGER'] as const) : [])],
      mail: {
        client: { subject: `${n} - Created`, content: MAIL.created(opts.lead) },
        agent: forStaff,
        staff: forStaff,
      },
      bell: {
        client: {
          type: 'TICKET_ACK', title: 'Ticket received',
          body: opts.ackBody ?? `We've received your ticket ${n} and will get back to you shortly.`,
        },
        PROJECT_MANAGER: { type: 'PM_TICKET_CREATED', title: 'New ticket on your project', body: label },
        staff: { type: 'TICKET_CREATED', title: 'New ticket created', body: `New ticket ${label}` },
        agent: { type: 'TICKET_CREATED', title: 'New ticket', body: label },
      },
    });
    if (route?.agent) await this.announceAssignment(clientId, ticket, actorId, [], [route.agent]);
    else if (route?.unassigned) await this.alertProjectManagerUnassigned(clientId, ticket, route.unassigned, [actorId]);
  }

  /** The raiser of a held ticket: "Sent for approval" (to their company admin) or "Ticket received". */
  private async bellHeldReceipt(clientId: string, ticket: EmailTicket, userId: string, toCompanyAdmin: boolean) {
    await this.notifications
      .notify(
        toCompanyAdmin
          ? {
              clientId, userId, type: 'TICKET_SENT_FOR_APPROVAL', ticketId: ticket.id,
              title: 'Sent for approval',
              body: `Your ticket ${ticket.ticketNumber} has been sent to your company admin for approval.`,
            }
          : {
              clientId, userId, type: 'TICKET_ACK', ticketId: ticket.id,
              title: 'Ticket received',
              body: `We've received your ticket ${ticket.ticketNumber} and will get back to you shortly.`,
            },
      )
      .catch((err) => this.logger.error('Failed to bell the raiser of a held ticket', err instanceof Error ? err.stack : String(err)));
  }

  /**
   * A change of agent: a first agent is 2. Ticket Assigned (+ 4. Ticket
   * Accepted for the client), anything else — a handover, or nobody — is
   * 3. Ticket Reassigned. Who hears of it is the Email Configuration; this
   * only says it, per audience. Shared by manual assignment and auto-routing.
   */
  private async announceAssignment(clientId: string, ticket: NotifyTicket, actorId: string, previous: Agent[], incoming: Agent[]) {
    const n = ticket.ticketNumber;
    const label = `${n} — ${ticket.subject}`;
    // Full names, not usernames — a username is often an employee id (client request).
    const to = incoming.map(displayName).join(', ');
    const from = previous.map(displayName).join(', ');
    const asPeople = (xs: Agent[]): NotifyPerson[] => xs.map((u) => ({ id: u.id, email: u.email, name: u.name, username: u.username }));
    const toAgent: EventBell = { type: 'TICKET_ASSIGNED', title: 'Ticket assigned to you', body: `You've been assigned ${label}` };

    if (!previous.length && incoming.length) {
      await this.fireEvent(clientId, 'TICKET_ASSIGNED', {
        ticket, actorId,
        people: { ASSIGNED_AGENT: asPeople(incoming), NEW_ASSIGNED_AGENT: asPeople(incoming) },
        mail: {
          agent: { subject: `${n} Assigned`, content: MAIL.assigned() },
          staff: {
            subject: `[Ticket Assigned] - ${n} assigned to ${to}`,
            content: {
              intro: `The following support ticket has been assigned to ${to}.`,
              fields: ['number', 'subject', 'requestedBy', 'client', 'priority', 'status', 'assignedAgent', 'assignedTeam', 'dueDate'],
            },
          },
          client: { subject: `[Ticket Accepted] - ${n}`, content: MAIL.accepted() },
        },
        bell: {
          agent: toAgent,
          PROJECT_MANAGER: { type: 'PM_TICKET_ASSIGNED', title: 'Ticket assigned', body: `${label} · to ${to}` },
          staff: { type: 'TICKET_ASSIGNED', title: 'Ticket assigned', body: `${label} has been assigned to ${to}.` },
          client: { type: 'TICKET_ASSIGNED', title: 'Ticket assigned', body: `${label} has been assigned to ${to}.` },
        },
      });
      await this.fireEvent(clientId, 'TICKET_ACCEPTED', {
        ticket, actorId,
        people: { ASSIGNED_AGENT: asPeople(incoming), NEW_ASSIGNED_AGENT: asPeople(incoming) },
        mail: { client: { subject: `[Ticket Accepted] - ${n}`, content: MAIL.accepted() } },
        bell: { client: { type: 'TICKET_ACCEPTED', title: 'Ticket accepted', body: `${label} has been assigned to ${to}.` } },
        detail: `assigned to ${to}`,
      });
      return;
    }

    const handover = previous.length > 0 && incoming.length > 0;
    const summary = incoming.length
      ? `${label} has moved from ${from} to ${to}.`
      : `${label} is no longer assigned to anyone.`;
    const toNew: EventMail = { subject: `[Ticket Reassigned] – ${n} assigned to you`, content: MAIL.reassigned(from, to) };
    await this.fireEvent(clientId, 'TICKET_REASSIGNED', {
      ticket, actorId,
      people: {
        NEW_ASSIGNED_AGENT: asPeople(incoming),
        ASSIGNED_AGENT: asPeople(incoming),
        PREVIOUS_AGENT: asPeople(previous.filter((p) => !incoming.some((x) => x.id === p.id))),
      },
      mail: {
        NEW_ASSIGNED_AGENT: toNew,
        ASSIGNED_AGENT: toNew,
        PREVIOUS_AGENT: {
          subject: `[Ticket Reassigned] - ${n}`,
          content: {
            intro: incoming.length
              ? `The following support ticket has been handed over from you to ${to}.`
              : 'The following support ticket is no longer assigned to you.',
            fields: ['number', 'subject', 'requestedBy', 'client', 'priority', 'status', 'assignedAgent'],
          },
        },
        client: {
          subject: `[Ticket Reassigned] - ${n}`,
          content: incoming.length
            ? {
                ...MAIL.accepted(),
                intro: `Your support ticket has been reassigned to ${to}, who will now take it forward.\n` +
                  'All previous updates and comments remain on the ticket.',
              }
            : {
                intro: 'Your support ticket is being reassigned within our support team.\nA new agent will be assigned to it shortly.',
                fields: ['number', 'subject', 'priority', 'status'],
                outro: 'Our team will keep you informed about further progress.',
                thanks: 'Thank you for your patience.',
              },
        },
        staff: {
          subject: incoming.length ? `[Ticket Reassigned] - ${n} assigned to ${to}` : `[Ticket Unassigned] - ${n}`,
          content: {
            intro: incoming.length
              ? `The following support ticket has been reassigned from ${from} to ${to}.`
              : `The following support ticket is no longer assigned to anyone${from ? ` (previously ${from})` : ''} and needs an agent.`,
            fields: [
              'number', 'subject', 'requestedBy', 'client', 'priority', 'status',
              ...(handover ? [['Previous Assigned Agent', from] as [string, string]] : []),
              'assignedAgent', 'assignedTeam', 'dueDate',
            ],
            outro: incoming.length ? undefined : 'Please assign an agent to the ticket through the ticketing portal.',
          },
        },
      },
      bell: {
        NEW_ASSIGNED_AGENT: toAgent,
        ASSIGNED_AGENT: toAgent,
        PREVIOUS_AGENT: {
          type: 'TICKET_UNASSIGNED', title: 'Ticket reassigned',
          body: incoming.length ? `${label} has been handed over to ${to}.` : `${label} is no longer assigned to you.`,
        },
        PROJECT_MANAGER: { type: 'PM_TICKET_ASSIGNED', title: 'Ticket assigned', body: `${label} · ${incoming.length ? `to ${to}` : 'now unassigned'}` },
        client: { type: 'TICKET_REASSIGNED', title: incoming.length ? 'Ticket reassigned' : 'Ticket unassigned', body: summary },
        staff: { type: 'TICKET_REASSIGNED', title: incoming.length ? 'Ticket reassigned' : 'Ticket unassigned', body: summary },
      },
    });
  }

  /**
   * Tell every tenant Admin — bell and email — that a held ticket is waiting for
   * their decision. `forwardedBy` names the customer admin who passed an
   * employee's request on, so the Admin knows the client has already said yes.
   */
  private async notifyApprovalRequested(
    clientId: string,
    ticket: { id: string; ticketNumber: string; subject: string; customerCompanyId: string | null },
    templateName: string,
    raiserId: string | null,
    forwardedBy?: string | null,
  ) {
    try {
      const [raiser, company, admins] = await Promise.all([
        raiserId
          ? this.prisma.user.findUnique({ where: { id: raiserId }, select: { username: true, name: true, customerCompanyId: true } })
          : null,
        ticket.customerCompanyId
          ? this.prisma.customerCompany.findUnique({ where: { id: ticket.customerCompanyId }, select: { name: true } })
          : null,
        this.tenantAdmins(clientId),
      ]);
      // A customer reads as "bob (Globex Ltd) raised…"; an agent's company goes
      // after the subject, since it's the client the work is for, not theirs.
      const raiserName = raiser ? displayName(raiser) : 'Someone';
      const who = raiser?.customerCompanyId && company ? `${raiserName} (${company.name})` : raiserName;
      const forWhom = !raiser?.customerCompanyId && company ? ` (${company.name})` : '';
      const forwarded = forwardedBy ? ` Approved by their company admin, ${forwardedBy}.` : '';
      await this.notifications.notifyMany(admins.map((a) => a.id), {
        clientId, type: 'TICKET_APPROVAL_REQUESTED', ticketId: ticket.id,
        title: `${templateName} awaiting your approval`,
        body: `${who} raised ${ticket.ticketNumber} · ${ticket.subject}${forWhom}.${forwarded}`,
      });
      await this.mailEach(
        clientId,
        ticket,
        admins,
        `[Approval Required] - ${ticket.ticketNumber}`,
        {
          intro: `${who} has raised the following ${templateName}${forWhom}, which requires your approval.${forwarded}\n` +
            'No agent can be assigned and no work can begin on it until it is approved.',
          fields: ['number', 'subject', 'requestedBy', 'client', 'category', 'priority', 'status', 'createdDate'],
          description: true,
          outro: 'Please review the request under Awaiting approval on the ticket list and approve or reject it. The requester will be informed of your decision.',
          linkLabel: 'Review Request',
        },
        `the approval request for ${ticket.ticketNumber}`,
      );
    } catch (err) {
      this.logger.error('Failed to notify admins of a ticket awaiting approval', err instanceof Error ? err.stack : String(err));
    }
  }

  /**
   * An employee's request waits for their own company admin first — a bell for
   * each `CustomerAdmin` of that company. The email goes only for a template
   * that needs the provider's approval too (Change Request), as it always has;
   * the approval every other employee ticket now takes is bell-only (client
   * request). The provider hears nothing yet.
   */
  private async notifyCustomerApprovalRequested(
    clientId: string,
    ticket: { id: string; ticketNumber: string; subject: string; customerCompanyId: string | null },
    templateName: string,
    raiserId: string,
    withEmail: boolean,
  ) {
    try {
      if (!ticket.customerCompanyId) return;
      const [raiser, companyAdmins] = await Promise.all([
        this.prisma.user.findUnique({ where: { id: raiserId }, select: { username: true, name: true } }),
        this.prisma.user.findMany({
          where: {
            clientId, customerCompanyId: ticket.customerCompanyId, isActive: true,
            userRoles: { some: { role: { name: 'CustomerAdmin' } } },
          },
          select: { id: true, username: true, name: true, email: true },
        }),
      ]);
      const who = raiser ? displayName(raiser) : 'A team member';
      await this.notifications.notifyMany(companyAdmins.map((a) => a.id), {
        clientId, type: 'TICKET_APPROVAL_REQUESTED', ticketId: ticket.id,
        title: `${templateName} awaiting your approval`,
        body: `${who} raised ${ticket.ticketNumber} · ${ticket.subject}`,
      });
      if (withEmail) {
        await this.mailEach(
          clientId,
          ticket,
          companyAdmins,
          `[Approval Required] - ${ticket.ticketNumber}`,
          {
            intro: `${who} has raised the following ${templateName}, which requires your approval.\n` +
              'It will be sent to your service provider only once you approve it.',
            fields: ['number', 'subject', 'requestedBy', 'department', 'category', 'priority', 'status', 'createdDate'],
            description: true,
            outro: `Please review the request under Awaiting approval on your ticket list and approve or reject it. ${who} will be informed of your decision.`,
            linkLabel: 'Review Request',
          },
          `the customer approval request for ${ticket.ticketNumber}`,
        );
      }
    } catch (err) {
      this.logger.error('Failed to notify the company admins of a ticket awaiting their approval', err instanceof Error ? err.stack : String(err));
    }
  }

  /**
   * Every ticket email goes through here (client request — no screen waits on
   * mail). The send is queued and this returns at once, so Save / Resolve /
   * Reopen etc. answer immediately and the emails follow seconds later. One
   * queue per service: emails go out one at a time, in the order the actions
   * happened, which also keeps a rate-limited provider happy. A failed send is
   * logged, exactly as before — it never reached the user then either. What is
   * lost: emails still waiting if the backend restarts in those seconds.
   * Recipients, wording and the separate client/provider sends are unchanged.
   */
  private mailQueue: Promise<void> = Promise.resolve();
  /**
   * The CC line of a ticket email, once per email event: a caller that mails
   * one event to several people one-by-one passes these for the first send
   * only. `helpdesk` (default on) CCs the organization's helpdesk email
   * (`Client.helpdeskEmail`); `critical` CCs the critical ticket admin
   * (`Client.criticalTicketEmail`, when `criticalTicketAlerts` is on) on an
   * email about a Critical ticket — a copy of the ticket email, never a
   * separate alert (team lead's request).
   */
  private queueMail(
    message: Parameters<MailerService['sendMail']>[0],
    clientId: string,
    opts: { helpdesk?: boolean; critical?: boolean } = {},
  ): Promise<void> {
    this.mailQueue = this.mailQueue
      .then(async () => {
        const cc = await this.ccFor(clientId, message.to, !!opts.helpdesk, !!opts.critical);
        return this.mailer.sendMail(cc ? { ...message, cc } : message, clientId);
      })
      .then(
        () => undefined,
        (err) => this.logger.error(`Failed to send "${message.subject}"`, err instanceof Error ? err.stack : String(err)),
      );
    return Promise.resolve();
  }
  /** The addresses to CC, minus any already a `To:` of this send; null when none. */
  private async ccFor(clientId: string, to: string, helpdesk: boolean, critical: boolean): Promise<string | null> {
    if (!helpdesk && !critical) return null;
    try {
      const org = await this.prisma.client.findUnique({
        where: { id: clientId },
        select: { helpdeskEmail: true, criticalTicketAlerts: true, criticalTicketEmail: true },
      });
      const already = new Set(to.split(',').map((a) => a.trim().toLowerCase()));
      const cc = [
        helpdesk ? org?.helpdeskEmail : null,
        critical && org?.criticalTicketAlerts ? org.criticalTicketEmail : null,
      ]
        .map((a) => a?.trim().toLowerCase())
        .filter((a): a is string => !!a && EMAIL_RE.test(a) && !already.has(a));
      return [...new Set(cc)].join(', ') || null;
    } catch {
      return null; // a CC lookup must never cost the email itself
    }
  }

  /** Resolves once every queued email has been handed to the mail server (tests). */
  flushMail() {
    return this.mailQueue;
  }

  /** Whether a customer company has an active admin to approve its employees' tickets. */
  private async hasCustomerAdmin(clientId: string, customerCompanyId: string | null | undefined) {
    if (!customerCompanyId) return false;
    const n = await this.prisma.user.count({
      where: { clientId, customerCompanyId, isActive: true, userRoles: { some: { role: { name: 'CustomerAdmin' } } } },
    });
    return n > 0;
  }

  /** Active tenant Admins, with what an email needs. */
  private tenantAdmins(clientId: string) {
    return this.prisma.user.findMany({
      where: { clientId, isActive: true, customerCompanyId: null, userRoles: { some: { role: { name: 'Admin' } } } },
      select: { id: true, username: true, name: true, email: true },
    });
  }

  /**
   * One email per address, each sent and caught on its own — a client's address
   * never shares a `To:` with anyone else's, and one bad address can't cost the
   * others theirs. Duplicates and unusable addresses are dropped. Never throws.
   */
  private async mailEach(
    clientId: string,
    ticket: EmailTicket,
    recipients: { email: string | null; username?: string | null; name?: string | null }[],
    subject: string,
    content: TicketEmailContent,
    context: string,
  ) {
    try {
      const seen = new Set<string>();
      const list = recipients.filter((r) => {
        const e = r.email?.trim().toLowerCase();
        if (!e || !EMAIL_RE.test(e) || seen.has(e)) return false;
        seen.add(e);
        return true;
      });
      if (!list.length) return;
      if (!(await this.mailer.isConfigured(clientId))) {
        this.logger.warn(`SMTP not configured — ${context} not emailed`);
        return;
      }
      // One lookup per email event: every recipient reads the same facts.
      const facts = await this.ticketEmailFacts(clientId, ticket);
      for (const [i, r] of list.entries()) {
        const { html, text } = renderTicketEmail(facts, content, displayName(r) || null);
        await this
          .queueMail({ to: r.email!.trim(), subject, html, text }, clientId, { critical: i === 0 && !!facts.isCritical })
          .catch((err) => this.logger.error(`Failed to email ${context}`, err instanceof Error ? err.stack : String(err)));
      }
    } catch (err) {
      this.logger.error(`Failed to email ${context}`, err instanceof Error ? err.stack : String(err));
    }
  }

  /**
   * One of the twelve ticket events (Email Configuration). Who hears of it, and
   * whether by email, bell or both, is the tenant's `NotificationRule` rows for
   * that event — nothing here names a recipient. The call site supplies the
   * wording per role or audience (`client` / `agent` / `staff`); a recipient an
   * admin added for whom no wording was written gets a plain notice instead.
   * Bells first, then one email per address, client sends first; the helpdesk
   * address (when a row names it) is CC'd on the first, or emailed on its own
   * when nobody else is. Returns the users reached. Never throws.
   */
  private async fireEvent(clientId: string, event: NotificationEvent, ctx: EventContext): Promise<Set<string>> {
    const reached = new Set<string>();
    const t = ctx.ticket;
    try {
      const rows = await this.notificationRules.forEvent(clientId, event);
      if (!rows.length) return reached;
      const people: Partial<Record<PersonRole, NotifyPerson[]>> = {};
      for (const role of rolesNamed(rows)) {
        if (ctx.skipRoles?.includes(role)) continue;
        people[role] = ctx.people?.[role] ?? (await this.peopleFor(clientId, role, event, t));
      }
      const skip = new Set((ctx.skipUserIds ?? []).filter((x): x is string => !!x));
      if (ctx.actorId) {
        const staff = await this.prisma.user.findFirst({ where: { id: ctx.actorId, customerCompanyId: null }, select: { id: true } });
        if (staff) skip.add(ctx.actorId);
      }
      const { deliveries, helpdesk } = planDelivery(rows, people, (p) => !!p.id && skip.has(p.id));
      const pick = <T>(map: Partial<Record<PersonRole | Audience, T>> | undefined, d: Delivery) => map?.[d.role] ?? map?.[d.audience];

      for (const d of deliveries) {
        if (!d.bell || !d.person.id) continue;
        const b = pick(ctx.bell, d) ?? fallbackBell(event, `${t.ticketNumber} — ${t.subject}`, ctx.detail);
        try {
          await this.notifications.notify({ clientId, userId: d.person.id, ticketId: t.id, ...b });
          reached.add(d.person.id);
        } catch (err) {
          this.logger.error(`Failed to bell ${event} for ${t.ticketNumber}`, err instanceof Error ? err.stack : String(err));
        }
      }
      if (ctx.emailOff) return reached;

      const mails = deliveries.filter((d) => d.email && !!d.person.email && EMAIL_RE.test(d.person.email.trim()));
      const helpdeskTo = helpdesk ? await this.helpdeskAddress(clientId) : null;
      if (!mails.length && !helpdeskTo) return reached;
      if (!(await this.mailer.isConfigured(clientId))) {
        this.logger.warn(`SMTP not configured — ${event} for ${t.ticketNumber} not emailed`);
        return reached;
      }
      // One lookup per event: every recipient reads the ticket as it now stands.
      const facts = await this.ticketEmailFacts(clientId, t);
      const seen = new Set<string>();
      let first = true;
      for (const d of mails) {
        const to = d.person.email!.trim();
        if (seen.has(to.toLowerCase())) continue;
        seen.add(to.toLowerCase());
        const m = pick(ctx.mail, d) ?? fallbackMail(event, d.audience, t.ticketNumber);
        const { html, text } = renderTicketEmail(facts, m.content, displayName(d.person) || null);
        await this.queueMail(
          { to, subject: m.subject, html, text }, clientId,
          { helpdesk: first && !!helpdeskTo, critical: first && !!facts.isCritical },
        );
        first = false;
        if (d.person.id) reached.add(d.person.id);
      }
      if (first && helpdeskTo) {
        const m = ctx.mail?.client ?? ctx.mail?.staff ?? ctx.mail?.agent ?? fallbackMail(event, 'staff', t.ticketNumber);
        const { html, text } = renderTicketEmail(facts, m.content, null);
        await this.queueMail({ to: helpdeskTo, subject: m.subject, html, text }, clientId, { critical: !!facts.isCritical });
      }
    } catch (err) {
      this.logger.error(`Failed to send ${event} for ${t.ticketNumber}`, err instanceof Error ? err.stack : String(err));
    }
    return reached;
  }

  /** The people one recipient role names on this ticket. */
  private async peopleFor(clientId: string, role: PersonRole, event: NotificationEvent, t: NotifyTicket): Promise<NotifyPerson[]> {
    const pick = { id: true, username: true, name: true, email: true } as const;
    switch (role) {
      case 'REQUESTOR': {
        const u = t.requestorUserId
          ? await this.prisma.user.findUnique({ where: { id: t.requestorUserId }, select: { ...pick, isActive: true } })
          : null;
        if (u?.isActive) return [{ id: u.id, email: u.email || t.requestorEmail, name: u.name ?? t.requestorName, username: u.username }];
        const email = t.requestorEmail || u?.email || null;
        return email ? [{ id: null, email, name: t.requestorName }] : [];
      }
      case 'CLIENT_ADMIN':
        return t.customerCompanyId
          ? this.prisma.user.findMany({
              where: { clientId, customerCompanyId: t.customerCompanyId, isActive: true, userRoles: { some: { role: { name: 'CustomerAdmin' } } } },
              select: pick,
            })
          : [];
      case 'ASSIGNED_AGENT':
      case 'NEW_ASSIGNED_AGENT': {
        const holders = await this.prisma.ticketTechnician.findMany({ where: { ticketId: t.id }, select: { userId: true } });
        const ids = new Set(holders.map((h) => h.userId));
        // Once it has been resolved, whoever resolved it worked it too.
        if ((event === 'TICKET_REOPENED' || event === 'TICKET_CLOSED') && t.resolvedById) ids.add(t.resolvedById);
        return ids.size
          ? this.prisma.user.findMany({ where: { id: { in: [...ids] }, isActive: true, customerCompanyId: null }, select: pick })
          : [];
      }
      case 'PREVIOUS_AGENT':
        return []; // only a reassignment knows, and it passes them in
      case 'PROJECT_MANAGER': {
        // The client product's own project manager — never the Admins in their place.
        const pmId = await this.reopenApproverFor(clientId, t);
        const pm = pmId ? await this.prisma.user.findUnique({ where: { id: pmId }, select: pick }) : null;
        return pm ? [pm] : [];
      }
      case 'TENANT_ADMINS':
        return this.tenantAdmins(clientId);
    }
  }

  /** The Organization screen's helpdesk address, when it is a usable one. */
  private async helpdeskAddress(clientId: string): Promise<string | null> {
    const org = await this.prisma.client.findUnique({ where: { id: clientId }, select: { helpdeskEmail: true } });
    const a = org?.helpdeskEmail?.trim().toLowerCase();
    return a && EMAIL_RE.test(a) ? a : null;
  }

  /**
   * The facts the client email format shows for a ticket (`ticket-email.ts`):
   * picklist *labels* rather than raw values, the tenant's date format, the
   * agent by full name. Read when the email is written, so it shows the ticket
   * as it stands after the event. Never throws — a failed lookup still sends
   * the email, with just the number and subject.
   */
  private async ticketEmailFacts(clientId: string, t: EmailTicket): Promise<TicketEmailFacts> {
    const base: TicketEmailFacts = {
      ticketId: t.id, ticketNumber: t.ticketNumber, subject: t.subject,
      portalUrl: process.env.FRONTEND_URL ?? null,
    };
    try {
      const [row, org] = await Promise.all([
        this.prisma.ticket.findUnique({
          where: { id: t.id },
          select: {
            ticketNumber: true, subject: true, description: true, priority: true, ticketStatus: true,
            ticketCategory: true, subCategory: true, department: true, requestorName: true, customerName: true,
            createdAt: true, productId: true, moduleId: true, consultantType: true,
            dueDate: true, resolvedAt: true, closedDate: true, resolution: true,
            customerCompany: { select: { name: true } },
            technicians: { select: { user: { select: { username: true, name: true } } } },
          },
        }),
        this.prisma.client.findUnique({ where: { id: clientId }, select: { name: true, dateFormat: true, timeFormat: true, timeZone: true } }),
      ]);
      base.orgName = org?.name ?? null;
      if (!row) return base;
      const keys = ['priority', 'ticketStatus', 'ticketCategory', 'subCategory', 'department'];
      const [options, product, module] = await Promise.all([
        this.prisma.picklistOption.findMany({ where: { clientId, listKey: { in: keys } }, select: { listKey: true, value: true, label: true } }),
        row.productId ? this.prisma.product.findUnique({ where: { id: row.productId }, select: { name: true } }) : null,
        row.moduleId ? this.prisma.productModule.findUnique({ where: { id: row.moduleId }, select: { name: true } }) : null,
      ]);
      const label = (listKey: string, value: string | null | undefined) =>
        value ? (options.find((o) => o.listKey === listKey && o.value === value)?.label ?? value) : null;
      const agents = row.technicians.map((x) => displayName(x.user)).filter(Boolean).join(', ');
      const track = issueTypeLabel(row.consultantType);
      const priority = label('priority', row.priority);
      const date = (d: Date | null | undefined) => formatTenantStamp(d, org);
      return {
        ...base,
        ticketNumber: row.ticketNumber,
        subject: row.subject,
        description: row.description,
        resolution: row.resolution,
        priority,
        isCritical: [row.priority, priority].some((v) => v?.trim().toLowerCase() === 'critical'),
        status: label('ticketStatus', row.ticketStatus),
        category: label('ticketCategory', row.ticketCategory),
        subCategory: label('subCategory', row.subCategory),
        department: label('department', row.department),
        client: row.customerCompany?.name ?? row.customerName ?? (org?.name ? `Internal Ticket / ${org.name}` : null),
        product: [product?.name, module?.name].filter(Boolean).join(' · ') || null,
        // The consultant group it is routed through — this platform's "support team".
        assignedTeam: [product?.name, module?.name, track].filter(Boolean).join(' · ') || null,
        createdDate: date(row.createdAt),
        dueDate: date(row.dueDate),
        resolvedDate: date(row.resolvedAt),
        closedDate: date(row.closedDate),
        requestedBy: row.requestorName,
        assignedAgent: agents || null,
      };
    } catch (err) {
      this.logger.warn(`Could not load the email details of ${t.ticketNumber}: ${err instanceof Error ? err.message : String(err)}`);
      return base;
    }
  }

  /**
   * What this viewer is allowed to see of the tenant's tickets. Its own method
   * because the export answers from the same rule — a customer downloading a
   * spreadsheet must get exactly the rows their list shows, and a second copy of
   * this clause would be the place that silently stops agreeing with it.
   */
  private async visibleTicketWhere(clientId: string, viewer: TicketViewer): Promise<Prisma.TicketWhereInput> {
    // A project manager also sees every ticket on the client products they
    // manage — they are notified of them (the PROJECT_MANAGER recipient of the Email Configuration).
    const managed = !isCustomerSide(viewer) && !isAdmin(viewer) ? await this.managedProducts(clientId, viewer.id) : [];
    return {
      clientId,
      ...(isCustomerAdmin(viewer)
        ? // A customer company admin sees all of their company's tickets.
          { customerCompanyId: viewer.customerCompanyId ?? '__none__' }
        : isCustomerEmployee(viewer)
        ? // An employee sees only the tickets they raised.
          { customerCompanyId: viewer.customerCompanyId ?? '__none__', requestorUserId: viewer.id }
        : isAdmin(viewer)
        ? // Admin sees everything except tickets still inside the customer's
          // own approval stage (not yet forwarded to us).
          { approvalStatus: { not: 'PENDING_CUSTOMER' } }
        : {
            OR: [
              {
                // Agents never see someone else's ticket still awaiting approval.
                approvalStatus: { in: ['NONE', 'APPROVED'] },
                OR: [
                  { technicians: { some: { userId: viewer.id } } },
                  { approvals: { some: { approverUserId: viewer.id } } },
                  // Tickets on which the viewer has an assigned task (possibly created by another agent).
                  { tasks: { some: { assigneeUserId: viewer.id } } },
                ],
              },
              // …but always their own request on an approval template, pending,
              // approved or rejected — it's how they follow the decision.
              { createdBy: viewer.id, approvalStatus: { not: 'NONE' } },
              // …and any ticket whose reopen request was put to them as the
              // client product's project manager — they have to read it to decide.
              { reopenApproverUserId: viewer.id },
              ...(managed.length
                ? [{ approvalStatus: { in: ['NONE', 'APPROVED'] }, OR: managed.map((m) => ({ customerCompanyId: m.customerCompanyId, productId: m.productId })) }]
                : []),
            ],
          }),
    };
  }

  async findAll(clientId: string, viewer: TicketViewer) {
    const tickets = await this.prisma.ticket.findMany({
      // Non-admins see tickets assigned to them, plus any they've been asked to approve.
      where: await this.visibleTicketWhere(clientId, viewer),
      orderBy: { createdAt: 'desc' },
      include: {
        template: { select: { id: true, name: true, category: true } },
        technicians: {
          include: { user: { select: { id: true, username: true, name: true } } },
        },
        customerCompany: { select: { id: true, name: true } },
      },
    });
    // `managedByMe`: the viewer is the project manager of this ticket's client
    // product — the list then offers them its assign menu, as it does an Admin.
    const managed = !isCustomerSide(viewer) && !isAdmin(viewer) ? await this.managedProducts(clientId, viewer.id) : [];
    const keys = new Set(managed.map((m) => `${m.customerCompanyId}|${m.productId}`));
    return tickets.map((t) => ({
      ...t,
      managedByMe: !!t.customerCompanyId && !!t.productId && keys.has(`${t.customerCompanyId}|${t.productId}`),
    }));
  }

  /**
   * The viewer's tickets as a spreadsheet.
   *
   * `ids` is what the list screen is currently showing — the month, view, filters
   * and sort it has already applied client-side — so the download is the table
   * the user is looking at rather than everything they could see. It is a filter,
   * never a widening: the rows are still fetched through `visibleTicketWhere`,
   * so an id the viewer may not see simply doesn't come back. Omitted, the export
   * is everything visible to them.
   *
   * Export only: there is no ticket import. A ticket is built from a Template,
   * passes the approval gate and is routed to a consultant on creation, and a
   * spreadsheet row cannot stand in for any of that.
   */
  async exportSheet(clientId: string, viewer: TicketViewer, ids?: string[]) {
    const where = await this.visibleTicketWhere(clientId, viewer);
    const tickets = await this.prisma.ticket.findMany({
      where: ids?.length ? { AND: [where, { id: { in: ids } }] } : where,
      orderBy: { createdAt: 'desc' },
      include: {
        template: { select: { name: true } },
        technicians: { include: { user: { select: { username: true, name: true } } } },
        customerCompany: { select: { name: true } },
      },
    });

    const ticketIds = tickets.map((t) => t.id);
    const productIds = [...new Set(tickets.map((t) => t.productId).filter((x): x is string => !!x))];
    const moduleIds = [...new Set(tickets.map((t) => t.moduleId).filter((x): x is string => !!x))];

    // Ticket carries no relation to Product/ProductModule (findOne looks them up
    // the same way), and the labels are the tenant's own picklist rows — so five
    // batched reads, never one per row.
    const [products, modules, statusOpts, priorityOpts, booked, openTasks] = await Promise.all([
      productIds.length
        ? this.prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, name: true } })
        : [],
      moduleIds.length
        ? this.prisma.productModule.findMany({ where: { id: { in: moduleIds } }, select: { id: true, name: true } })
        : [],
      this.prisma.picklistOption.findMany({
        where: { clientId, listKey: 'ticketStatus' },
        select: { value: true, label: true },
      }),
      this.prisma.picklistOption.findMany({
        where: { clientId, listKey: 'priority' },
        select: { value: true, label: true },
      }),
      // The booked worklog total — the one figure every ticket screen quotes.
      ticketIds.length
        ? this.prisma.ticketWorklog.groupBy({
            by: ['ticketId'],
            where: { ticketId: { in: ticketIds } },
            _sum: { hours: true },
          })
        : [],
      ticketIds.length
        ? this.prisma.ticketTask.groupBy({
            by: ['ticketId'],
            where: { ticketId: { in: ticketIds }, status: { notIn: SETTLED_TASK_STATUSES } },
            _count: { _all: true },
          })
        : [],
    ]);

    const providerName = (await this.prisma.client.findUnique({ where: { id: clientId }, select: { name: true } }))?.name ?? null;
    const nameById = (rows: { id: string; name: string }[]) => new Map(rows.map((r) => [r.id, r.name]));
    const labelOf = (rows: { value: string; label: string | null }[]) =>
      new Map(rows.map((r) => [r.value, (r.label ?? r.value).trim()]));

    const productNames = nameById(products);
    const moduleNames = nameById(modules);
    const statusLabels = labelOf(statusOpts);
    const priorityLabels = labelOf(priorityOpts);
    const hoursByTicket = new Map(booked.map((b) => [b.ticketId, Number(b._sum.hours ?? 0)]));
    const openByTicket = new Map(openTasks.map((t) => [t.ticketId, t._count._all]));

    const rows: TicketSheetRow[] = tickets.map((t) => ({
      ticketNumber: t.ticketNumber,
      subject: t.subject,
      description: t.description,
      // A status or priority whose picklist row was renamed or retired still
      // reads as whatever the ticket stored, rather than coming back blank.
      status: statusLabels.get(t.ticketStatus) ?? t.ticketStatus,
      priority: t.priority ? priorityLabels.get(t.priority) ?? t.priority : '',
      templateName: t.template?.name ?? '',
      ticketCategory: t.ticketCategory,
      subCategory: t.subCategory,
      requestorName: t.requestorName,
      requestorEmail: t.requestorEmail,
      requestorContact: t.requestorContact,
      department: t.department,
      // An internal ticket reads "Internal Ticket / <provider>", as on every screen.
      customerCompanyName: t.customerCompany?.name ?? t.customerName ?? (providerName ? `Internal Ticket / ${providerName}` : 'Internal Ticket'),
      productName: t.productId ? productNames.get(t.productId) ?? '' : '',
      moduleName: t.moduleId ? moduleNames.get(t.moduleId) ?? '' : '',
      consultantType: issueTypeLabel(t.consultantType),
      // A ticket holds at most one agent; joined anyway so a legacy row that
      // still carries two is reported rather than half-shown.
      assignedTo: t.technicians.map((x) => displayName(x.user)).join('; ') || 'Unassigned',
      approvalStatus: t.approvalStatus,
      hoursSpent: hoursByTicket.get(t.id) ?? 0,
      openTaskCount: openByTicket.get(t.id) ?? 0,
      reopenedCount: t.reopenedCount,
      slaHours: t.slaHours,
      createdAt: t.createdAt,
      dueDate: t.dueDate,
      firstResponseAt: t.firstResponseAt,
      resolvedAt: t.resolvedAt,
      acknowledgedAt: t.acknowledgedAt,
      closedDate: t.closedDate,
      resolution: t.resolution,
    }));

    return buildSheet('Tickets', TICKET_COLUMNS, rows, await tenantDateFormat(this.prisma, clientId));
  }

  async findOne(id: string, clientId: string, viewer?: TicketViewer) {
    const ticket = await this.prisma.ticket.findFirst({
      where: { id, clientId },
      include: {
        template: { include: { fields: { orderBy: { sortOrder: 'asc' } } } },
        technicians: {
          include: { user: { select: { id: true, username: true, name: true } } },
        },
        attachments: true,
        customerCompany: { select: { id: true, name: true } },
        project: { select: { id: true, name: true, projectNumber: true } },
      },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');
    // Enrich with SAP product/module names for display (scalar IDs → names).
    // The people on a reopen request, by name, for the banners — one batched read.
    const reopenPeopleIds = [ticket.reopenRequestedById, ticket.reopenApproverUserId, ticket.reopenDecidedById]
      .filter((x): x is string => !!x);
    const [product, module, reopenedBy, reopenWindow, autoClose, worklogTotal, openTasks, raisedBy, rejectedBy, reopenPeople] = await Promise.all([
      ticket.productId ? this.prisma.product.findUnique({ where: { id: ticket.productId }, select: { name: true, code: true } }) : null,
      ticket.moduleId ? this.prisma.productModule.findUnique({ where: { id: ticket.moduleId }, select: { name: true } }) : null,
      // Who sent it back — staff see the name on the reopen notice; the client
      // gets neutral wording, since they already know it was them.
      ticket.reopenedById
        ? this.prisma.user.findUnique({ where: { id: ticket.reopenedById }, select: { username: true, name: true } })
        : null,
      this.reopenWindow(clientId, ticket.resolvedAt, ticket.reopenedCount),
      this.autoCloseWindow(clientId, ticket),
      // Total time on the ticket, and what still blocks resolving it. Both are on
      // the ticket itself rather than left to the worklog/task endpoints so a
      // customer — who may not call either — still sees the hours their contract
      // is being charged, on an open ticket and a closed one alike.
      this.prisma.ticketWorklog.aggregate({ where: { ticketId: id }, _sum: { hours: true } }),
      this.prisma.ticketTask.count({
        where: { ticketId: id, status: { notIn: SETTLED_TASK_STATUSES } },
      }),
      // Who asked and who refused, for the approval bars — only a ticket that
      // went through approval needs either.
      ticket.approvalStatus !== 'NONE' && ticket.createdBy
        ? this.prisma.user.findUnique({ where: { id: ticket.createdBy }, select: { username: true, name: true, customerCompanyId: true } })
        : null,
      ticket.rejectedById
        ? this.prisma.user.findUnique({ where: { id: ticket.rejectedById }, select: { username: true, name: true } })
        : null,
      reopenPeopleIds.length
        ? this.prisma.user.findMany({ where: { id: { in: reopenPeopleIds } }, select: { id: true, username: true, name: true } })
        : Promise.resolve([] as { id: string; username: string; name: string | null }[]),
    ]);
    const personName = (uid: string | null) => {
      const u = uid ? reopenPeople.find((p) => p.id === uid) : null;
      return u ? displayName(u) : null;
    };
    Object.assign(ticket, {
      productName: product?.name ?? null,
      productCode: product?.code ?? null,
      moduleName: module?.name ?? null,
      reopenedByName: reopenedBy ? displayName(reopenedBy) : null,
      // Reopen window — the screen shows the deadline, hides the button past it
      // and points the user at a new ticket instead. Same helper `reopen()` uses.
      // Whether *this* viewer may reopen is a separate rule the screen applies:
      // only the client's own people can, never provider staff.
      reopenWindowDays: reopenWindow.windowDays,
      reopenDeadline: reopenWindow.reopenDeadline,
      reopenWindowOpen: reopenWindow.windowOpen,
      // The tenant's cap on reopens and whether this ticket has used it up — the
      // screen swaps the button for "Create new ticket" the same way.
      maxReopens: reopenWindow.maxReopens,
      reopenLimitReached: reopenWindow.limitReached,
      // When this resolution closes itself if nobody acknowledges it. Null on
      // anything that isn't a client ticket waiting for sign-off, so the banner
      // can render the line off its presence alone.
      autoCloseDays: autoClose.days,
      autoCloseAt: autoClose.at,
      // Σ worklog hours — the same figure the Tasks tab's time list totals and the customer's
      // support-hours pool is charged, so every surface quotes one number.
      totalHoursSpent: Number(worklogTotal._sum.hours ?? 0),
      openTaskCount: openTasks,
      raisedByName: raisedBy ? displayName(raisedBy) : null,
      raisedByCustomer: !!raisedBy?.customerCompanyId,
      rejectedByName: rejectedBy ? displayName(rejectedBy) : null,
      reopenRequestedByName: personName(ticket.reopenRequestedById),
      // Null with a request pending = no project manager was set, so the Admins decide.
      reopenApproverName: personName(ticket.reopenApproverUserId),
      reopenDecidedByName: personName(ticket.reopenDecidedById),
      // Whether *this* viewer may decide the pending request — the screen shows
      // the approval card off it. Same rule `assertMayDecideReopen` enforces.
      canDecideReopen:
        ticket.reopenRequestStatus === 'PENDING' && !!viewer &&
        (isAdmin(viewer) || ticket.reopenApproverUserId === viewer.id),
    });
    // Customer side: must be the same company; an employee is further limited to
    // the tickets they raised, while the company admin sees all of them.
    if (viewer && isCustomerSide(viewer)) {
      const sameCompany =
        !!viewer.customerCompanyId && ticket.customerCompanyId === viewer.customerCompanyId;
      if (!sameCompany) throw new NotFoundException('Ticket not found');
      if (isCustomerEmployee(viewer) && ticket.requestorUserId !== viewer.id) {
        throw new NotFoundException('Ticket not found');
      }
      return ticket;
    }
    // A non-admin can access a ticket they're assigned to, a named approver on,
    // one where they have an assigned task (possibly created by another agent),
    // or their own request on an approval template (see `visibleTicketWhere`).
    const ownRequest = !!viewer && ticket.createdBy === viewer.id && ticket.approvalStatus !== 'NONE';
    const reopenApprover = !!viewer && ticket.reopenApproverUserId === viewer.id;
    if (viewer && !isAdmin(viewer) && !ownRequest && !reopenApprover && !ticket.technicians.some((t) => t.user.id === viewer.id)) {
      const [isApprover, isTaskAssignee, isProjectManager] = await Promise.all([
        this.prisma.ticketApproval.findFirst({
          where: { ticketId: id, approverUserId: viewer.id },
          select: { id: true },
        }),
        this.prisma.ticketTask.findFirst({
          where: { ticketId: id, assigneeUserId: viewer.id },
          select: { id: true },
        }),
        // The client product's project manager (same rule as `visibleTicketWhere`).
        ticket.customerCompanyId && ticket.productId && ['NONE', 'APPROVED'].includes(ticket.approvalStatus)
          ? this.prisma.customerCompanyProduct.findFirst({
              where: { customerCompanyId: ticket.customerCompanyId, productId: ticket.productId, productManagerId: viewer.id },
              select: { id: true },
            })
          : null,
      ]);
      if (!isApprover && !isTaskAssignee && !isProjectManager) throw new NotFoundException('Ticket not found');
    }
    return ticket;
  }

  /**
   * Nobody works on a ticket still waiting for approval, or one refused it —
   * the person who raised it can follow it, but it is not yet (or never) real
   * work. Approving is what opens it; comments stay open throughout.
   */
  assertNotHeld(ticket: { approvalStatus: string }) {
    if (ticket.approvalStatus === 'PENDING' || ticket.approvalStatus === 'PENDING_CUSTOMER') {
      throw new BadRequestException('This ticket is awaiting approval and cannot be worked on yet');
    }
    if (ticket.approvalStatus === 'REJECTED') {
      throw new BadRequestException('This ticket request was rejected and cannot be worked on');
    }
  }

  /**
   * No new work on a settled ticket: once its status reads Resolved or Closed,
   * tasks can't be added until it is reopened. Read off the live status (like
   * the SLA card), not the `resolvedAt` stamp — a reopen moves the status back
   * to the first open one, which is what unlocks it.
   */
  async assertTicketOpen(ticket: { ticketStatus: string }, clientId: string, action = 'adding tasks') {
    const label = await this.statusLabel(clientId, ticket.ticketStatus);
    if (label === 'resolved' || label === 'closed') {
      throw new BadRequestException(`This ticket is ${label} — reopen it before ${action}`);
    }
  }

  /**
   * A Closed ticket's status is frozen. The only way back is a reopen — the
   * client's request approved by the project manager / an Admin, or a staff
   * reopen of an internal ticket — which clears the stamps and moves the status
   * itself. Read off the live status on every call, so it holds again after each
   * reopen → resolve → close round.
   */
  private async assertNotClosed(
    ticket: { ticketStatus: string; customerCompanyId: string | null }, clientId: string, viewer: TicketViewer,
  ) {
    if ((await this.statusLabel(clientId, ticket.ticketStatus)) !== 'closed') return;
    throw new BadRequestException(
      ticket.customerCompanyId
        ? 'This ticket is closed — its status can only change through a reopen request from the client, approved by the project manager or an Admin'
        : isAdmin(viewer)
          ? 'This ticket is closed — use Reopen to bring it back'
          : 'This ticket is closed — send a reopen request; an Admin approves it before the ticket reopens',
    );
  }

  async update(
    id: string,
    clientId: string,
    dto: UpdateTicketDto,
    actorId: string,
    viewer: TicketViewer,
  ) {
    const ticket = await this.findOne(id, clientId, viewer);
    this.assertNotHeld(ticket);

    // A status change can carry two lifecycle events: closing the ticket (stamps
    // closedDate) or resolving it (stamps resolvedAt and notifies the client).
    let closedDate = ticket.closedDate;
    let resolvedAt = ticket.resolvedAt;
    let resolvedById = ticket.resolvedById;
    let nowResolved = false;
    // When the status last moved. Stamped here so the detail screen can say how
    // long the ticket has stood where it is without walking the audit log.
    let statusChangedAt = ticket.statusChangedAt;
    // Display labels for the audit entry, so History reads "Open to In progress"
    // rather than quoting the tenant's raw picklist codes at the reader.
    let fromLabel = ticket.ticketStatus;
    let toLabel = dto.ticketStatus ?? ticket.ticketStatus;
    // The new status's meaning, for the status emails after the write.
    let movedTo: string | null = null;
    if (dto.ticketStatus && dto.ticketStatus !== ticket.ticketStatus) {
      await this.assertNotClosed(ticket, clientId, viewer);
      const label = await this.statusLabel(clientId, dto.ticketStatus);
      movedTo = label;
      // Asking a client for more information says what is needed — it is
      // emailed to them and posted into the ticket's chat.
      if (label === AWAITING_CLIENT_STATUS && ticket.customerCompanyId && !dto.requestedInformation?.trim()) {
        throw new BadRequestException('Say what information you need from the client — it is emailed to them');
      }
      statusChangedAt = new Date();
      [fromLabel, toLabel] = await Promise.all([
        this.statusDisplay(clientId, ticket.ticketStatus),
        this.statusDisplay(clientId, dto.ticketStatus),
      ]);
      if (label === 'closed') this.assertStaffMayClose(ticket);
      if (label === 'resolved' || label === 'closed') {
        await this.assertTasksComplete(id, label);
        await this.assertTimeLogged(id, label);
        // Only on the way in: a ticket resolved before this rule existed must
        // still be closable, and re-closing a resolved one is not a new sign-off.
        if (!ticket.resolvedAt) {
          this.assertResolutionNotes(ticket.resolution, label);
        }
      }
      if (label === 'closed' && !closedDate) closedDate = new Date();
      // Resolving from the status dropdown must stamp the same fields the
      // Resolution tab does, or the ticket still reads as "not resolved yet"
      // and the client has nothing to acknowledge.
      if (label === 'resolved' && !resolvedAt) {
        resolvedAt = new Date();
        resolvedById = actorId;
        nowResolved = true;
      }
    }

    const mergedCustomFields =
      dto.customFields !== undefined
        ? {
            ...((ticket.customFields as Record<string, unknown>) ?? {}),
            ...dto.customFields,
          }
        : undefined;

    // When priority changes, re-derive the SLA target + Due Date from the policy
    // (measured from ticket creation), unless a Due Date is explicitly supplied.
    let slaHours: number | undefined;
    let slaDue: Date | undefined;
    if (dto.priority && dto.priority !== ticket.priority) {
      const sla = await this.prisma.slaPolicy.findFirst({
        where: { clientId, priority: dto.priority, isActive: true },
      });
      if (sla) {
        slaHours = sla.resolutionHours;
        // Time already spent paused (waiting on the client) does not count.
        slaDue = new Date(
          new Date(ticket.createdAt).getTime() + sla.resolutionHours * 3600 * 1000 + ticket.slaPausedSeconds * 1000,
        );
      }
    }
    // The SLA clock pauses while the ticket waits on the client and resumes —
    // due date pushed back by the wait — when it moves on.
    let slaPause: Prisma.TicketUpdateInput = {};
    if (movedTo === AWAITING_CLIENT_STATUS && !ticket.slaPausedAt && (slaDue ?? ticket.dueDate)) {
      slaPause = { slaPausedAt: new Date() };
    } else if (movedTo && movedTo !== AWAITING_CLIENT_STATUS && ticket.slaPausedAt) {
      slaPause = this.slaResume({ ...ticket, dueDate: slaDue ?? ticket.dueDate });
    }

    const updated = await this.prisma.ticket.update({
      where: { id },
      data: {
        ticketStatus: dto.ticketStatus,
        priority: dto.priority,
        ticketCategory: dto.ticketCategory,
        subCategory: dto.subCategory,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : slaDue,
        expectedResolutionDate: dto.expectedResolutionDate
          ? new Date(dto.expectedResolutionDate)
          : slaDue,
        ...(slaHours !== undefined && { slaHours }),
        statusChangedAt,
        closedDate,
        resolvedAt,
        resolvedById,
        ...slaPause,
        ...(mergedCustomFields !== undefined && {
          customFields: mergedCustomFields as Prisma.InputJsonValue,
        }),
        updatedBy: actorId,
      },
      include: {
        template: { select: { id: true, name: true, category: true } },
        technicians: {
          include: { user: { select: { id: true, username: true, name: true } } },
        },
      },
    });

    if (dto.ticketStatus && dto.ticketStatus !== ticket.ticketStatus) {
      await this.activity.log({
        ticketId: id,
        actorUserId: actorId,
        type: 'STATUS_CHANGED',
        summary: `Status changed from ${fromLabel} to ${toLabel}`,
        meta: { from: ticket.ticketStatus, to: dto.ticketStatus },
      });
      if (closedDate && !ticket.closedDate) {
        await this.activity.log({ ticketId: id, actorUserId: actorId, type: 'CLOSED', summary: 'Ticket closed' });
        await this.notifyClosed(clientId, { ...ticket, ...updated }, actorId, 'STAFF');
      }
      if (movedTo === IN_PROGRESS_STATUS) {
        await this.notifyInProgress(clientId, ticket, actorId);
      }
      if (movedTo === AWAITING_CLIENT_STATUS && ticket.customerCompanyId) {
        await this.requestClientInformation(clientId, ticket, dto.requestedInformation!.trim(), actorId);
      }
    }
    if (dto.priority && dto.priority !== ticket.priority) {
      await this.activity.log({
        ticketId: id,
        actorUserId: actorId,
        type: 'PRIORITY_CHANGED',
        summary: `Priority changed to ${dto.priority}`,
        meta: { from: ticket.priority, to: dto.priority },
      });
    }
    // Only on the transition into Resolved — re-saving a resolved ticket must
    // not notify the client twice.
    if (nowResolved) {
      await this.activity.log({ ticketId: id, actorUserId: actorId, type: 'RESOLVED', summary: 'Ticket resolved' });
      await this.notifyResolved(updated, clientId, actorId);
    }
    return updated;
  }

  /**
   * 5. Additional Information Requested. A client ticket moved to "Awaiting
   * End-user Response" carries what is needed: it goes into the ticket's chat
   * (so the client sees it in the portal and can answer there), into History,
   * to the requester's bell, and to them by email. Never throws.
   */
  private async requestClientInformation(
    clientId: string,
    ticket: NotifyTicket,
    info: string,
    actorId: string,
  ) {
    try {
      const actor = await this.prisma.user.findUnique({ where: { id: actorId }, select: { username: true, name: true } });
      await this.prisma.ticketMessage.create({
        data: {
          ticketId: ticket.id, channel: 'INTERNAL', direction: 'OUTBOUND', isInternal: true,
          authorUserId: actorId, authorName: actor ? displayName(actor) : null,
          body: `Additional information required:\n${info}`,
        },
      });
      await this.activity.log({
        ticketId: ticket.id, actorUserId: actorId, type: 'INFO_REQUESTED',
        summary: `Information requested from the client: ${info}`,
      });
      await this.fireEvent(clientId, 'INFO_REQUESTED', {
        ticket, actorId,
        mail: {
          client: {
            subject: `[Action Required] Additional Information Required - ${ticket.ticketNumber}`,
            content: MAIL.infoRequested(info),
          },
        },
        bell: {
          client: {
            type: 'TICKET_INFO_REQUESTED', link: `/tickets/${ticket.id}?tab=conversation`,
            title: `Information needed · ${ticket.ticketNumber}`,
            body: info.length > 140 ? `${info.slice(0, 140)}…` : info,
          },
        },
        detail: 'waiting on the requester',
      });
    } catch (err) {
      this.logger.error(`Failed to request information on ${ticket.ticketNumber}`, err instanceof Error ? err.stack : String(err));
    }
  }

  /**
   * 6. Requestor Responded. Called by the chat, an emailed reply and the
   * comments thread whenever the client writes on their ticket. It acts only
   * while the ticket is "Awaiting End-user Response": the ticket goes back to
   * In Progress (so SLA escalation watches it again), and — when `email` — the
   * assigned agent gets the client's response. Returns whether it acted, so a
   * caller can skip its own email to the agent. Never throws.
   */
  async requesterResponded(
    ticketId: string,
    clientId: string,
    response: string,
    opts: { email: boolean; actorUserId?: string | null },
  ): Promise<boolean> {
    try {
      const t = await this.prisma.ticket.findFirst({
        where: { id: ticketId, clientId },
        select: {
          id: true, ticketNumber: true, subject: true, ticketStatus: true, customerCompanyId: true, productId: true,
          requestorUserId: true, requestorEmail: true, requestorName: true,
          dueDate: true, expectedResolutionDate: true, slaPausedAt: true, slaPausedSeconds: true, slaEscalatedFor: true,
        },
      });
      if (!t?.customerCompanyId) return false;
      if ((await this.statusLabel(clientId, t.ticketStatus)) !== AWAITING_CLIENT_STATUS) return false;
      const inProgress = await this.prisma.picklistOption.findFirst({
        where: { clientId, listKey: 'ticketStatus', isActive: true, label: { equals: 'In Progress', mode: 'insensitive' } },
        select: { value: true },
      });
      if (inProgress) {
        const from = await this.statusDisplay(clientId, t.ticketStatus);
        await this.prisma.ticket.update({
          where: { id: t.id },
          // Back to work: the SLA clock paused while waiting resumes.
          data: { ticketStatus: inProgress.value, statusChangedAt: new Date(), ...this.slaResume(t) },
        });
        await this.activity.log({
          ticketId: t.id, actorUserId: opts.actorUserId ?? null, type: 'STATUS_CHANGED',
          summary: `Status changed from ${from} to ${await this.statusDisplay(clientId, inProgress.value)} — the client responded`,
          meta: { from: t.ticketStatus, to: inProgress.value, auto: true },
        });
      }
      // When the client replied by email, that reply has already reached the agent.
      const excerpt = response.trim();
      await this.fireEvent(clientId, 'REQUESTER_RESPONDED', {
        ticket: t, actorId: opts.actorUserId, emailOff: !opts.email,
        mail: {
          agent: {
            subject: `[Client Response] – Requestor responded for ${t.ticketNumber}`,
            content: MAIL.requesterResponded(excerpt),
          },
        },
        bell: {
          agent: {
            type: 'TICKET_REQUESTER_RESPONDED', title: `Client responded · ${t.ticketNumber}`,
            body: excerpt.length > 140 ? `${excerpt.slice(0, 140)}…` : excerpt,
          },
        },
      });
      return true;
    } catch (err) {
      this.logger.error(`Failed to handle a client response on ${ticketId}`, err instanceof Error ? err.stack : String(err));
      return false;
    }
  }

  /**
   * The writes that end an SLA pause (a ticket leaving "Awaiting End-user
   * Response"): the due date — and an expected resolution date that tracks it —
   * move later by the time spent waiting, which is added to the running total.
   * A ticket already escalated stays escalated: `slaEscalatedFor` follows the
   * shifted date, so the move alone never reads as a new breach. Empty when the
   * clock is not paused.
   */
  private slaResume(
    t: {
      slaPausedAt: Date | null; slaPausedSeconds: number; dueDate: Date | null;
      expectedResolutionDate: Date | null; slaEscalatedFor: Date | null;
    },
    now = new Date(),
  ): Prisma.TicketUpdateInput {
    if (!t.slaPausedAt) return {};
    const ms = Math.max(0, now.getTime() - t.slaPausedAt.getTime());
    const shift = (d: Date) => new Date(d.getTime() + ms);
    const due = t.dueDate;
    const same = (d: Date | null) => !!d && !!due && d.getTime() === due.getTime();
    return {
      slaPausedAt: null,
      slaPausedSeconds: t.slaPausedSeconds + Math.round(ms / 1000),
      ...(due && { dueDate: shift(due) }),
      ...(due && same(t.expectedResolutionDate) && { expectedResolutionDate: shift(due) }),
      ...(due && same(t.slaEscalatedFor) && { slaEscalatedFor: shift(due) }),
    };
  }

  /** 7. Ticket In Progress — staff moved the ticket to In Progress. Never throws. */
  private async notifyInProgress(clientId: string, ticket: NotifyTicket, actorId: string) {
    try {
      await this.fireEvent(clientId, 'TICKET_IN_PROGRESS', {
        ticket, actorId,
        mail: {
          client: {
            subject: `[In Progress] Your Ticket is Being Worked On - ${ticket.ticketNumber}`,
            content: MAIL.inProgress(await this.latestStaffUpdate(ticket.id)),
          },
        },
        bell: {
          client: { type: 'TICKET_IN_PROGRESS', title: 'Ticket in progress', body: `${ticket.ticketNumber} — ${ticket.subject} is being worked on.` },
        },
      });
    } catch (err) {
      this.logger.error(`Failed to send the in-progress notice for ${ticket.ticketNumber}`, err instanceof Error ? err.stack : String(err));
    }
  }

  /** The newest chat message a member of staff wrote on the ticket — its "latest update". */
  private async latestStaffUpdate(ticketId: string): Promise<string | null> {
    const recent = await this.prisma.ticketMessage.findMany({
      where: { ticketId, authorUserId: { not: null } },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { authorUserId: true, body: true },
    });
    if (!recent.length) return null;
    const staff = await this.prisma.user.findMany({
      where: { id: { in: [...new Set(recent.map((m) => m.authorUserId!))] }, customerCompanyId: null },
      select: { id: true },
    });
    const ids = new Set(staff.map((s) => s.id));
    return recent.find((m) => ids.has(m.authorUserId!))?.body.trim() || null;
  }

  /**
   * 11/12. SLA breach → escalation (hourly, `TicketSlaEscalationService`). An
   * open, live ticket past its `dueDate` is escalated once — a bell and an email
   * to the client product's project manager, else the tenant Admins.
   * `slaEscalatedFor` records the due date that was escalated, so a new due
   * date (a priority change) arms it again without any writer resetting it.
   * Skipped: tickets waiting on the client or on hold, a reopened ticket whose
   * due date had already passed when it was reopened (reopen keeps the old
   * one), and tickets whose SLA policy has "Escalation enabled" off. The
   * backlog that was already overdue when this shipped was marked as escalated
   * by `manual/ticket_sla_escalation.sql`.
   */
  async escalateBreachedSla(): Promise<{ escalated: number }> {
    const now = new Date();
    let escalated = 0;
    const clients = await this.prisma.client.findMany({ select: { id: true } });
    for (const { id: clientId } of clients) {
      const settled = await this.settledStatusValues(clientId);
      const overdue = await this.prisma.ticket.findMany({
        where: {
          clientId,
          dueDate: { lt: now },
          ticketStatus: { notIn: settled },
          approvalStatus: { in: ['NONE', 'APPROVED'] },
        },
        select: {
          id: true, ticketNumber: true, subject: true, ticketStatus: true, priority: true,
          dueDate: true, slaEscalatedFor: true, reopenedAt: true, customerCompanyId: true, productId: true,
          requestorUserId: true, requestorEmail: true, requestorName: true,
        },
      });
      for (const t of overdue) {
        const due = t.dueDate!;
        if (t.slaEscalatedFor && t.slaEscalatedFor.getTime() === due.getTime()) continue;
        if (t.reopenedAt && due <= t.reopenedAt) continue;
        const label = await this.statusLabel(clientId, t.ticketStatus);
        if (label === AWAITING_CLIENT_STATUS || label === ON_HOLD_STATUS) continue;
        if (t.priority) {
          const policy = await this.prisma.slaPolicy.findFirst({
            where: { clientId, priority: t.priority, isActive: true },
            select: { escalationEnabled: true },
          });
          if (policy && !policy.escalationEnabled) continue;
        }
        // Marked first: a failing email must not repeat the escalation hourly.
        await this.prisma.ticket.update({ where: { id: t.id }, data: { slaEscalatedFor: due } });
        await this.escalate(clientId, t, now);
        escalated++;
      }
    }
    return { escalated };
  }

  /**
   * One escalation: 12. Ticket Escalated (to the client product's project
   * manager, by default), History naming who it reached, and 11. SLA Breached (to the agent, by default) at the same
   * moment — whoever the first reached is left out of the second. Who hears of
   * each is the Email Configuration. Never throws.
   */
  private async escalate(
    clientId: string,
    t: NotifyTicket & { dueDate: Date | null },
    now: Date,
  ) {
    try {
      const late = Math.max(0, now.getTime() - (t.dueDate?.getTime() ?? now.getTime()));
      const days = Math.floor(late / DAY_MS);
      const hours = Math.floor((late % DAY_MS) / 3_600_000);
      const delay = days ? `${days} day${days === 1 ? '' : 's'} ${hours} hour${hours === 1 ? '' : 's'}` : `${Math.max(hours, 1)} hour${hours > 1 ? 's' : ''}`;
      const org = await this.prisma.client.findUnique({ where: { id: clientId }, select: { dateFormat: true, timeFormat: true, timeZone: true } });
      const breachedOn = formatTenantStamp(t.dueDate, org);
      const remarks = await this.latestStaffUpdate(t.id);
      const label = `${t.ticketNumber} — ${t.subject}`;
      const reached = await this.fireEvent(clientId, 'TICKET_ESCALATED', {
        ticket: t,
        mail: { staff: { subject: `[Ticket Escalated] - ${t.ticketNumber} SLA breached`, content: MAIL.escalated(breachedOn, delay, remarks) } },
        bell: {
          staff: {
            type: 'TICKET_SLA_ESCALATED', title: `SLA breached · ${t.ticketNumber}`,
            body: `${label} is ${delay} past its SLA and has been escalated to you.`,
          },
        },
        detail: `${delay} past its SLA`,
      });
      // Named from whoever the Email Configuration actually reached — the
      // client product's project manager by default, nobody when it has none.
      const told = reached.size
        ? await this.prisma.user.findMany({ where: { id: { in: [...reached] } }, select: { username: true, name: true } })
        : [];
      const escalatedTo = told.map((u) => displayName(u)).filter(Boolean).join(', ') || null;
      await this.activity.log({
        ticketId: t.id, type: 'SLA_ESCALATED',
        summary: escalatedTo ? `SLA breached — escalated to ${escalatedTo}` : 'SLA breached — nobody to escalate to',
      });
      await this.fireEvent(clientId, 'SLA_BREACHED', {
        ticket: t,
        skipUserIds: [...reached],
        mail: {
          agent: { subject: `[SLA Breached] - ${t.ticketNumber}`, content: MAIL.slaBreached(breachedOn, delay, remarks, escalatedTo) },
        },
        bell: {
          agent: {
            type: 'TICKET_SLA_BREACHED', title: `SLA breached · ${t.ticketNumber}`,
            body: `${label} is ${delay} past its SLA${escalatedTo ? ` and has been escalated to ${escalatedTo}` : ''}.`,
          },
        },
        detail: `${delay} past its SLA`,
      });
    } catch (err) {
      this.logger.error(`Failed to escalate ${t.ticketNumber}`, err instanceof Error ? err.stack : String(err));
    }
  }

  async assignTechnicians(
    id: string,
    clientId: string,
    userIds: string[],
    actorId: string,
    viewer: TicketViewer,
  ) {
    // A ticket may have at most one agent assigned.
    if (userIds.length > 1) {
      throw new BadRequestException('Only one agent can be assigned to a ticket');
    }
    const ticket = await this.findOne(id, clientId, viewer);
    // Can't assign an agent to a ticket that hasn't cleared approval yet.
    if (ticket.approvalStatus !== 'NONE' && ticket.approvalStatus !== 'APPROVED') {
      throw new BadRequestException('This ticket is awaiting approval and cannot be assigned yet');
    }

    const ownedUsers = await this.prisma.user.count({
      where: { id: { in: userIds }, clientId },
    });
    if (ownedUsers !== userIds.length) {
      throw new BadRequestException(
        'One or more users do not belong to your organization',
      );
    }
    // Only someone on the Assigned agent field's list may take it (client
    // request) — for a client's ticket that is the client's consultants for the
    // product, its default consultants and the product's project manager — so
    // the screen and the rule cannot disagree. Clearing the agent is always allowed.
    if (userIds.length) {
      const allowed = new Set((await this.assignableFor(ticket, clientId)).map((u) => u.id));
      const outside = userIds.filter((uid) => !allowed.has(uid));
      if (outside.length) {
        const who = await this.prisma.user.findMany({ where: { id: { in: outside } }, select: { username: true, name: true } });
        throw new BadRequestException(
          ticket.customerCompanyId
            ? `${who.map(displayName).join(', ') || 'That agent'} is not one of this client's consultants for the product, a default consultant or its project manager — add them on the client's screen first.`
            : `${who.map(displayName).join(', ') || 'That agent'} is not set up for this ticket's product/module — add them on the product screen first.`,
        );
      }
    }

    // Who held it before — read *before* the deleteMany below wipes the rows, or
    // the outgoing agent is unrecoverable and cannot be told they've handed it on.
    const previous = (
      await this.prisma.ticketTechnician.findMany({
        where: { ticketId: id },
        include: { user: { select: { id: true, username: true, name: true, email: true } } },
      })
    ).map((t) => t.user);

    await this.prisma.ticketTechnician.deleteMany({ where: { ticketId: id } });
    if (userIds.length) {
      await this.prisma.ticketTechnician.createMany({
        data: userIds.map((userId) => ({ ticketId: id, userId })),
      });
    }
    await this.prisma.ticket.update({
      where: { id },
      data: { updatedBy: actorId },
    });

    const incoming = userIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, username: true, name: true, email: true },
        })
      : [];
    const assignees = incoming.length ? incoming.map(displayName).join(', ') : 'nobody';
    await this.activity.log({
      ticketId: id,
      actorUserId: actorId,
      type: 'ASSIGNED',
      summary: `Assigned to ${assignees}`,
      meta: { userIds },
    });

    // Only on a real change: re-PUTting the same agent is idempotent and must not
    // send a second round of mail to the client.
    const changed =
      previous.length !== incoming.length ||
      previous.some((p) => !incoming.some((n) => n.id === p.id));
    if (changed) {
      await this.announceAssignment(clientId, ticket, actorId, previous, incoming);
    }

    return this.findOne(id, clientId);
  }

  // ---- Activity (History) --------------------------------------------------

  async getActivity(id: string, clientId: string, viewer: TicketViewer) {
    await this.findOne(id, clientId, viewer);
    const activities = await this.activity.list(id);
    // History names people by their full name, not their username — a username
    // is often an employee id (client request). Assignment lines are rebuilt
    // from the ids in `meta`, so entries written before this read the same.
    const metaIds = (a: { type: string; meta: Prisma.JsonValue }): string[] => {
      if (a.type !== 'ASSIGNED' || !a.meta || typeof a.meta !== 'object' || Array.isArray(a.meta)) return [];
      const m = a.meta as { userId?: unknown; userIds?: unknown };
      if (Array.isArray(m.userIds)) return m.userIds.filter((x): x is string => typeof x === 'string');
      return typeof m.userId === 'string' ? [m.userId] : [];
    };
    const ids = Array.from(new Set([
      ...activities.map((a) => a.actorUserId).filter((x): x is string => !!x),
      ...activities.flatMap(metaIds),
    ]));
    const users = ids.length
      ? await this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, username: true, name: true } })
      : [];
    const nameById = new Map(users.map((u) => [u.id, displayName(u)]));
    const summaryOf = (a: (typeof activities)[number]) => {
      if (a.type !== 'ASSIGNED') return a.summary;
      const people = metaIds(a);
      const names = people.map((uid) => nameById.get(uid));
      if (names.some((n) => !n)) return a.summary; // someone since deleted: keep what was written
      const auto = (a.meta as { auto?: unknown } | null)?.auto === true;
      return auto ? `Auto-assigned to ${names[0]}` : `Assigned to ${names.length ? names.join(', ') : 'nobody'}`;
    };
    return activities.map((a) => ({
      ...a,
      summary: summaryOf(a),
      // The live name wins over a stored one, so a renamed user reads right.
      actorName: (a.actorUserId ? nameById.get(a.actorUserId) : undefined) ?? a.actorName ?? null,
    }));
  }

  /**
   * Who the Assigned agent field offers for this ticket (client request), in
   * priority order — never re-sorted A–Z:
   *   1. the client's own consultants for this product (this module's rows
   *      first, then the whole-product rows), primary first;
   *   2. the client's default consultants (contract-level rows), primary first;
   *   3. the client product's project manager.
   * The agents on the Products screen are deliberately **not** offered for a
   * client's ticket. An internal ticket (no client) has none of those, so it
   * still offers the product/module's own agents; a ticket with no product
   * offers all staff. Whoever holds the ticket now is always listed (last, if
   * not already in a tier), so the field never shows blank. Active internal
   * staff only. `assignTechnicians` refuses anyone outside this list.
   */
  async assignableAgents(id: string, clientId: string, viewer: TicketViewer) {
    return this.assignableFor(await this.findOne(id, clientId, viewer), clientId);
  }

  /** `assignableAgents` for a ticket already loaded — also the gate in `assignTechnicians`. */
  private async assignableFor(
    t: { productId: string | null; moduleId: string | null; customerCompanyId: string | null; technicians: { user: { id: string } }[] },
    clientId: string,
  ) {
    const select = { id: true, username: true, name: true } as const;
    const holders = t.technicians.map((x) => x.user.id);
    const byName = (a: { username: string; name: string | null }, b: { username: string; name: string | null }) =>
      displayName(a).localeCompare(displayName(b), undefined, { sensitivity: 'base', numeric: true });
    if (!t.productId) {
      const users = await this.prisma.user.findMany({ where: { clientId, isActive: true, customerCompanyId: null }, select });
      return users.sort(byName);
    }

    // Candidate ids in priority order; the first appearance of a person wins.
    let ordered: string[];
    if (t.customerCompanyId) {
      const [rows, cp] = await Promise.all([
        this.prisma.customerConsultant.findMany({
          where: {
            clientId,
            customerCompanyId: t.customerCompanyId,
            OR: [
              { productId: t.productId, moduleId: null },
              ...(t.moduleId ? [{ productId: t.productId, moduleId: t.moduleId }] : []),
              { productId: null, moduleId: null }, // the client's default consultants
            ],
          },
          select: { userId: true, productId: true, moduleId: true, isPrimary: true },
          orderBy: { createdAt: 'asc' },
        }),
        this.prisma.customerCompanyProduct.findFirst({
          where: { customerCompanyId: t.customerCompanyId, productId: t.productId },
          select: { productManagerId: true },
        }),
      ]);
      const tier = (r: { productId: string | null; moduleId: string | null }) =>
        !r.productId ? 2 : r.moduleId ? 0 : 1; // module rows · product rows · defaults
      const sorted = [...rows].sort(
        (a, b) => tier(a) - tier(b) || Number(b.isPrimary) - Number(a.isPrimary),
      ); // stable, so createdAt order holds within a tier
      ordered = [...sorted.map((r) => r.userId), ...(cp?.productManagerId ? [cp.productManagerId] : [])];
    } else {
      // Internal ticket: no client, so no client consultants or project manager.
      const catalogue = t.moduleId
        ? await this.prisma.moduleConsultant.findMany({ where: { moduleId: t.moduleId }, select: { userId: true }, orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }] })
        : await this.prisma.productConsultant.findMany({ where: { productId: t.productId }, select: { userId: true }, orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }] });
      ordered = catalogue.map((r) => r.userId);
    }
    ordered = [...new Set(ordered)];

    const users = await this.prisma.user.findMany({
      where: {
        clientId,
        customerCompanyId: null,
        OR: [{ id: { in: ordered }, isActive: true }, { id: { in: holders } }],
      },
      select,
    });
    const rank = new Map(ordered.map((id, i) => [id, i]));
    // Listed people in priority order; a current holder outside every tier last.
    return users.sort((a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity) || byName(a, b));
  }

  // ---- Resolution ----------------------------------------------------------

  async setResolution(
    id: string,
    clientId: string,
    dto: { resolution?: string; ticketStatus?: string },
    actorId: string,
    viewer: TicketViewer,
  ) {
    const ticket = await this.findOne(id, clientId, viewer);
    // It writes the status too, so on a Closed ticket it would pull it back to
    // Resolved — the same freeze as the status dropdown.
    await this.assertNotClosed(ticket, clientId, viewer);
    // Editing the notes on an already-resolved ticket is not a new resolution —
    // it must not re-notify the client.
    const wasResolved = !!ticket.resolvedAt;
    // Only on the way in — editing the notes of a ticket resolved before this
    // rule existed must not be blocked by it.
    if (!wasResolved) {
      await this.assertTasksComplete(id, 'resolved');
      await this.assertTimeLogged(id, 'resolved');
      this.assertResolutionNotes(dto.resolution, 'resolved');
    }
    const resolvedStatus = dto.ticketStatus || 'Resolved';
    // This endpoint takes a status, so it is a second door into Closed — same rule.
    if ((await this.statusLabel(clientId, resolvedStatus)) === 'closed') {
      this.assertStaffMayClose(ticket);
    }
    const updated = await this.prisma.ticket.update({
      where: { id },
      data: {
        resolution: dto.resolution,
        resolvedAt: ticket.resolvedAt ?? new Date(),
        resolvedById: ticket.resolvedById ?? actorId,
        ticketStatus: resolvedStatus,
        ...(resolvedStatus !== ticket.ticketStatus && { statusChangedAt: new Date() }),
        // Resolved straight from waiting on the client: the paused clock resumes.
        ...this.slaResume(ticket),
        updatedBy: actorId,
      },
    });
    await this.activity.log({
      ticketId: id,
      actorUserId: actorId,
      type: 'RESOLVED',
      summary: wasResolved ? 'Resolution updated' : 'Ticket resolved',
    });
    if (!wasResolved) {
      await this.notifyResolved(updated, clientId, actorId);
    }
    return updated;
  }

  /**
   * The client confirms the resolution — the one customer-side transition that
   * closes a ticket. findOne() has already scoped the ticket to the viewer's
   * tenant and customer company (and, for an employee, to the tickets they raised),
   * and CustomerContactGuard keeps staff out of this route entirely.
   */
  async acknowledge(id: string, clientId: string, actorId: string, viewer: TicketViewer) {
    const ticket = await this.findOne(id, clientId, viewer);
    // `acknowledgedAt` is the duplicate guard — one acknowledgement per resolution.
    if (ticket.acknowledgedAt) {
      throw new BadRequestException('This ticket has already been acknowledged');
    }
    const label = await this.statusLabel(clientId, ticket.ticketStatus);
    if (label === 'closed' || ticket.closedDate) {
      throw new BadRequestException('This ticket is already closed');
    }
    if (label !== 'resolved') {
      throw new BadRequestException('Only a resolved ticket can be acknowledged');
    }
    // No time check here: the ticket cleared it on the way into Resolved, and the
    // client has neither the ability nor the standing to log our hours.
    const now = new Date();
    const updated = await this.prisma.ticket.update({
      where: { id },
      data: {
        acknowledgedAt: now,
        acknowledgedById: actorId,
        ticketStatus: await this.closedStatusValue(clientId),
        statusChangedAt: now,
        closedDate: now,
        updatedBy: actorId,
      },
    });
    await this.activity.log({
      ticketId: id,
      actorUserId: actorId,
      type: 'ACKNOWLEDGED',
      summary: 'Resolution acknowledged by the client',
    });
    await this.activity.log({
      ticketId: id,
      actorUserId: actorId,
      type: 'CLOSED',
      summary: 'Ticket closed on client acknowledgement',
    });
    await this.notifyClosed(clientId, updated, actorId, 'ACKNOWLEDGED');
    return updated;
  }

  /**
   * Close every client ticket whose resolution has sat unacknowledged past the
   * tenant's window (`Client.ticketAutoCloseDays`, default 3). Silence reads as
   * acceptance — without this a resolved ticket nobody signs off stays open
   * forever, since only the client may close it (see `assertStaffMayClose`).
   * Internal tickets are skipped: they have no client to ask and staff close
   * them directly.
   *
   * Reopening is untouched — that window is measured from `resolvedAt` and is
   * independent of the close, so a client who comes back inside it can still
   * send the ticket back. Run by `TicketAutoCloseService` on a timer; every
   * failure is per-ticket so one bad row can't stop the sweep.
   */
  async autoCloseUnacknowledged() {
    const clients = await this.prisma.client.findMany({
      select: { id: true, ticketAutoCloseDays: true },
    });
    let closed = 0;
    for (const client of clients) {
      const days = client.ticketAutoCloseDays ?? DEFAULT_AUTO_CLOSE_DAYS;
      const cutoff = new Date(Date.now() - days * DAY_MS);
      const candidates = await this.prisma.ticket.findMany({
        where: {
          clientId: client.id,
          customerCompanyId: { not: null },
          resolvedAt: { not: null, lte: cutoff },
          acknowledgedAt: null,
          closedDate: null,
        },
        select: {
          id: true,
          ticketNumber: true,
          subject: true,
          ticketStatus: true,
          requestorUserId: true,
          requestorEmail: true,
          requestorName: true,
          customerCompanyId: true,
          resolvedById: true,
          productId: true,
        },
      });
      if (candidates.length === 0) continue;
      // `resolvedAt` alone doesn't prove the ticket is still resolved — moving it
      // back to In Progress leaves the stamp in place — so the live status has to
      // agree before we close anything.
      const resolvedValues = await this.resolvedStatusValues(client.id);
      const due = candidates.filter((t) => resolvedValues.has(t.ticketStatus));
      if (due.length === 0) continue;
      const closedStatus = await this.closedStatusValue(client.id);

      for (const ticket of due) {
        try {
          const now = new Date();
          await this.prisma.ticket.update({
            where: { id: ticket.id },
            data: { ticketStatus: closedStatus, statusChangedAt: now, closedDate: now },
          });
          await this.activity.log({
            ticketId: ticket.id,
            actorName: 'System',
            type: 'CLOSED',
            summary: `Ticket closed automatically — the resolution went unacknowledged for ${days} day(s)`,
          });
          await this.notifyClosed(client.id, ticket, null, 'AUTO', days);
          closed += 1;
        } catch (err) {
          this.logger.error(
            `Auto-close failed for ${ticket.ticketNumber}`,
            err instanceof Error ? err.stack : String(err),
          );
        }
      }
    }
    return { closed };
  }

  /**
   * 10. Ticket Closed — by the client's acknowledgement, by the auto-close
   * sweep (`days` = its window), or by staff closing an internal ticket. Who
   * hears of it is the Email Configuration; this says it per audience.
   */
  private async notifyClosed(
    clientId: string,
    ticket: NotifyTicket,
    actorId: string | null,
    how: 'ACKNOWLEDGED' | 'AUTO' | 'STAFF',
    days = 0,
  ) {
    const n = ticket.ticketNumber;
    const label = `${n} — ${ticket.subject}`;
    const auto: EventBell = {
      type: 'TICKET_CLOSED', title: 'Ticket closed automatically',
      body: `${label} was resolved more than ${days} day(s) ago and had no acknowledgement, so it has been closed.`,
    };
    const agentMail: EventMail =
      how === 'AUTO'
        ? {
            subject: `[Ticket Closed] - ${n} closed automatically`,
            content: MAIL.closedForAgents(
              `The following ticket was resolved more than ${days} day(s) ago and the client did not acknowledge the resolution.\n` +
                'It has therefore been closed automatically in accordance with the support policy.',
            ),
          }
        : {
            subject: `[Ticket Closed] - ${n}`,
            content: MAIL.closedForAgents(
              how === 'ACKNOWLEDGED'
                ? 'The client has acknowledged the resolution of the following ticket, and it has now been closed.\nThank you for your work on it.'
                : 'The following ticket has been closed.',
            ),
          };
    await this.fireEvent(clientId, 'TICKET_CLOSED', {
      ticket, actorId,
      mail: {
        client: { subject: `Ticket – ${n} Closed`, content: MAIL.closed() },
        agent: agentMail,
        staff: agentMail,
      },
      bell: {
        agent:
          how === 'ACKNOWLEDGED'
            ? { type: 'TICKET_ACKNOWLEDGED', title: 'Resolution acknowledged', body: `The client acknowledged ${label}. The ticket is now closed.` }
            : how === 'AUTO' ? auto : { type: 'TICKET_CLOSED', title: 'Ticket closed', body: label },
        client: how === 'AUTO' ? auto : { type: 'TICKET_CLOSED', title: 'Ticket closed', body: `${label} has been closed.` },
        PROJECT_MANAGER: {
          type: 'PM_TICKET_CLOSED', title: 'Ticket closed',
          body: how === 'ACKNOWLEDGED' ? `${label} · acknowledged by the client`
            : how === 'AUTO' ? `${label} · closed automatically, unacknowledged` : label,
        },
        staff: how === 'AUTO' ? auto : { type: 'TICKET_CLOSED', title: 'Ticket closed', body: label },
      },
    });
  }

  /**
   * A client's ticket closes only when that client acknowledges the resolution:
   * staff resolve it, the client signs off (see acknowledge()). Internal tickets —
   * no customer company on them — keep the direct staff close.
   */
  private assertStaffMayClose(ticket: { customerCompanyId: string | null }) {
    if (ticket.customerCompanyId) {
      throw new BadRequestException(
        'This ticket belongs to a client, so only their acknowledgement can close it. Mark it Resolved instead — the client is notified and closes it by acknowledging the resolution.',
      );
    }
  }

  /**
   * Resolving or closing a ticket requires time on it. Worklogs are what feed the
   * customer's support-hours pool and the AMC draw-down, so a ticket signed off
   * with an empty timesheet silently under-bills the contract.
   */
  private async assertTimeLogged(ticketId: string, action: 'resolved' | 'closed') {
    const totals = await this.prisma.ticketWorklog.aggregate({
      where: { ticketId },
      _sum: { hours: true },
    });
    if (!(Number(totals._sum.hours ?? 0) > 0)) {
      throw new BadRequestException(
        `Log the time spent on this ticket before marking it ${action}`,
      );
    }
  }

  /**
   * A ticket cannot be signed off while work on it is still outstanding. A task is
   * settled when it is DONE or explicitly CANCELLED — cancelling is the honest way
   * to clear a task that turned out not to be needed, rather than ticking it done
   * or deleting the record. A ticket with no tasks is unaffected.
   */
  private async assertTasksComplete(ticketId: string, action: 'resolved' | 'closed') {
    const open = await this.prisma.ticketTask.count({
      where: { ticketId, status: { notIn: SETTLED_TASK_STATUSES } },
    });
    if (open > 0) {
      throw new BadRequestException(
        `${open} task${open === 1 ? ' is' : 's are'} still open on this ticket — complete or cancel ${open === 1 ? 'it' : 'them'} before marking it ${action}`,
      );
    }
  }

  /**
   * A ticket cannot be signed off with nothing said about how. The notes are what
   * the client is asked to acknowledge, and what they judge a reopen on, so an
   * empty resolution makes the whole acknowledge/close loop meaningless.
   */
  private assertResolutionNotes(
    resolution: string | null | undefined,
    action: 'resolved' | 'closed',
  ) {
    if (!resolution?.trim()) {
      throw new BadRequestException(
        `Write a resolution message before marking this ticket ${action}`,
      );
    }
  }

  /**
   * The meaning of a status *value* for this tenant. Statuses are tenant-configurable
   * picklist rows, so match on the option's label and fall back to the raw value —
   * the same rule the closed-date stamp has always used.
   */
  private async statusLabel(clientId: string, value: string) {
    const option = await this.prisma.picklistOption.findFirst({
      where: { clientId, listKey: 'ticketStatus', value },
    });
    return (option?.label ?? value).trim().toLowerCase();
  }

  /**
   * The same lookup as `statusLabel()` but keeping the tenant's own casing, for
   * text a person reads. `statusLabel()` lower-cases because it is compared
   * against literals like 'resolved'; an audit line must not shout the result of
   * that back at the reader.
   */
  private async statusDisplay(clientId: string, value: string) {
    const option = await this.prisma.picklistOption.findFirst({
      where: { clientId, listKey: 'ticketStatus', value },
    });
    return (option?.label ?? value).trim();
  }

  /**
   * Every status *value* this tenant treats as "Resolved" — the auto-close sweep
   * checks membership per ticket, so it reads the list once instead of hitting
   * `statusLabel()` for each row.
   */
  private async resolvedStatusValues(clientId: string) {
    const options = await this.prisma.picklistOption.findMany({
      where: { clientId, listKey: 'ticketStatus' },
      select: { value: true, label: true },
    });
    const values = options
      .filter((o) => (o.label ?? o.value).trim().toLowerCase() === 'resolved')
      .map((o) => o.value);
    // A tenant with no picklist row still uses the seeded literal.
    return new Set(values.length ? values : ['Resolved']);
  }

  /** This tenant's own "Closed" status value, falling back to the seeded 'Closed'. */
  private async closedStatusValue(clientId: string) {
    const options = await this.prisma.picklistOption.findMany({
      where: { clientId, listKey: 'ticketStatus', isActive: true },
      orderBy: { sortOrder: 'asc' },
      select: { value: true, label: true },
    });
    return (
      options.find((o) => (o.label ?? o.value).trim().toLowerCase() === 'closed')?.value ?? 'Closed'
    );
  }

  /**
   * Every status *value* this tenant treats as settled — Resolved, Closed or
   * Rejected. A ticket in one of these does not make its holder busy for ticket
   * routing. Matched by LABEL with the seeded literal as a per-label fallback,
   * the same way `resolvedStatusValues` / `closedStatusValue` do; it deliberately
   * overlaps both rather than replacing them, since those two have their own
   * callers and their own shapes (a Set, and one active value in sortOrder).
   *
   * Inactive options are included on purpose: a status retired after tickets were
   * closed under it must still read as settled. 'Rejected' is appended
   * unconditionally because `reject()` and `rejectByCustomerAdmin()` write that
   * literal directly instead of resolving the picklist.
   */
  private async settledStatusValues(clientId: string): Promise<string[]> {
    const options = await this.prisma.picklistOption.findMany({
      where: { clientId, listKey: 'ticketStatus' },
      select: { value: true, label: true },
    });
    const byLabel = (want: string, fallback: string) => {
      const hits = options
        .filter((o) => (o.label ?? o.value).trim().toLowerCase() === want)
        .map((o) => o.value);
      return hits.length ? hits : [fallback];
    };
    return [...new Set([
      ...byLabel('resolved', 'Resolved'),
      ...byLabel('closed', 'Closed'),
      ...byLabel('rejected', 'Rejected'),
      'Rejected',
    ])];
  }

  /**
   * The routing pass's chooser (built once, three queries, never a count per
   * candidate): given one step's candidates in priority order, the active user
   * of this tenant holding the fewest open tickets below the organization's
   * `ticketMaxOpenPerAgent` (null = no limit), the earlier one on a tie. A
   * ticket counts towards its agent unless its status is one of
   * `FREE_STATUS_LABELS` (On Hold, the Awaiting ones, Approval Pending,
   * Resolved, Closed, Rejected), matched on the tenant's picklist label.
   *
   * The active check is `clientId + isActive` alone. Narrowing it with
   * `customerCompanyId: null` looks tighter but would silently make a mis-seeded
   * staff row permanently unassignable, with no error to explain it.
   */
  private async agentPicker(clientId: string): Promise<AgentPicker> {
    const [org, statusOpts] = await Promise.all([
      this.prisma.client.findUnique({ where: { id: clientId }, select: { ticketMaxOpenPerAgent: true } }),
      this.prisma.picklistOption.findMany({ where: { clientId, listKey: 'ticketStatus' }, select: { value: true, label: true } }),
    ]);
    const isFree = (s: string) => FREE_STATUS_LABELS.includes(s.trim().toLowerCase());
    // Picklist values whose label means free, plus 'Rejected', which `reject()`
    // writes directly whether or not an option carries it.
    const free = [...new Set([...statusOpts.filter((o) => isFree(o.label ?? o.value)).map((o) => o.value), 'Rejected'])];
    const [active, held] = await Promise.all([
      this.prisma.user.findMany({ where: { clientId, isActive: true }, select: { id: true } }),
      this.prisma.ticketTechnician.groupBy({
        by: ['userId'],
        where: { ticket: { clientId, ticketStatus: { notIn: free } } },
        _count: { _all: true },
      }),
    ]);
    const activeIds = new Set(active.map((u) => u.id));
    const load = new Map(held.map((h) => [h.userId, h._count._all]));
    const max = org?.ticketMaxOpenPerAgent ?? null;
    return (candidates) => pickLeastLoaded(candidates, (id) => load.get(id) ?? 0, (id) => activeIds.has(id), max);
  }

  /**
   * When an unacknowledged resolution will close itself. Only a client ticket
   * that is resolved, unacknowledged and still open has a date — everything else
   * returns null, so the ticket screen shows the deadline exactly when the sweep
   * in `autoCloseUnacknowledged()` would act on it.
   */
  private async autoCloseWindow(
    clientId: string,
    ticket: {
      resolvedAt: Date | null;
      acknowledgedAt: Date | null;
      closedDate: Date | null;
      customerCompanyId: string | null;
    },
  ) {
    const client = await this.prisma.client.findUnique({
      where: { id: clientId },
      select: { ticketAutoCloseDays: true },
    });
    const days = client?.ticketAutoCloseDays ?? DEFAULT_AUTO_CLOSE_DAYS;
    const waiting =
      !!ticket.customerCompanyId && !!ticket.resolvedAt && !ticket.acknowledgedAt && !ticket.closedDate;
    if (!waiting) return { days, at: null };
    return { days, at: new Date(ticket.resolvedAt!.getTime() + days * DAY_MS) };
  }

  /**
   * The tenant's reopen window and where a given resolution sits inside it.
   * An unresolved ticket has no deadline and is always reopenable (the button is
   * hidden anyway); a resolved one stops being reopenable `windowDays` after
   * `resolvedAt`. Shape is shared by the enforcement in `reopen()` and the
   * `findOne()` projection the ticket screen renders from, so both agree. This is
   * purely about *time* — who may reopen is a separate rule (customer side only).
   */
  private async reopenWindow(clientId: string, resolvedAt?: Date | null, reopenedCount = 0) {
    const client = await this.prisma.client.findUnique({
      where: { id: clientId },
      select: { ticketReopenWindowDays: true, ticketMaxReopens: true },
    });
    const windowDays = client?.ticketReopenWindowDays ?? DEFAULT_REOPEN_WINDOW_DAYS;
    // The tenant's cap on reopens per ticket. Counted off `reopenedCount`, which
    // every reopen (direct or an approved request) increments.
    const maxReopens = client?.ticketMaxReopens ?? DEFAULT_MAX_REOPENS;
    const limitReached = reopenedCount >= maxReopens;
    if (!resolvedAt) return { windowDays, reopenDeadline: null, windowOpen: true, maxReopens, limitReached };
    const reopenDeadline = new Date(resolvedAt.getTime() + windowDays * DAY_MS);
    return { windowDays, reopenDeadline, windowOpen: Date.now() <= reopenDeadline.getTime(), maxReopens, limitReached };
  }

  /** Refuses a reopen once the ticket has used up the tenant's allowance. */
  private assertReopensLeft(window: { maxReopens: number; limitReached: boolean }) {
    if (window.limitReached) {
      throw new BadRequestException(
        `This ticket has already been reopened the maximum of ${window.maxReopens} time${window.maxReopens === 1 ? '' : 's'}. Please create a new ticket instead.`,
      );
    }
  }

  async reopen(
    id: string,
    clientId: string,
    dto: { reason?: string },
    actorId: string,
    viewer: TicketViewer,
  ) {
    const ticket = await this.findOne(id, clientId, viewer);
    // A customer's ticket is never reopened directly: the client *asks*
    // (`requestReopen`) and the project manager or an Admin decides. Only an
    // internal ticket — no client to ask — is reopened here, by staff, the same
    // way internal tickets keep the direct close.
    if (ticket.customerCompanyId) {
      throw new ForbiddenException(
        isCustomerSide(viewer)
          ? 'Send a reopen request instead — your project manager approves it before the ticket reopens.'
          : 'Only the client can ask to reopen their own ticket. Raise a new ticket if the issue needs more work.',
      );
    }
    // Only a ticket that is actually settled can come back — reopening one that is
    // still being worked would just burn one of its reopens.
    const liveLabel = await this.statusLabel(clientId, ticket.ticketStatus);
    if (!ticket.resolvedAt || (liveLabel !== 'resolved' && liveLabel !== 'closed')) {
      throw new BadRequestException('Only a resolved or closed ticket can be reopened');
    }
    // A resolved ticket only stays reopenable for the tenant's window; after that
    // the issue is a fresh ticket, not a revival of an old one.
    const window = await this.reopenWindow(clientId, ticket.resolvedAt, ticket.reopenedCount);
    if (!window.windowOpen) {
      throw new BadRequestException(
        `This ticket was resolved more than ${window.windowDays} days ago and can no longer be reopened. Please create a new ticket instead.`,
      );
    }
    this.assertReopensLeft(window);
    // Why it's coming back is the whole point of the action — the agents get it
    // as a notification and the history keeps it.
    const reason = dto?.reason?.trim();
    if (!reason) {
      throw new BadRequestException('Tell us why this ticket needs to be reopened');
    }
    // An internal ticket is reopened directly by an Admin only; anyone else on
    // staff asks (`requestReopen`) and an Admin approves — the same gate a
    // client's ticket has, with the Admins as the deciders.
    if (!isAdmin(viewer)) {
      throw new ForbiddenException('Send a reopen request instead — an Admin approves it before the ticket reopens.');
    }
    return this.applyReopen(ticket, clientId, reason, actorId, actorId);
  }

  /**
   * The reopen itself, shared by a staff reopen of an internal ticket and an
   * approved reopen request. `reopenedById` is who asked for it (shown on the
   * ticket); `actorId` is who made it happen (and gets no notification).
   */
  private async applyReopen(
    ticket: NotifyTicket & { ticketStatus: string },
    clientId: string,
    reason: string,
    reopenedById: string,
    actorId: string,
    extra: Prisma.TicketUpdateInput = {},
  ) {
    const id = ticket.id;
    const reopenStatus = await this.reopenedStatus(clientId);
    const updated = await this.prisma.ticket.update({
      where: { id },
      data: {
        resolvedAt: null,
        resolvedById: null,
        closedDate: null,
        // Clear the sign-off too: the next resolution needs its own acknowledgement,
        // and a stale stamp would make the duplicate guard reject it forever.
        acknowledgedAt: null,
        acknowledgedById: null,
        ticketStatus: reopenStatus,
        statusChangedAt: new Date(),
        reopenedCount: { increment: 1 },
        reopenReason: reason,
        reopenedAt: new Date(),
        reopenedById,
        updatedBy: actorId,
        ...extra,
      },
    });
    await this.activity.log({
      ticketId: id,
      actorUserId: actorId,
      type: 'REOPENED',
      summary: `Ticket reopened: ${reason}`,
    });
    // The people who worked it need to know it's back, and why.
    await this.notifyReopened(clientId, ticket, reason, reopenedById, actorId);
    return updated;
  }

  /**
   * The status a reopened ticket lands in (client request): the tenant's
   * `Reopened` value, so reopened work can be filtered and counted on its own.
   * Added to the Ticket Status list on first use if the tenant lacks it (placed
   * just after the first status, never before it, since creation takes the
   * first). An admin who deactivated it gets the old behaviour — the first
   * active status. Keyed on the value, so renaming its label is fine.
   */
  private async reopenedStatus(clientId: string) {
    const where = { clientId, listKey: 'ticketStatus' };
    const existing = await this.prisma.picklistOption.findFirst({ where: { ...where, value: REOPENED_STATUS } });
    const first = () =>
      this.prisma.picklistOption.findFirst({ where: { ...where, isActive: true }, orderBy: { sortOrder: 'asc' } });
    if (existing) return existing.isActive ? REOPENED_STATUS : ((await first())?.value ?? 'Open');
    const head = await first();
    try {
      await this.prisma.picklistOption.create({
        data: { ...where, value: REOPENED_STATUS, label: REOPENED_STATUS, sortOrder: (head?.sortOrder ?? 0) + 1 },
      });
    } catch (e) {
      // Two reopens racing to add it: the other one won, which is all we need.
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
    }
    return REOPENED_STATUS;
  }

  /**
   * 9. Ticket Reopened — by an Admin directly (internal tickets), or on an
   * approved reopen request (`reopenedById` = who asked). Who hears of it is
   * the Email Configuration; this says it per audience. Never throws.
   */
  private async notifyReopened(
    clientId: string,
    ticket: NotifyTicket & { ticketStatus: string },
    reason: string,
    reopenedById: string,
    actorId: string,
  ) {
    try {
      const n = ticket.ticketNumber;
      const label = `${n} — ${ticket.subject}`;
      const [actor, asker] = await Promise.all([
        this.prisma.user.findUnique({ where: { id: actorId }, select: { username: true, name: true } }),
        reopenedById !== actorId
          ? this.prisma.user.findUnique({ where: { id: reopenedById }, select: { username: true, name: true, customerCompanyId: true } })
          : null,
      ]);
      const by = actor ? displayName(actor) : 'an admin';
      const how = asker
        ? `at ${asker.customerCompanyId ? "the client's" : `${displayName(asker)}'s`} request (approved by ${by})`
        : `by ${by}`;
      const byClient = !!asker?.customerCompanyId;
      const toAgents: EventMail = {
        subject: `[Ticket Reopened] - ${n} reopened`,
        content: {
          intro: `The following ticket has been reopened ${how} and requires further attention.`,
          fields: [
            'number', 'subject', 'requestedBy', 'client', 'priority',
            ['Previous Status', await this.statusDisplay(clientId, ticket.ticketStatus)],
            { key: 'status', label: 'Current Status' }, 'assignedTeam',
          ],
          sections: [{ title: 'Reason for Reopening', body: reason }],
          outro: 'Please review the previous resolution and the latest comments before proceeding.',
          linkLabel: 'View Reopened Ticket',
        },
      };
      const bell: EventBell = {
        type: 'TICKET_REOPENED', title: byClient ? 'Ticket reopened by the client' : 'Ticket reopened',
        body: `${label}. Reason: ${reason}`,
      };
      await this.fireEvent(clientId, 'TICKET_REOPENED', {
        ticket, actorId,
        mail: {
          agent: toAgents,
          staff: toAgents,
          client: {
            subject: `[Ticket Reopened] - ${n}`,
            content: {
              intro: 'Your support ticket has been reopened, and our support team will continue working on it.',
              fields: ['number', 'subject', 'priority', 'status', 'assignedAgent'],
              sections: [{ title: 'Reason for Reopening', body: reason }],
              outro: 'Our team will keep you informed about further progress.',
            },
          },
        },
        bell: {
          agent: bell,
          staff: bell,
          client: { type: 'TICKET_REOPENED', title: 'Ticket reopened', body: `${label} is open again.` },
          PROJECT_MANAGER: { type: 'PM_TICKET_REOPENED', title: 'Ticket reopened', body: `${label} · ${reason}` },
        },
      });
    } catch (err) {
      this.logger.error(`Failed to announce the reopen of ${ticket.ticketNumber}`, err instanceof Error ? err.stack : String(err));
    }
  }

  // ---- Reopen requests: the client asks, the project manager (or an Admin) decides ----

  /**
   * Who decides a reopen of this ticket: the project manager set on the client's
   * product (`CustomerCompanyProduct.productManagerId`), if they are still an
   * active member of staff. Null means nobody is set, and the tenant Admins decide.
   */
  private async reopenApproverFor(
    clientId: string,
    ticket: { customerCompanyId: string | null; productId: string | null },
  ): Promise<string | null> {
    if (!ticket.customerCompanyId || !ticket.productId) return null;
    const link = await this.prisma.customerCompanyProduct.findFirst({
      where: { customerCompanyId: ticket.customerCompanyId, productId: ticket.productId, customerCompany: { clientId } },
      select: { productManager: { select: { id: true, isActive: true, clientId: true, customerCompanyId: true } } },
    });
    const pm = link?.productManager;
    return pm && pm.isActive && pm.clientId === clientId && !pm.customerCompanyId ? pm.id : null;
  }

  /**
   * A customer ticket went live with no agent — auto-assignment is off for the
   * client, or every consultant was busy. The client product's project manager
   * assigns it, so they get a bell **and an email** (client request; the
   * project manager's other ticket events stay bell-only). The Admins keep their
   * ordinary "New ticket created" bell. Skipped with no project manager, or when
   * they are in `skip` (the actor). Never throws.
   */
  private async alertProjectManagerUnassigned(
    clientId: string,
    t: { id: string; ticketNumber: string; subject: string; customerCompanyId: string | null; productId: string | null },
    reason: string,
    skip: (string | null | undefined)[] = [],
  ) {
    try {
      const pmId = await this.reopenApproverFor(clientId, t);
      if (!pmId || skip.includes(pmId)) return;
      const [pm, company] = await Promise.all([
        this.prisma.user.findUnique({ where: { id: pmId }, select: { username: true, name: true, email: true } }),
        t.customerCompanyId
          ? this.prisma.customerCompany.findUnique({ where: { id: t.customerCompanyId }, select: { name: true } })
          : null,
      ]);
      await this.notifications.notify({
        clientId, userId: pmId, type: 'PM_TICKET_UNASSIGNED', ticketId: t.id,
        title: 'Ticket needs an agent',
        body: `${t.ticketNumber} — ${t.subject} · unassigned: ${reason}`,
      });
      if (pm) {
        await this.mailEach(
          clientId,
          t,
          [pm],
          `[Assignment Required] - ${t.ticketNumber}`,
          {
            intro: `The following support ticket${company?.name ? ` from ${company.name}` : ''} has no agent assigned, as ${reason}.\n` +
              'As the project manager for this client\'s product, please assign an agent so that work can begin within the defined SLA.',
            fields: ['number', 'subject', 'requestedBy', 'client', 'product', 'category', 'priority', 'status', 'createdDate', 'dueDate'],
            description: true,
            outro: 'Please open the ticket, select an agent in the Assigned agent field and save. The requester will be informed once an agent is assigned.',
            linkLabel: 'Assign Ticket',
          },
          `the unassigned alert for ${t.ticketNumber}`,
        );
      }
    } catch (err) {
      this.logger.error(`Failed to alert the project manager of unassigned ${t.ticketNumber}`, err instanceof Error ? err.stack : String(err));
    }
  }

  /**
   * The (client, product) pairs this user is project manager of — what lets them
   * open the tickets they are belled about, though they hold none of them.
   */
  private async managedProducts(clientId: string, userId: string) {
    return this.prisma.customerCompanyProduct.findMany({
      where: { productManagerId: userId, customerCompany: { clientId } },
      select: { customerCompanyId: true, productId: true },
    });
  }

  /**
   * The client asks to reopen a resolved or closed ticket. Nothing about the
   * ticket changes — it stays closed until `approveReopenRequest`. Open to the
   * employee who raised it and their company admin (`findOne` already limits an
   * employee to their own tickets; `CustomerContactGuard` keeps staff out).
   */
  async requestReopen(id: string, clientId: string, dto: { reason?: string }, actorId: string, viewer: TicketViewer) {
    const ticket = await this.findOne(id, clientId, viewer);
    // Who asks: the client on their own ticket, or a non-Admin member of staff
    // on an internal one (an Admin reopens an internal ticket directly).
    if (ticket.customerCompanyId) {
      if (!isCustomerSide(viewer)) throw new ForbiddenException('Only the client can ask to reopen their own ticket');
    } else {
      if (isCustomerSide(viewer)) throw new ForbiddenException('Only the client can ask to reopen their own ticket');
      if (isAdmin(viewer)) throw new BadRequestException('As an Admin you can reopen this ticket directly');
    }
    // Read the live status, not the `resolvedAt` stamp: staff moving a Resolved
    // ticket back to In Progress leaves the stamp behind, and a request on a
    // ticket that is already being worked would burn one of its reopens.
    const liveLabel = await this.statusLabel(clientId, ticket.ticketStatus);
    if (!ticket.resolvedAt || (liveLabel !== 'resolved' && liveLabel !== 'closed')) {
      throw new BadRequestException('Only a resolved or closed ticket can be reopened');
    }
    if (ticket.reopenRequestStatus === 'PENDING') {
      throw new BadRequestException('A reopen request for this ticket is already waiting for approval');
    }
    const window = await this.reopenWindow(clientId, ticket.resolvedAt, ticket.reopenedCount);
    if (!window.windowOpen) {
      throw new BadRequestException(
        `This ticket was resolved more than ${window.windowDays} days ago and can no longer be reopened. Please create a new ticket instead.`,
      );
    }
    this.assertReopensLeft(window);
    const reason = dto?.reason?.trim();
    if (!reason) throw new BadRequestException('Tell us why this ticket needs to be reopened');

    const approverId = await this.reopenApproverFor(clientId, ticket);
    const updated = await this.prisma.ticket.update({
      where: { id },
      data: {
        reopenRequestStatus: 'PENDING',
        reopenRequestReason: reason,
        reopenRequestedAt: new Date(),
        reopenRequestedById: actorId,
        reopenApproverUserId: approverId,
        reopenDecidedAt: null,
        reopenDecidedById: null,
        reopenDecisionNote: null,
        updatedBy: actorId,
      },
    });
    const approver = approverId
      ? await this.prisma.user.findUnique({ where: { id: approverId }, select: { id: true, username: true, name: true, email: true } })
      : null;
    await this.activity.log({
      ticketId: id,
      actorUserId: actorId,
      type: 'REOPEN_REQUESTED',
      summary: `Reopen requested, for ${approver ? `${displayName(approver)} (project manager)` : 'admin'} approval: ${reason}`,
      meta: { reason, approverUserId: approverId },
    });

    // The decider hears about it: the project manager, or every Admin when
    // there is none. Admins with a project manager in place still find it in
    // their Awaiting approval list, but are not pinged for a call that isn't theirs.
    try {
      const [requester, company] = await Promise.all([
        this.prisma.user.findUnique({ where: { id: actorId }, select: { username: true, name: true } }),
        ticket.customerCompanyId
          ? this.prisma.customerCompany.findUnique({ where: { id: ticket.customerCompanyId }, select: { name: true } })
          : null,
      ]);
      const deciders = approver ? [approver] : await this.tenantAdmins(clientId);
      const fallback = ticket.customerCompanyId ? 'The client' : 'A member of staff';
      const who = `${requester ? displayName(requester) : fallback}${company ? ` (${company.name})` : ''}`;
      await this.notifications.notifyMany(deciders.map((d) => d.id), {
        clientId, type: 'TICKET_REOPEN_REQUESTED', ticketId: id,
        title: `Reopen approval needed · ${ticket.ticketNumber}`,
        body: `${who} asked to reopen ${ticket.subject}. Reason: ${reason}`,
      });
      await this.mailEach(
        clientId,
        ticket,
        deciders,
        `[Reopen Request] - ${ticket.ticketNumber}`,
        {
          intro: `${who} has requested to reopen the following ticket.\nThe ticket remains closed until the request is approved.`,
          fields: ['number', 'subject', 'requestedBy', 'client', 'priority', { key: 'status', label: 'Current Status' }, 'assignedAgent', 'resolvedDate'],
          resolution: 'Previous Resolution',
          sections: [{ title: 'Reason for Reopening', body: reason }],
          outro: 'Please review the previous resolution and the reason given, then approve or reject the request under Awaiting approval on the ticket list.',
          linkLabel: 'Review Request',
        },
        `the reopen request for ${ticket.ticketNumber}`,
      );
    } catch (err) {
      this.logger.error(`Failed to notify the reopen request for ${ticket.ticketNumber}`, err instanceof Error ? err.stack : String(err));
    }
    return updated;
  }

  /** The client takes back a reopen request nobody has decided yet. */
  async withdrawReopenRequest(id: string, clientId: string, actorId: string, viewer: TicketViewer) {
    const ticket = await this.findOne(id, clientId, viewer);
    const ownInternalRequest = !ticket.customerCompanyId && ticket.reopenRequestedById === actorId;
    if (!isCustomerSide(viewer) && !ownInternalRequest) {
      throw new ForbiddenException('Only whoever asked can withdraw this reopen request');
    }
    if (ticket.reopenRequestStatus !== 'PENDING') {
      throw new BadRequestException('There is no reopen request waiting on this ticket');
    }
    const updated = await this.prisma.ticket.update({
      where: { id },
      data: { reopenRequestStatus: 'WITHDRAWN', reopenDecidedAt: new Date(), reopenDecidedById: actorId, updatedBy: actorId },
    });
    await this.activity.log({ ticketId: id, actorUserId: actorId, type: 'REOPEN_WITHDRAWN', summary: 'Reopen request withdrawn' });
    // Take it off the decider's plate — a bell is enough for a non-event.
    const deciders = ticket.reopenApproverUserId ? [{ id: ticket.reopenApproverUserId }] : await this.tenantAdmins(clientId);
    await this.notifications
      .notifyMany(deciders.map((d) => d.id), {
        clientId, type: 'TICKET_REOPEN_WITHDRAWN', ticketId: id,
        title: `Reopen request withdrawn · ${ticket.ticketNumber}`,
        body: `${ticket.customerCompanyId ? 'The client' : 'The requester'} no longer needs ${ticket.subject} reopened.`,
      })
      .catch((err) => this.logger.error('Failed to notify a withdrawn reopen request', err instanceof Error ? err.stack : String(err)));
    return updated;
  }

  /** The named project manager, or any tenant Admin, decides a reopen request. */
  private assertMayDecideReopen(ticket: { reopenRequestStatus: string; reopenApproverUserId: string | null }, viewer: TicketViewer) {
    if (ticket.reopenRequestStatus !== 'PENDING') {
      throw new BadRequestException('There is no reopen request waiting on this ticket');
    }
    if (!isAdmin(viewer) && ticket.reopenApproverUserId !== viewer.id) {
      throw new ForbiddenException('Only the project manager for this client product, or an Admin, can decide this request');
    }
  }

  async approveReopenRequest(id: string, clientId: string, actorId: string, viewer: TicketViewer) {
    const ticket = await this.findOne(id, clientId, viewer);
    this.assertMayDecideReopen(ticket, viewer);
    // The limit is checked again here: an Admin may have lowered it while the
    // request sat pending. The decider rejects it instead.
    if (ticket.resolvedAt && ['resolved', 'closed'].includes(await this.statusLabel(clientId, ticket.ticketStatus))) {
      this.assertReopensLeft(await this.reopenWindow(clientId, ticket.resolvedAt, ticket.reopenedCount));
    }
    const reason = ticket.reopenRequestReason ?? 'Reopen requested';
    const decided = { reopenRequestStatus: 'APPROVED', reopenDecidedAt: new Date(), reopenDecidedById: actorId };
    await this.activity.log({ ticketId: id, actorUserId: actorId, type: 'REOPEN_APPROVED', summary: 'Reopen request approved' });
    // A ticket someone already moved out of Resolved/Closed needs no reopening —
    // the request is simply recorded as approved, and no reopen is counted.
    const liveLabel = await this.statusLabel(clientId, ticket.ticketStatus);
    const stillSettled = !!ticket.resolvedAt && (liveLabel === 'resolved' || liveLabel === 'closed');
    const updated = stillSettled
      ? await this.applyReopen(ticket, clientId, reason, ticket.reopenRequestedById ?? actorId, actorId, decided)
      : await this.prisma.ticket.update({ where: { id }, data: { ...decided, updatedBy: actorId } });
    await this.notifyReopenDecision(clientId, ticket, 'APPROVED', actorId, null);
    return updated;
  }

  async rejectReopenRequest(id: string, clientId: string, dto: { reason?: string }, actorId: string, viewer: TicketViewer) {
    const ticket = await this.findOne(id, clientId, viewer);
    this.assertMayDecideReopen(ticket, viewer);
    const note = dto?.reason?.trim();
    if (!note) throw new BadRequestException('Say why the reopen request is rejected — whoever asked sees this');
    const updated = await this.prisma.ticket.update({
      where: { id },
      data: {
        reopenRequestStatus: 'REJECTED', reopenDecidedAt: new Date(), reopenDecidedById: actorId,
        reopenDecisionNote: note, updatedBy: actorId,
      },
    });
    await this.activity.log({
      ticketId: id, actorUserId: actorId, type: 'REOPEN_REJECTED',
      summary: `Reopen request rejected: ${note}`, meta: { reason: note },
    });
    await this.notifyReopenDecision(clientId, ticket, 'REJECTED', actorId, note);
    return updated;
  }

  /**
   * Tell the client who asked how their reopen request was decided (bell and
   * email). On approval the assigned agent also gets an email of their own — the
   * bells to agents and Admins are `applyReopen`'s. Never throws.
   */
  private async notifyReopenDecision(
    clientId: string,
    ticket: {
      id: string; ticketNumber: string; subject: string; reopenRequestedById: string | null;
      reopenRequestReason: string | null; technicians: { user: { id: string } }[];
      customerCompanyId: string | null; ticketStatus: string;
    },
    decision: 'APPROVED' | 'REJECTED',
    actorId: string,
    note: string | null,
  ) {
    const approved = decision === 'APPROVED';
    try {
      const [requester, decider] = await Promise.all([
        ticket.reopenRequestedById
          ? this.prisma.user.findUnique({ where: { id: ticket.reopenRequestedById }, select: { id: true, username: true, name: true, email: true } })
          : null,
        this.prisma.user.findUnique({ where: { id: actorId }, select: { username: true, name: true } }),
      ]);
      const by = decider ? displayName(decider) : 'your provider';
      if (requester) {
        await this.notifications
          .notify({
            clientId, userId: requester.id, type: approved ? 'TICKET_REOPEN_APPROVED' : 'TICKET_REOPEN_REJECTED', ticketId: ticket.id,
            title: `Reopen request ${approved ? 'approved' : 'not approved'} · ${ticket.ticketNumber}`,
            body: approved ? `${by} approved it. The ticket is open again.` : `${by}: ${note ?? ''}`,
          })
          .catch((err) => this.logger.error('Failed to bell the reopen decision', err instanceof Error ? err.stack : String(err)));
        await this.mailEach(
          clientId,
          ticket,
          [requester],
          approved
            ? `[Reopen Approved] - ${ticket.ticketNumber}`
            : `[Reopen Not Approved] - ${ticket.ticketNumber}`,
          approved
            ? {
                intro: `Your request to reopen the following ticket has been approved by ${by}.\n` +
                  'The ticket is open again and our support team will continue working on it.',
                fields: ['number', 'subject', 'priority', 'status', 'assignedAgent', 'assignedTeam'],
                outro: 'Our team will keep you informed about further progress.',
                thanks: 'Thank you for your patience.',
              }
            : {
                intro: `Your request to reopen the following ticket has been reviewed by ${by} and was not approved.\n` +
                  'The ticket therefore remains closed.',
                fields: ['number', 'subject', 'priority', 'status', 'assignedAgent', 'closedDate'],
                sections: [{ title: 'Remarks', body: note ?? '' }],
                outro: 'If the issue still needs attention, please raise a new support ticket through the portal and refer to this ticket number where relevant.',
              },
          `the reopen decision for ${ticket.ticketNumber}`,
        );
      }
    } catch (err) {
      this.logger.error(`Failed to notify the reopen decision for ${ticket.ticketNumber}`, err instanceof Error ? err.stack : String(err));
    }
  }

  // ---- Creation-approval gate (Admin approves/rejects customer tickets) ----

  async approve(id: string, clientId: string, actorId: string, viewer: TicketViewer) {
    const ticket = await this.findOne(id, clientId, viewer);
    if (ticket.approvalStatus !== 'PENDING') {
      throw new BadRequestException('Only tickets awaiting approval can be approved');
    }
    // The raiser and the requester hear of the approval from `notifyDecision`,
    // so 1. Created leaves the requester out rather than tell them twice.
    const updated = await this.openHeldTicket(ticket, clientId, actorId, 'Ticket approved', {
      lead: 'Your support request has been approved and registered in our service desk.',
      skipRoles: ['REQUESTOR'],
    });
    await this.notifyDecision(clientId, { ...updated, templateName: ticket.template?.name ?? 'Ticket' }, 'APPROVED');
    return updated;
  }

  /**
   * A held ticket's last approval makes it real work: default open status, SLA
   * clock started, the project manager belled, and — for a customer's ticket —
   * routed exactly as creation would have routed it. Shared by `approve` (the
   * provider's Admin) and `customerApprove` (a company admin, when the template
   * needs no provider approval). The caller tells the raiser.
   */
  private async openHeldTicket(
    ticket: Awaited<ReturnType<TicketsService['findOne']>>,
    clientId: string,
    actorId: string,
    summary: string,
    live: { lead: string; ackBody?: string; skipRoles?: PersonRole[] },
  ) {
    const id = ticket.id;
    const initial =
      (
        await this.prisma.picklistOption.findFirst({
          where: { clientId, listKey: 'ticketStatus', isActive: true },
          orderBy: { sortOrder: 'asc' },
        })
      )?.value ?? 'Open';
    const now = new Date();
    // The SLA clock starts now: a held ticket was created with its SLA hours but
    // no deadline, so the wait for a decision never counts against it. A
    // deadline someone typed on the form is left as they set it.
    const slaDue = ticket.slaHours && !ticket.dueDate ? new Date(now.getTime() + ticket.slaHours * 3600 * 1000) : null;
    const updated = await this.prisma.ticket.update({
      where: { id },
      data: {
        approvalStatus: 'APPROVED',
        approvedById: actorId,
        approvedAt: now,
        // Now a real, assignable ticket — move it to the default open status.
        ticketStatus: initial,
        statusChangedAt: now,
        ...(slaDue && { dueDate: slaDue, expectedResolutionDate: ticket.expectedResolutionDate ?? slaDue }),
        updatedBy: actorId,
      },
    });
    await this.activity.log({
      ticketId: id,
      actorUserId: actorId,
      type: 'APPROVED',
      summary,
    });
    // A customer's ticket is routed now, exactly as it would have been on
    // creation had it not needed approval. Staff-raised tickets never are.
    const raiser = ticket.createdBy
      ? await this.prisma.user.findUnique({ where: { id: ticket.createdBy }, select: { customerCompanyId: true } })
      : null;
    const routes = !!raiser?.customerCompanyId && ticket.technicians.length === 0;
    // Live now: routed if it is a client's, then 1. Created and the assignment.
    await this.goLive(clientId, { ...ticket, ...updated }, actorId, { routes, ...live });
    return updated;
  }

  async reject(
    id: string,
    clientId: string,
    dto: { reason?: string },
    actorId: string,
    viewer: TicketViewer,
  ) {
    const ticket = await this.findOne(id, clientId, viewer);
    if (ticket.approvalStatus !== 'PENDING') {
      throw new BadRequestException('Only tickets awaiting approval can be rejected');
    }
    const reason = dto.reason?.trim();
    if (!reason) {
      throw new BadRequestException('A rejection reason is required');
    }
    const updated = await this.prisma.ticket.update({
      where: { id },
      data: {
        approvalStatus: 'REJECTED',
        rejectionReason: reason,
        rejectedById: actorId,
        rejectedAt: new Date(),
        ticketStatus: 'Rejected',
        statusChangedAt: new Date(),
        updatedBy: actorId,
      },
    });
    await this.activity.log({
      ticketId: id,
      actorUserId: actorId,
      type: 'REJECTED',
      summary: 'Ticket request rejected',
      meta: { reason },
    });
    await this.notifyDecision(clientId, { ...updated, templateName: ticket.template?.name ?? 'Ticket' }, 'REJECTED');
    return updated;
  }

  /**
   * Tell whoever raised a held ticket how it was decided: a bell for the person
   * who raised it, and an email to them and to the requester named on the
   * ticket when that's someone else (an agent raising a change for a customer).
   * Each address is its own send, so a customer and a provider address never
   * share a `To:`.
   */
  private async notifyDecision(
    clientId: string,
    ticket: {
      id: string; ticketNumber: string; subject: string; templateName: string; createdBy: string | null;
      requestorEmail: string | null; requestorName: string | null; rejectionReason: string | null;
      slaHours: number | null; customerCompanyId: string | null;
    },
    decision: 'APPROVED' | 'REJECTED',
  ) {
    const approved = decision === 'APPROVED';
    const label = `${ticket.ticketNumber} · ${ticket.subject}`;
    try {
      const raiser = ticket.createdBy
        ? await this.prisma.user.findUnique({ where: { id: ticket.createdBy }, select: { id: true, username: true, name: true, email: true } })
        : null;
      if (raiser) {
        await this.notifications.notify({
          clientId, userId: raiser.id, type: approved ? 'TICKET_APPROVED' : 'TICKET_REJECTED', ticketId: ticket.id,
          title: `${ticket.ticketNumber} ${approved ? 'approved' : 'rejected'}`,
          body: approved
            ? `Your ${ticket.templateName} was approved. Its SLA has started.`
            : `Reason: ${ticket.rejectionReason ?? ''}`,
        });
      }

      const company = ticket.customerCompanyId
        ? await this.prisma.customerCompany.findUnique({ where: { id: ticket.customerCompanyId }, select: { name: true } })
        : null;
      const what = `Your ${ticket.templateName}${company ? ` for ${company.name}` : ''}`;
      // The raiser and, when someone else, the requester — one send each.
      await this.mailEach(
        clientId,
        ticket,
        [
          ...(raiser ? [{ email: raiser.email, name: displayName(raiser) }] : []),
          { email: ticket.requestorEmail, name: ticket.requestorName },
        ],
        approved
          ? `[Ticket Accepted] - ${ticket.ticketNumber}`
          : `[Ticket Not Approved] - ${ticket.ticketNumber}`,
        approved
          ? {
              // 4. Ticket Accepted — its SLA clock starts on this approval.
              ...MAIL.accepted(),
              intro: `${what} has been reviewed and accepted by our support team.\n` +
                'The ticket is now open and will be handled by the responsible support personnel; its SLA started on approval.',
            }
          : {
              intro: `${what} has been reviewed and was not approved.\nNo work will be carried out on this ticket.`,
              fields: ['number', 'subject', 'category', 'priority', 'status'],
              sections: [{ title: 'Reason', body: ticket.rejectionReason ?? '' }],
              outro: 'You may raise a new request with the required changes through the ticketing portal at any time.',
            },
        `the ${decision.toLowerCase()} notice for ${ticket.ticketNumber}`,
      );
    } catch (err) {
      this.logger.error(
        `Failed to send the ${decision.toLowerCase()} notice for ${ticket.ticketNumber}`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }

  // ---- Stage 1: customer company admin approves/rejects an employee ticket ----

  async customerApprove(id: string, clientId: string, actorId: string, viewer: TicketViewer) {
    const ticket = await this.findOne(id, clientId, viewer);
    if (ticket.approvalStatus !== 'PENDING_CUSTOMER') {
      throw new BadRequestException('Only tickets awaiting your approval can be approved');
    }
    const templateName = ticket.template?.name ?? 'Ticket';
    const approver = await this.prisma.user.findUnique({ where: { id: actorId }, select: { username: true, name: true } });
    const approverName = approver ? displayName(approver) : null;
    // A template that needs the provider's approval goes on to their Admin;
    // any other ticket was held only for this stage and opens now.
    const toProvider = !!ticket.template?.requiresApproval;
    let updated;
    if (toProvider) {
      updated = await this.prisma.ticket.update({
        where: { id },
        data: { approvalStatus: 'PENDING', updatedBy: actorId },
      });
      await this.activity.log({
        ticketId: id,
        actorUserId: actorId,
        type: 'CUSTOMER_APPROVED',
        summary: 'Approved by company admin — sent for provider approval',
      });
      // Now it is the provider's call: their Admins hear about it the way they
      // would have had the request been raised straight to them.
      await this.notifyApprovalRequested(clientId, ticket, templateName, ticket.createdBy, approverName);
    } else {
      await this.activity.log({
        ticketId: id,
        actorUserId: actorId,
        type: 'CUSTOMER_APPROVED',
        summary: 'Approved by company admin',
      });
      // Only now is it a ticket the provider has: 1. Created goes out — the
      // "received" bell and email the raiser did not get on raising it.
      updated = await this.openHeldTicket(ticket, clientId, actorId, 'Ticket opened on company admin approval', {
        lead: `${approverName ?? 'Your company admin'} has approved your request, and it has been successfully registered in our service desk.`,
        ackBody: `${approverName ?? 'Your company admin'} approved it. We've received your ticket ${ticket.ticketNumber} and will get back to you shortly.`,
      });
    }
    // A change request goes on to the provider: the employee learns it has moved on.
    if (toProvider && ticket.createdBy && ticket.createdBy !== actorId) {
      const raiser = await this.prisma.user.findUnique({
        where: { id: ticket.createdBy }, select: { id: true, username: true, name: true, email: true },
      });
      if (raiser) {
        await this.notifications
          .notify({
            clientId, userId: raiser.id, type: 'TICKET_CUSTOMER_APPROVED', ticketId: id,
            title: `${ticket.ticketNumber} sent to your provider`,
            body: `${approverName ?? 'Your company admin'} approved your ${templateName}. It now waits for your provider's approval.`,
          })
          .catch((err) => this.logger.error('Failed to bell the customer approval', err instanceof Error ? err.stack : String(err)));
        await this.mailEach(
          clientId,
          ticket,
          [raiser],
          `[Sent for Approval] - ${ticket.ticketNumber}`,
          {
            intro: `${approverName ?? 'Your company admin'} has approved your ${templateName}, and it has been sent to your service provider for approval.\n` +
              'You will be informed as soon as it is decided.',
            fields: ['number', 'subject', 'category', 'priority', 'status', 'createdDate'],
            outro: 'You can track the status of your request through the ticketing portal.',
            thanks: 'Thank you for your patience.',
          },
          `the customer approval notice for ${ticket.ticketNumber}`,
        );
      }
    }
    return updated;
  }

  async customerReject(
    id: string,
    clientId: string,
    dto: { reason?: string },
    actorId: string,
    viewer: TicketViewer,
  ) {
    const ticket = await this.findOne(id, clientId, viewer);
    if (ticket.approvalStatus !== 'PENDING_CUSTOMER') {
      throw new BadRequestException('Only tickets awaiting your approval can be rejected');
    }
    const reason = dto.reason?.trim();
    if (!reason) {
      throw new BadRequestException('A rejection reason is required');
    }
    const updated = await this.prisma.ticket.update({
      where: { id },
      data: {
        approvalStatus: 'REJECTED',
        rejectionReason: reason,
        rejectedById: actorId,
        rejectedAt: new Date(),
        ticketStatus: 'Rejected',
        statusChangedAt: new Date(),
        updatedBy: actorId,
      },
    });
    await this.activity.log({
      ticketId: id,
      actorUserId: actorId,
      type: 'REJECTED',
      summary: 'Ticket rejected by company admin',
      meta: { reason },
    });
    if (ticket.createdBy && ticket.createdBy !== actorId) {
      await this.notifications
        .notify({
          clientId, userId: ticket.createdBy, type: 'TICKET_REJECTED', ticketId: id,
          title: `${ticket.ticketNumber} not approved`,
          body: `Your company admin did not approve it. Reason: ${reason}`,
        })
        .catch((err) => this.logger.error('Failed to bell the customer rejection', err instanceof Error ? err.stack : String(err)));
    }
    await this.notifyRejection(updated, clientId);
    return updated;
  }

  /** 8. Ticket Resolved. Who hears of it is the Email Configuration; this says it per audience. */
  private async notifyResolved(ticket: NotifyTicket, clientId: string, actorId: string) {
    const n = ticket.ticketNumber;
    const label = `${n} — ${ticket.subject}`;
    await this.fireEvent(clientId, 'TICKET_RESOLVED', {
      ticket, actorId,
      mail: {
        client: {
          subject: `Your Ticket – ${n} Resolved`,
          content: {
            intro: 'We are pleased to inform you that your support request has been resolved.\n' +
              'Please review the resolution details below and confirm whether the issue has been addressed satisfactorily.',
            fields: ['number', 'subject', 'priority', 'status', 'assignedAgent', 'resolvedDate'],
            resolution: 'Resolution Details',
            outro: 'If the issue persists, you may request to reopen the ticket through the ticketing portal within the permitted reopening period.\n' +
              'If no further action is required, the ticket will be closed as per the system closure policy.',
            linkLabel: 'Review Ticket',
            thanks: 'Thank you for your cooperation.',
          },
        },
      },
      bell: {
        client: {
          type: 'TICKET_RESOLVED', title: 'Ticket resolved',
          body: `${label} has been resolved. Please review and acknowledge it to close the ticket.`,
        },
        PROJECT_MANAGER: { type: 'PM_TICKET_RESOLVED', title: 'Ticket resolved', body: label },
        staff: { type: 'TICKET_RESOLVED', title: 'Ticket resolved', body: label },
        agent: { type: 'TICKET_RESOLVED', title: 'Ticket resolved', body: label },
      },
    });
  }

  /** Best-effort email to the requestor with the rejection reason. Never throws. */
  private async notifyRejection(
    ticket: { id: string; ticketNumber: string; subject: string; requestorEmail: string | null; requestorName: string | null; rejectionReason: string | null },
    clientId: string,
  ) {
    try {
      if (!ticket.requestorEmail) return;
      await this.mailEach(
        clientId,
        ticket,
        [{ email: ticket.requestorEmail, name: ticket.requestorName }],
        `[Ticket Not Approved] - ${ticket.ticketNumber}`,
        {
          intro: 'Your support request has been reviewed by your company admin and was not approved.\nNo work will be carried out on this ticket.',
          fields: ['number', 'subject', 'category', 'priority', 'status', 'createdDate'],
          sections: [{ title: 'Reason', body: ticket.rejectionReason ?? '' }],
          outro: 'You may raise a new request with the required changes through the ticketing portal at any time.',
        },
        `the rejection email for ${ticket.ticketNumber}`,
      );
    } catch (err) {
      this.logger.error(
        `Failed to send rejection email for ${ticket.ticketNumber}`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }

  async addAttachments(
    id: string,
    clientId: string,
    files: Express.Multer.File[],
    actorId: string,
    viewer: TicketViewer,
  ) {
    await this.findOne(id, clientId, viewer);
    if (!files?.length) return [];

    await this.prisma.ticketAttachment.createMany({
      data: files.map((file) => ({
        ticketId: id,
        fileName: file.originalname,
        filePath: `/uploads/tickets/${file.filename}`,
        mimeType: file.mimetype,
        size: file.size,
        uploadedBy: actorId,
      })),
    });

    return this.prisma.ticketAttachment.findMany({ where: { ticketId: id } });
  }

  // ---- Worklog / support-hours time tracking --------------------------------

  /**
   * The support-hours pool this ticket's logged time is drawn from, so the Time
   * tab can show what an entry spends. Worklog hours are charged to the customer's
   * pool for the *ticket's product* — that product's own warranty/AMC pool when
   * the customer is on `contractScope = PRODUCT`, the shared customer contract
   * otherwise — by the same `productSupportHours` maths the product screens and
   * the create-ticket form read, so every screen agrees on one figure.
   *
   * `scope: null` means the time lands in no pool at all: either the ticket has no
   * customer, or it carries no product while the customer is on per-product
   * coverage. The UI says so rather than silently showing nothing.
   */
  async ticketSupportHours(id: string, clientId: string, viewer: TicketViewer) {
    const ticket = await this.findOne(id, clientId, viewer);
    const identity = {
      productId: ticket.productId ?? null,
      productName: (ticket as { productName?: string | null }).productName ?? null,
    };
    const unmapped = { hasPool: false, unlimited: false, allocated: null, used: 0, left: null };
    if (!ticket.customerCompanyId) return { ...identity, ...unmapped, scope: null };
    const pool = await this.customerProducts.productSupportHours(
      clientId,
      ticket.customerCompanyId,
      ticket.productId ?? '',
    );
    return { ...identity, ...pool, scope: (pool as { scope?: string }).scope ?? null };
  }

  async listWorklogs(id: string, clientId: string, viewer: TicketViewer) {
    await this.findOne(id, clientId, viewer);
    return this.prisma.ticketWorklog.findMany({
      where: { ticketId: id },
      orderBy: { workDate: 'desc' },
    });
  }

  /**
   * Create one worklog row and roll its hours into the customer's pool.
   *
   * `addWorklog` — Log time on the Tasks tab — is now the only door in. A task's
   * own hours are an audit of how long it stood in progress and are deliberately
   * never booked here, or the same work would be charged twice.
   *
   * The allowance check is deliberately *not* in here, so a caller with a delta
   * to test rather than a fresh figure can assert its own before writing.
   */
  private async writeWorklog(
    clientId: string,
    ticket: WorklogTicket,
    p: {
      workerId: string; hours: number; workDate: Date; note: string | null;
      taskId?: string | null; taskTitle?: string | null;
    },
  ) {
    const worker = await this.prisma.user.findUnique({
      where: { id: p.workerId },
      select: { username: true, name: true },
    });
    const worklog = await this.prisma.ticketWorklog.create({
      data: {
        clientId,
        ticketId: ticket.id,
        userId: p.workerId,
        consultantName: worker ? displayName(worker) : null,
        workDate: p.workDate,
        hours: p.hours,
        note: p.note,
        taskId: p.taskId ?? null,
        // Denormalised beside the id: the link is SetNull, so the entry must keep
        // saying what the time was for once the task itself is gone.
        taskTitle: p.taskTitle ?? null,
        createdBy: p.workerId,
      },
    });

    // A MONTHLY pool tracks usage in its ledger; no-op for FULL_AMC / unlimited.
    await this.customerProducts.adjustLoggedHours(
      clientId, ticket.customerCompanyId, ticket.productId ?? null, p.hours, worklog.workDate,
    );
    // Rolling the new hours into the pool may trip the "hours low" alert. Routed
    // through the customer's own coverage scope so the threshold is measured on
    // the pool that actually governs this ticket, not a company-wide total.
    await this.customerProducts.alertOnLoggedHours(
      clientId,
      ticket.customerCompanyId,
      ticket.productId ?? null,
    );
    return worklog;
  }

  /**
   * Delete one worklog row and reverse the ledger draw-down for the month the work
   * was logged in. Returns false when the row is already gone — the task timer
   * tolerates that (the entry may have been removed from the time list), while
   * `deleteWorklog` turns it into a 404.
   */
  private async dropWorklog(clientId: string, ticket: WorklogTicket, worklogId: string) {
    const wl = await this.prisma.ticketWorklog.findFirst({
      where: { id: worklogId, ticketId: ticket.id },
    });
    if (!wl) return false;
    await this.prisma.ticketWorklog.delete({ where: { id: worklogId } });
    await this.customerProducts.adjustLoggedHours(
      clientId, ticket.customerCompanyId, ticket.productId ?? null, -Number(wl.hours), wl.workDate,
    );
    return true;
  }

  async addWorklog(id: string, dto: CreateWorklogDto, clientId: string, actorId: string, viewer: TicketViewer) {
    const ticket = await this.findOne(id, clientId, viewer);
    const hours = Number(dto.hours);
    if (!(hours > 0)) throw new BadRequestException('Hours must be greater than zero');

    // The linked task is optional, but it has to be one of this ticket's — scoped
    // to the ticket so an id from another one can't be attached to these hours.
    const task = dto.taskId
      ? await this.prisma.ticketTask.findFirst({
          where: { id: dto.taskId, ticketId: id },
          select: { id: true, title: true },
        })
      : null;
    if (dto.taskId && !task) throw new NotFoundException('Task not found on this ticket');

    // The Resolution tab holds one entry (notes + hours) per resolution round:
    // a reopen starts a new round, the earlier entries stay as history. Task
    // hours are booked against their tasks and are not limited.
    if (!task) {
      await this.assertTicketOpen(ticket, clientId, 'logging time');
      const existing = await this.prisma.ticketWorklog.count({
        where: { ticketId: id, taskId: null, ...this.currentRound(ticket) },
      });
      if (existing > 0) {
        throw new BadRequestException('This ticket already has a resolution entry — delete it to log again');
      }
    }

    // Refuse hours that would break the customer's support-hours allowance before
    // anything is written (unless the pool allows excess). Throws on a violation.
    await this.customerProducts.assertHoursWithinAllowance(
      clientId, ticket.customerCompanyId, ticket.productId ?? null, hours,
    );

    return this.writeWorklog(clientId, ticket, {
      workerId: actorId,
      hours,
      workDate: dto.workDate ? new Date(dto.workDate) : new Date(),
      note: dto.note?.trim() || null,
      taskId: task?.id ?? null,
      taskTitle: task?.title ?? null,
    });
  }

  /**
   * Drop every hour booked against one task, reversing each from the support-hours
   * ledger, and report what was removed. Called when the task itself is deleted:
   * the hours go with the work they were logged against, and the customer's pool
   * is credited back.
   *
   * Deliberately not `onDelete: Cascade` on the FK — the database would delete the
   * rows without ever telling the ledger, silently leaving a `MONTHLY` pool
   * showing hours it no longer holds any entry for. The link stays `SetNull` so
   * any other path that removes a task keeps the entries (and their denormalised
   * `taskTitle`) rather than losing them unreversed; this method is the one door
   * that means "these hours were logged in error too".
   */
  async dropWorklogsForTask(ticketId: string, taskId: string, clientId: string, viewer: TicketViewer) {
    const ticket = await this.findOne(ticketId, clientId, viewer);
    const logs = await this.prisma.ticketWorklog.findMany({
      where: { ticketId, taskId },
      select: { id: true, hours: true },
    });
    let hours = 0;
    for (const wl of logs) {
      // Through `dropWorklog`, so the ledger reversal can never drift from the
      // one the time list's own delete performs.
      if (await this.dropWorklog(clientId, ticket, wl.id)) hours += Number(wl.hours);
    }
    return { count: logs.length, hours };
  }

  /**
   * Correct a Resolution-tab entry (notes and/or hours) — allowed in every state
   * but Closed, Resolved included, so a typo can still be fixed before the client
   * signs off. Hours move the customer's pool by the difference alone: an
   * increase passes the allowance gate first, and a MONTHLY ledger is adjusted
   * by the delta. Editing the current round's entry on a resolved ticket keeps
   * `Ticket.resolution` — the text the client acknowledges — in step with it.
   */
  async updateWorklog(
    id: string, worklogId: string, dto: UpdateWorklogDto, clientId: string, actorId: string, viewer: TicketViewer,
  ) {
    const ticket = await this.findOne(id, clientId, viewer);
    if ((await this.statusLabel(clientId, ticket.ticketStatus)) === 'closed') {
      throw new BadRequestException('This ticket is closed — its entries can no longer be edited');
    }
    const wl = await this.prisma.ticketWorklog.findFirst({ where: { id: worklogId, ticketId: id } });
    if (!wl) throw new NotFoundException('Worklog not found');
    // Task hours are corrected on their task, not here.
    if (wl.taskId) throw new BadRequestException('Time booked on a task is edited on that task');

    const note = dto.note !== undefined ? dto.note.trim() : (wl.note ?? '');
    if (!note) throw new BadRequestException('Resolution notes cannot be empty');
    const hours = dto.hours !== undefined ? Number(dto.hours) : Number(wl.hours);
    if (!(hours > 0)) throw new BadRequestException('Hours must be greater than zero');
    const delta = hours - Number(wl.hours);

    if (delta > 0) {
      await this.customerProducts.assertHoursWithinAllowance(
        clientId, ticket.customerCompanyId, ticket.productId ?? null, delta,
      );
    }
    const updated = await this.prisma.ticketWorklog.update({
      where: { id: worklogId },
      data: { note, hours },
    });
    if (delta !== 0) {
      await this.customerProducts.adjustLoggedHours(
        clientId, ticket.customerCompanyId, ticket.productId ?? null, delta, wl.workDate,
      );
      if (delta > 0) {
        await this.customerProducts.alertOnLoggedHours(clientId, ticket.customerCompanyId, ticket.productId ?? null);
      }
    }
    const currentRound = !ticket.reopenedAt || wl.createdAt > ticket.reopenedAt;
    if (ticket.resolvedAt && currentRound && note !== (ticket.resolution ?? '')) {
      await this.prisma.ticket.update({ where: { id }, data: { resolution: note, updatedBy: actorId } });
    }
    const changes = [
      ...(delta !== 0 ? [`hours ${Number(wl.hours)} → ${hours}`] : []),
      ...(note !== (wl.note ?? '') ? ['notes'] : []),
    ];
    if (changes.length) {
      await this.activity.log({
        ticketId: id,
        actorUserId: actorId,
        type: 'WORKLOG_UPDATED',
        summary: `Resolution entry edited: ${changes.join(', ')}`,
      });
    }
    return updated;
  }

  /** Worklogs written since the last reopen — the round now being resolved. */
  private currentRound(ticket: { reopenedAt: Date | null }): Prisma.TicketWorklogWhereInput {
    return ticket.reopenedAt ? { createdAt: { gt: ticket.reopenedAt } } : {};
  }

  async deleteWorklog(id: string, worklogId: string, clientId: string, viewer: TicketViewer) {
    const ticket = await this.findOne(id, clientId, viewer);
    // A resolution entry is a record once its round is resolved: locked while the
    // ticket is resolved, and an earlier round's entry stays locked after a reopen
    // — deleting it would hand worked hours back to the client's pool.
    const wl = await this.prisma.ticketWorklog.findFirst({
      where: { id: worklogId, ticketId: id },
      select: { taskId: true, createdAt: true },
    });
    if (wl && !wl.taskId) {
      if (ticket.resolvedAt) {
        throw new BadRequestException('This ticket is resolved — its resolution entry can no longer be deleted');
      }
      if (ticket.reopenedAt && wl.createdAt <= ticket.reopenedAt) {
        throw new BadRequestException('This entry belongs to an earlier resolution and can no longer be deleted');
      }
    }
    if (!(await this.dropWorklog(clientId, ticket, worklogId))) {
      throw new NotFoundException('Worklog not found');
    }
    return { message: 'Worklog removed' };
  }

}
