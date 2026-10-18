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
export async function assertUserDeletable(prisma: PrismaService, userId: string, displayName: string) {
  const checks: [[string, string], Promise<number>][] = [
    [['assigned ticket', 'assigned tickets'], prisma.ticketTechnician.count({ where: { userId } })],
    [['ticket raised by them', 'tickets raised by them'], prisma.ticket.count({ where: { requestorUserId: userId } })],
    [['ticket task', 'ticket tasks'], prisma.ticketTask.count({ where: { assigneeUserId: userId } })],
    [['ticket approval', 'ticket approvals'], prisma.ticketApproval.count({ where: { approverUserId: userId } })],
    [['ticket time entry', 'ticket time entries'], prisma.ticketWorklog.count({ where: { userId } })],
    [['project they manage', 'projects they manage'], prisma.project.count({ where: { managerUserId: userId } })],
    [['project resource', 'project resources'], prisma.projectResource.count({ where: { userId } })],
    [['project task', 'project tasks'], prisma.projectTask.count({ where: { assigneeUserId: userId } })],
    [['project timesheet entry', 'project timesheet entries'], prisma.projectTimesheet.count({ where: { userId } })],
    [['client visit', 'client visits'], prisma.clientVisit.count({ where: { consultantId: userId } })],
    [['change request as CAB approver', 'change requests as CAB approver'], prisma.changeRequest.count({ where: { changeApproverUserId: userId } })],
    [['asset allocation', 'asset allocations'], prisma.assetAllocation.count({ where: { employeeUserId: userId } })],
    [['client consultant assignment', 'client consultant assignments'], prisma.customerConsultant.count({ where: { userId } })],
    [['product consultant list', 'product consultant lists'], prisma.productConsultant.count({ where: { userId } })],
    [['module consultant list', 'module consultant lists'], prisma.moduleConsultant.count({ where: { userId } })],
    [['client pool as excess-hours approver', 'client pools as excess-hours approver'], prisma.customerCompany.count({ where: { contractExcessApproverId: userId } })],
    [['product pool as excess-hours approver', 'product pools as excess-hours approver'], prisma.customerCompanyProduct.count({ where: { amcExcessApproverId: userId } })],
  ];
  const counts = await Promise.all(checks.map(([, c]) => c));
  const links = checks
    .map(([[one, many]], i) => ({ n: counts[i], one, many }))
    .filter((l) => l.n > 0)
    .map((l) => `${l.n} ${l.n === 1 ? l.one : l.many}`);
  if (links.length) {
    throw new ConflictException(
      `Cannot delete ${displayName}: still linked to ${links.join(', ')}. Reassign those first, or deactivate the user instead.`,
    );
  }
}
