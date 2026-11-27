import { ConflictException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * Refuses to delete a user who is still named on live work. Many of these
 * links are plain id columns with no foreign key (project manager, task
 * assignees, client visits, CAB approver), and the ones that do have one
 * mostly cascade or null out — so a delete would silently strip a ticket of
 * its agent, wipe an employee's asset history or leave ids pointing at nobody.
 * The fix is to reassign, or to deactivate the user, which keeps every link.
 *
 * Authorship columns (createdBy, comment/activity authors) are deliberately not
 * checked: they are history, and almost every user would be undeletable.
 */
/**
 * Tickets this user raised that are neither Closed nor Rejected. A finished
 * ticket no longer blocks a delete (client request): it keeps the requester's name and email as
 * text, and every reader of `requestorUserId` already falls back to those when
 * the user is gone. "Closed" is read off the tenant's own `ticketStatus` labels,
 * like every other status check, never a stored stamp.
 */
async function openTicketsRaised(prisma: PrismaService, userId: string): Promise<Link> {
  const raised = await prisma.ticket.findMany({
    where: { requestorUserId: userId },
    select: { clientId: true, ticketStatus: true, ticketNumber: true },
  });
  if (!raised.length) return { n: 0 };
  const options = await prisma.picklistOption.findMany({
    where: { clientId: { in: [...new Set(raised.map((t) => t.clientId))] }, listKey: 'ticketStatus' },
    select: { clientId: true, value: true, label: true },
  });
  const finished = new Set(
    options
      .filter((o) => ['closed', 'rejected'].includes((o.label ?? o.value).trim().toLowerCase()))
      .map((o) => `${o.clientId}|${o.value}`),
  );
  // The literals always count too: reject() writes 'Rejected' directly rather
  // than resolving the picklist, as settledStatusValues notes.
  const open = raised.filter(
    (t) => !['Closed', 'Rejected'].includes(t.ticketStatus) && !finished.has(`${t.clientId}|${t.ticketStatus}`),
  );
  return { n: open.length, refs: open.map((t) => t.ticketNumber).sort() };
}

/** A blocking link: how many, and — for ticket links — which tickets, so the admin knows where to go. */
type Link = { n: number; refs?: string[] };
const count = (p: Promise<number>): Promise<Link> => p.then((n) => ({ n }));
/** Rows that each name a ticket: counted, and listed by ticket number (deduplicated). */
const onTickets = (p: Promise<{ ticket: { ticketNumber: string } }[]>): Promise<Link> =>
  p.then((rows) => ({ n: rows.length, refs: [...new Set(rows.map((r) => r.ticket.ticketNumber))].sort() }));
const ticketNo = { select: { ticket: { select: { ticketNumber: true } } } } as const;
/** "TCK-000025, TCK-000031" — the first five, then how many more. */
const refList = (refs: string[]) =>
  refs.length > 5 ? `${refs.slice(0, 5).join(', ')} +${refs.length - 5} more` : refs.join(', ');

export async function assertUserDeletable(prisma: PrismaService, userId: string, displayName: string) {
  // Ticket links name their tickets (client request), so the admin knows which
  // to reassign; everything else is a count.
  const checks: [[string, string], Promise<Link>][] = [
    [['assigned ticket', 'assigned tickets'], onTickets(prisma.ticketTechnician.findMany({ where: { userId }, ...ticketNo }))],
    [['open ticket raised by them', 'open tickets raised by them'], openTicketsRaised(prisma, userId)],
    [['ticket task', 'ticket tasks'], onTickets(prisma.ticketTask.findMany({ where: { assigneeUserId: userId }, ...ticketNo }))],
    [['ticket approval', 'ticket approvals'], onTickets(prisma.ticketApproval.findMany({ where: { approverUserId: userId }, ...ticketNo }))],
    [['pending ticket reopen request', 'pending ticket reopen requests'], prisma.ticket
      .findMany({ where: { reopenApproverUserId: userId, reopenRequestStatus: 'PENDING' }, select: { ticketNumber: true } })
      .then((rows) => ({ n: rows.length, refs: rows.map((r) => r.ticketNumber).sort() }))],
    [['ticket time entry', 'ticket time entries'], onTickets(prisma.ticketWorklog.findMany({ where: { userId }, ...ticketNo }))],
    [['project they manage', 'projects they manage'], count(prisma.project.count({ where: { managerUserId: userId } }))],
    [['project resource', 'project resources'], count(prisma.projectResource.count({ where: { userId } }))],
    [['project task', 'project tasks'], count(prisma.projectTask.count({ where: { assigneeUserId: userId } }))],
    [['project timesheet entry', 'project timesheet entries'], count(prisma.projectTimesheet.count({ where: { userId } }))],
    [['client visit', 'client visits'], count(prisma.clientVisit.count({ where: { consultantId: userId } }))],
    [['change request as CAB approver', 'change requests as CAB approver'], count(prisma.changeRequest.count({ where: { changeApproverUserId: userId } }))],
    [['asset allocation', 'asset allocations'], count(prisma.assetAllocation.count({ where: { employeeUserId: userId } }))],
    [['client consultant assignment', 'client consultant assignments'], count(prisma.customerConsultant.count({ where: { userId } }))],
    [['product consultant list', 'product consultant lists'], count(prisma.productConsultant.count({ where: { userId } }))],
    [['module consultant list', 'module consultant lists'], count(prisma.moduleConsultant.count({ where: { userId } }))],
    [['client as account manager', 'clients as account manager'], count(prisma.customerCompany.count({ where: { accountManagerId: userId } }))],
    [['client product as project manager', 'client products as project manager'], count(prisma.customerCompanyProduct.count({ where: { productManagerId: userId } }))],
  ];
  const results = await Promise.all(checks.map(([, c]) => c));
  const links = checks
    .map(([[one, many]], i) => ({ ...results[i], one, many }))
    .filter((l) => l.n > 0)
    .map((l) => `${l.n} ${l.n === 1 ? l.one : l.many}${l.refs?.length ? ` (${refList(l.refs)})` : ''}`);
  if (links.length) {
    throw new ConflictException(
      `Cannot delete ${displayName}: still linked to ${links.join(', ')}. Reassign those first, or deactivate the user instead.`,
    );
  }
}
