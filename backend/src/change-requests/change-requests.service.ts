import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CrOptionsService } from './cr-options.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateChangeRequestDto, UpdateChangeRequestDto } from './dto/change-request.dto';
import { CHANGE_STAGES, CAB_STAGE, CAB_TYPES, stageIndex } from './change-stage';

type Actor = { id: string; username?: string; roles?: string[] };
type CustomerActor = { id: string; clientId: string; customerCompanyId: string };

const toDate = (v?: string | null) => (v ? new Date(v) : null);
const trimOrNull = (v?: string | null) => (v && v.trim() ? v.trim() : null);

@Injectable()
export class ChangeRequestsService {
  constructor(
    private prisma: PrismaService,
    private options: CrOptionsService,
    private notifications: NotificationsService,
  ) {}

  async list(clientId: string, opts: { search?: string; status?: string; priority?: string }) {
    await this.options.ensureDefaults(clientId);
    const where: Prisma.ChangeRequestWhereInput = { clientId };
    if (opts.status) where.status = opts.status;
    if (opts.priority) where.priority = opts.priority;
    if (opts.search) {
      const s = opts.search.trim();
      where.OR = [
        { crNumber: { contains: s, mode: 'insensitive' } },
        { title: { contains: s, mode: 'insensitive' } },
        { customer: { contains: s, mode: 'insensitive' } },
        { projectName: { contains: s, mode: 'insensitive' } },
      ];
    }
    return this.prisma.changeRequest.findMany({ where, orderBy: { createdAt: 'desc' } });
  }

  async findOne(id: string, clientId: string) {
    const cr = await this.prisma.changeRequest.findFirst({ where: { id, clientId } });
    if (!cr) throw new NotFoundException('Change request not found');
    return cr;
  }

  // ---- Customer-admin approval workflow -----------------------------------

  /** Provider sends a CR to its linked company's admin for approval. */
  async sendForApproval(id: string, clientId: string, actor: Actor) {
    const cr = await this.findOne(id, clientId);
    if (cr.changeSource === 'INTERNAL') {
      throw new BadRequestException('An internal change has no customer to approve it');
    }
    if (!cr.customerCompanyId) {
      throw new BadRequestException('Link a customer name before sending this CR for approval');
    }
    if (cr.approvalStatus === 'PENDING') throw new BadRequestException('Already sent for approval');
    if (cr.approvalStatus === 'APPROVED') throw new BadRequestException('This CR has already been approved by the customer');
    // A customer can't review an empty CR — require the core business content first.
    const missing: string[] = [];
    if (!cr.description?.trim()) missing.push('Description');
    if (!cr.objective?.trim()) missing.push('Objective');
    if (!cr.reasonForCr?.trim()) missing.push('Reason for the change');
    if (missing.length) {
      throw new BadRequestException(`Fill these in before sending for approval: ${missing.join(', ')}`);
    }
    const updated = await this.prisma.changeRequest.update({
      where: { id },
      data: { approvalStatus: 'PENDING', approvalReason: null, decidedById: null, decidedAt: null, updatedBy: actor.id },
    });
    const admins = await this.prisma.user.findMany({
      where: {
        clientId, isActive: true, customerCompanyId: cr.customerCompanyId,
        userRoles: { some: { role: { name: 'CustomerAdmin' } } },
      },
      select: { id: true },
    });
    await this.notifications.notifyMany(admins.map((a) => a.id), {
      clientId, type: 'CR_APPROVAL', title: 'Change request needs your approval',
      body: `${cr.crNumber} — ${cr.title}`,
    });
    return updated;
  }

  /** CRs a customer company admin can see (those sent to them). */
  listForCustomer(clientId: string, customerCompanyId: string) {
    return this.prisma.changeRequest.findMany({
      where: { clientId, customerCompanyId, approvalStatus: { in: ['PENDING', 'APPROVED', 'REJECTED'] } },
      orderBy: { createdAt: 'desc' },
    });
  }

  private async findOwnedByCustomer(id: string, actor: CustomerActor) {
    const cr = await this.prisma.changeRequest.findFirst({
      where: { id, clientId: actor.clientId, customerCompanyId: actor.customerCompanyId },
    });
    if (!cr || cr.approvalStatus === 'NONE') throw new NotFoundException('Change request not found');
    return cr;
  }

  async findOneForCustomer(id: string, actor: CustomerActor) {
    return this.findOwnedByCustomer(id, actor);
  }

  async customerApprove(id: string, actor: CustomerActor) {
    const cr = await this.findOwnedByCustomer(id, actor);
    if (cr.approvalStatus !== 'PENDING') throw new BadRequestException('This CR is not awaiting your approval');
    // Approval advances the workflow status too, so the CR reads as "Approved"
    // everywhere (list, stat cards) and the provider can move it on to delivery.
    const updated = await this.prisma.changeRequest.update({
      where: { id }, data: { approvalStatus: 'APPROVED', status: 'Approved', decidedById: actor.id, decidedAt: new Date() },
    });
    await this.notifyDecision(cr, 'approved');
    return updated;
  }

  async customerReject(id: string, dto: { reason?: string }, actor: CustomerActor) {
    const cr = await this.findOwnedByCustomer(id, actor);
    if (cr.approvalStatus !== 'PENDING') throw new BadRequestException('This CR is not awaiting your approval');
    const reason = dto.reason?.trim();
    if (!reason) throw new BadRequestException('A rejection reason is required');
    const updated = await this.prisma.changeRequest.update({
      where: { id }, data: { approvalStatus: 'REJECTED', approvalReason: reason, decidedById: actor.id, decidedAt: new Date() },
    });
    await this.notifyDecision(cr, 'rejected', reason);
    return updated;
  }

  private async notifyDecision(
    cr: { crNumber: string; title: string; createdBy: string | null; clientId: string },
    verb: 'approved' | 'rejected',
    reason?: string,
  ) {
    if (!cr.createdBy) return;
    await this.notifications.notify({
      clientId: cr.clientId, userId: cr.createdBy, type: 'CR_DECISION',
      title: `Change request ${verb}`,
      body: `${cr.crNumber} — ${cr.title}${reason ? ` · ${reason}` : ''}`,
    });
  }

  // Target Release Date >= CR End Date; Expected Go Live >= Target Release Date.
  private validateDates(d: {
    crStartDate?: Date | null; crEndDate?: Date | null;
    targetReleaseDate?: Date | null; expectedGoLiveDate?: Date | null;
  }) {
    if (d.crStartDate && d.crEndDate && d.crEndDate < d.crStartDate) {
      throw new BadRequestException('CR End Date must be on or after CR Start Date');
    }
    if (d.targetReleaseDate && d.crEndDate && d.targetReleaseDate < d.crEndDate) {
      throw new BadRequestException('Target Release Date must be on or after CR End Date');
    }
    if (d.expectedGoLiveDate && d.targetReleaseDate && d.expectedGoLiveDate < d.targetReleaseDate) {
      throw new BadRequestException('Expected Go Live Date must be on or after Target Release Date');
    }
  }

  async create(dto: CreateChangeRequestDto, clientId: string, actor: Actor) {
    const dates = {
      crStartDate: toDate(dto.crStartDate),
      crEndDate: toDate(dto.crEndDate),
      targetReleaseDate: toDate(dto.targetReleaseDate),
      expectedGoLiveDate: toDate(dto.expectedGoLiveDate),
    };
    this.validateDates(dates);

    // An internal change belongs to nobody outside — drop any customer link the
    // form may still have been holding when the radio was flipped.
    const changeSource = dto.changeSource === 'INTERNAL' ? 'INTERNAL' : 'CUSTOMER';
    const internal = changeSource === 'INTERNAL';

    return this.prisma.$transaction(async (tx) => {
      const client = await tx.client.update({
        where: { id: clientId },
        data: { crSequence: { increment: 1 } },
      });
      const crNumber = `CR-${String(client.crSequence).padStart(6, '0')}`;
      return tx.changeRequest.create({
        data: {
          clientId,
          crNumber,
          title: dto.title.trim(),
          description: trimOrNull(dto.description),
          featureName: trimOrNull(dto.featureName),
          changeSource,
          customerCompanyId: internal ? null : trimOrNull(dto.customerCompanyId),
          customer: internal ? null : trimOrNull(dto.customer),
          projectName: trimOrNull(dto.projectName),
          moduleName: trimOrNull(dto.moduleName),
          crType: trimOrNull(dto.crType),
          priority: trimOrNull(dto.priority),
          crCategory: trimOrNull(dto.crCategory),
          status: trimOrNull(dto.status) ?? 'New',
          // Change Management (ITIL) — General section
          changeType: trimOrNull(dto.changeType),
          changeGroup: trimOrNull(dto.changeGroup),
          changeOwner: trimOrNull(dto.changeOwner),
          subCategory: trimOrNull(dto.subCategory),
          impact: trimOrNull(dto.impact),
          servicesAffected: trimOrNull(dto.servicesAffected),
          comments: trimOrNull(dto.comments),
          changeCoordinator: trimOrNull(dto.changeCoordinator),
          implementor: trimOrNull(dto.implementor),
          lineManager: trimOrNull(dto.lineManager),
          reviewer: trimOrNull(dto.reviewer),
          changeApprover: trimOrNull(dto.changeApprover),
          changeApproverUserId: trimOrNull(dto.changeApproverUserId),
          requestedBy: trimOrNull(dto.requestedBy),
          businessOwner: trimOrNull(dto.businessOwner),
          functionalConsultant: trimOrNull(dto.functionalConsultant),
          technicalConsultant: trimOrNull(dto.technicalConsultant),
          projectManager: trimOrNull(dto.projectManager),
          // Business Requirement fields — needed so a CR is complete enough to
          // send for customer approval straight from the create form.
          requirementDetails: trimOrNull(dto.requirementDetails),
          objective: trimOrNull(dto.objective),
          reasonForCr: trimOrNull(dto.reasonForCr),
          benefitToCustomer: trimOrNull(dto.benefitToCustomer),
          crDate: toDate(dto.crDate) ?? new Date(),
          crStartDate: dates.crStartDate,
          crEndDate: dates.crEndDate,
          targetReleaseDate: dates.targetReleaseDate,
          expectedGoLiveDate: dates.expectedGoLiveDate,
          createdBy: actor.id,
          createdByName: actor.username ?? null,
          updatedBy: actor.id,
        },
      });
    });
  }

  async update(id: string, dto: UpdateChangeRequestDto, clientId: string, actor: Actor) {
    const cr = await this.findOne(id, clientId);
    const has = (k: keyof UpdateChangeRequestDto) => dto[k] !== undefined;

    // Merge incoming dates over current values, then validate the ordering.
    const merged = {
      crStartDate: has('crStartDate') ? toDate(dto.crStartDate) : cr.crStartDate,
      crEndDate: has('crEndDate') ? toDate(dto.crEndDate) : cr.crEndDate,
      targetReleaseDate: has('targetReleaseDate') ? toDate(dto.targetReleaseDate) : cr.targetReleaseDate,
      expectedGoLiveDate: has('expectedGoLiveDate') ? toDate(dto.expectedGoLiveDate) : cr.expectedGoLiveDate,
    };
    this.validateDates(merged);

    // Development dates (Phase 6): completion must be on or after the start.
    const devStart = has('developmentStartDate') ? toDate(dto.developmentStartDate) : cr.developmentStartDate;
    const completion = has('completionDate') ? toDate(dto.completionDate) : cr.completionDate;
    if (devStart && completion && completion < devStart) {
      throw new BadRequestException('Completion Date must be on or after Development Start');
    }

    const data: Prisma.ChangeRequestUpdateInput = { updatedBy: actor.id };
    if (has('title')) data.title = dto.title!.trim();
    if (has('description')) data.description = trimOrNull(dto.description);
    if (has('featureName')) data.featureName = trimOrNull(dto.featureName);
    // Flipping a change to INTERNAL clears its customer link (and any approval
    // already asked of them) — the two states can't both hold.
    const source = has('changeSource') ? dto.changeSource : cr.changeSource;
    if (has('changeSource')) data.changeSource = source!;
    if (source === 'INTERNAL') {
      if (has('changeSource') && cr.changeSource !== 'INTERNAL') {
        data.customerCompanyId = null;
        data.customer = null;
        data.approvalStatus = 'NONE';
        data.approvalReason = null;
        data.decidedById = null;
        data.decidedAt = null;
      }
    } else {
      if (has('customerCompanyId')) data.customerCompanyId = trimOrNull(dto.customerCompanyId);
      if (has('customer')) data.customer = trimOrNull(dto.customer);
    }
    if (has('projectName')) data.projectName = trimOrNull(dto.projectName);
    if (has('moduleName')) data.moduleName = trimOrNull(dto.moduleName);
    if (has('crType')) data.crType = trimOrNull(dto.crType);
    if (has('priority')) data.priority = trimOrNull(dto.priority);
    if (has('crCategory')) data.crCategory = trimOrNull(dto.crCategory);
    if (has('status')) data.status = trimOrNull(dto.status) ?? 'New';
    // Change Management (ITIL) — General section
    // Guard against reclassifying a change in a way that bypasses the CAB gate:
    // once past CAB Evaluation the type is frozen, and any change to it before then
    // invalidates a prior CAB decision so fresh sign-off is required.
    if (has('changeType') && trimOrNull(dto.changeType) !== cr.changeType) {
      if (stageIndex(cr.stage) > stageIndex(CAB_STAGE)) {
        throw new BadRequestException('Change Type cannot be changed after the CAB Evaluation stage');
      }
      data.cabApprovalStatus = 'NONE';
      data.cabReason = null;
      data.cabDecidedById = null;
      data.cabDecidedAt = null;
    }
    if (has('changeType')) data.changeType = trimOrNull(dto.changeType);
    if (has('changeGroup')) data.changeGroup = trimOrNull(dto.changeGroup);
    if (has('changeOwner')) data.changeOwner = trimOrNull(dto.changeOwner);
    if (has('subCategory')) data.subCategory = trimOrNull(dto.subCategory);
    if (has('impact')) data.impact = trimOrNull(dto.impact);
    if (has('servicesAffected')) data.servicesAffected = trimOrNull(dto.servicesAffected);
    if (has('comments')) data.comments = trimOrNull(dto.comments);
    if (has('changeCoordinator')) data.changeCoordinator = trimOrNull(dto.changeCoordinator);
    if (has('implementor')) data.implementor = trimOrNull(dto.implementor);
    if (has('lineManager')) data.lineManager = trimOrNull(dto.lineManager);
    if (has('reviewer')) data.reviewer = trimOrNull(dto.reviewer);
    // The Change Approver is a real staff user: store the id (authoritative for the
    // CAB decision) and denormalise their full name for display on the record.
    if (has('changeApproverUserId')) {
      const uid = trimOrNull(dto.changeApproverUserId);
      if (uid) {
        const approver = await this.prisma.user.findFirst({
          where: { id: uid, clientId, customerCompanyId: null },
          select: { id: true, username: true, name: true },
        });
        if (!approver) throw new BadRequestException('The selected Change Approver is not a valid staff user');
        data.changeApproverUserId = approver.id;
        data.changeApprover = approver.name?.trim() || approver.username;
      } else {
        data.changeApproverUserId = null;
        data.changeApprover = null;
      }
    }
    if (has('stageNotes')) data.stageNotes = (dto.stageNotes ?? {}) as Prisma.InputJsonValue;
    if (has('requestedBy')) data.requestedBy = trimOrNull(dto.requestedBy);
    if (has('businessOwner')) data.businessOwner = trimOrNull(dto.businessOwner);
    if (has('functionalConsultant')) data.functionalConsultant = trimOrNull(dto.functionalConsultant);
    if (has('technicalConsultant')) data.technicalConsultant = trimOrNull(dto.technicalConsultant);
    if (has('projectManager')) data.projectManager = trimOrNull(dto.projectManager);
    if (has('crDate')) data.crDate = toDate(dto.crDate);
    if (has('crStartDate')) data.crStartDate = merged.crStartDate;
    if (has('crEndDate')) data.crEndDate = merged.crEndDate;
    if (has('targetReleaseDate')) data.targetReleaseDate = merged.targetReleaseDate;
    if (has('expectedGoLiveDate')) data.expectedGoLiveDate = merged.expectedGoLiveDate;
    // Business Requirement (Phase 2)
    if (has('requirementDetails')) data.requirementDetails = trimOrNull(dto.requirementDetails);
    if (has('objective')) data.objective = trimOrNull(dto.objective);
    if (has('reasonForCr')) data.reasonForCr = trimOrNull(dto.reasonForCr);
    if (has('benefitToCustomer')) data.benefitToCustomer = trimOrNull(dto.benefitToCustomer);
    // Blue Print (Phase 3)
    if (has('blueprintName')) data.blueprintName = trimOrNull(dto.blueprintName);
    if (has('blueprintVersionNumber')) data.blueprintVersionNumber = trimOrNull(dto.blueprintVersionNumber);
    if (has('blueprintPreparedBy')) data.blueprintPreparedBy = trimOrNull(dto.blueprintPreparedBy);
    if (has('blueprintReviewedBy')) data.blueprintReviewedBy = trimOrNull(dto.blueprintReviewedBy);
    if (has('blueprintApprovedBy')) data.blueprintApprovedBy = trimOrNull(dto.blueprintApprovedBy);
    if (has('blueprintApprovalDate')) data.blueprintApprovalDate = toDate(dto.blueprintApprovalDate);
    if (has('blueprintRemarks')) data.blueprintRemarks = trimOrNull(dto.blueprintRemarks);
    // Impact Analysis (Phase 5)
    if (has('affectedModule')) data.affectedModule = trimOrNull(dto.affectedModule);
    if (has('affectedTables')) data.affectedTables = trimOrNull(dto.affectedTables);
    if (has('impactReports')) data.impactReports = trimOrNull(dto.impactReports);
    if (has('impactInterfaces')) data.impactInterfaces = trimOrNull(dto.impactInterfaces);
    if (has('impactForms')) data.impactForms = trimOrNull(dto.impactForms);
    if (has('impactWorkflow')) data.impactWorkflow = trimOrNull(dto.impactWorkflow);
    if (has('masterData')) data.masterData = trimOrNull(dto.masterData);
    if (has('authorizations')) data.authorizations = trimOrNull(dto.authorizations);
    if (has('performance')) data.performance = trimOrNull(dto.performance);
    if (has('risk')) data.risk = trimOrNull(dto.risk);
    if (has('estimatedHours')) data.estimatedHours = dto.estimatedHours ?? null;
    if (has('complexity')) data.complexity = trimOrNull(dto.complexity);
    // Development Details (Phase 6)
    if (has('developer')) data.developer = trimOrNull(dto.developer);
    if (has('developmentStatus')) data.developmentStatus = trimOrNull(dto.developmentStatus);
    if (has('developmentStartDate')) data.developmentStartDate = devStart;
    if (has('completionDate')) data.completionDate = completion;
    if (has('transportNumber')) data.transportNumber = trimOrNull(dto.transportNumber);
    if (has('gitRepository')) data.gitRepository = trimOrNull(dto.gitRepository);
    if (has('buildNumber')) data.buildNumber = trimOrNull(dto.buildNumber);
    // Testing (Phase 7)
    if (has('testCase')) data.testCase = trimOrNull(dto.testCase);
    if (has('testingPerson')) data.testingPerson = trimOrNull(dto.testingPerson);
    if (has('testingStatus')) data.testingStatus = trimOrNull(dto.testingStatus);
    if (has('uatPerformedBy')) data.uatPerformedBy = trimOrNull(dto.uatPerformedBy);
    if (has('defectCount')) data.defectCount = dto.defectCount ?? null;
    if (has('retest')) data.retest = trimOrNull(dto.retest);
    if (has('testApproval')) data.testApproval = trimOrNull(dto.testApproval);
    // Deployment (Phase 8)
    if (has('deploymentPlan')) data.deploymentPlan = trimOrNull(dto.deploymentPlan);
    if (has('goLiveChecklist')) data.goLiveChecklist = trimOrNull(dto.goLiveChecklist);
    if (has('rollbackPlan')) data.rollbackPlan = trimOrNull(dto.rollbackPlan);
    if (has('transportList')) data.transportList = trimOrNull(dto.transportList);
    if (has('deploymentDate')) data.deploymentDate = toDate(dto.deploymentDate);
    if (has('supportWindow')) data.supportWindow = trimOrNull(dto.supportWindow);

    return this.prisma.changeRequest.update({ where: { id }, data });
  }

  // ---- Stage pipeline (sequential, no jumping) ----------------------------

  /** Whether this CR still needs CAB sign-off to leave the CAB Evaluation stage. */
  private cabRequired(cr: { changeType: string | null }) {
    return !!cr.changeType && CAB_TYPES.includes(cr.changeType);
  }

  /**
   * Move a CR to the next stage. `targetStage` must be exactly the stage after
   * the current one — no skipping and no jumping backwards. Leaving CAB Evaluation
   * requires an APPROVED CAB decision when the change type demands it (Emergency exempt).
   */
  async advanceStage(id: string, targetStage: string, clientId: string, actor: Actor) {
    const cr = await this.findOne(id, clientId);
    const current = stageIndex(cr.stage);
    const target = CHANGE_STAGES.indexOf(targetStage as (typeof CHANGE_STAGES)[number]);
    if (target === -1) throw new BadRequestException('Unknown stage');
    if (target !== current + 1) {
      throw new BadRequestException('Stages must be completed in order — you cannot skip or jump a stage');
    }
    // Gate leaving CAB Evaluation on the board's sign-off.
    if (cr.stage === CAB_STAGE && this.cabRequired(cr) && cr.cabApprovalStatus !== 'APPROVED') {
      throw new BadRequestException('CAB approval is required before leaving the CAB Evaluation stage');
    }
    return this.prisma.changeRequest.update({
      where: { id }, data: { stage: targetStage, updatedBy: actor.id },
    });
  }

  // ---- CAB (Change Approval Board) sign-off -------------------------------

  private mayDecideCab(cr: { changeApproverUserId: string | null }, actor: Actor) {
    if (actor.roles?.includes('Admin')) return true;
    // The approver is matched by real user identity, not a free-text name.
    return !!cr.changeApproverUserId && cr.changeApproverUserId === actor.id;
  }

  async cabDecision(id: string, dto: { decision: string; reason?: string }, clientId: string, actor: Actor) {
    const cr = await this.findOne(id, clientId);
    if (!this.mayDecideCab(cr, actor)) {
      throw new BadRequestException('Only the assigned Change Approver or a tenant Admin can decide CAB approval');
    }
    if (!this.cabRequired(cr)) {
      throw new BadRequestException('This change type does not require CAB approval');
    }
    // A CAB decision is only meaningful at the CAB Evaluation stage — this stops a
    // sign-off being flipped after the change has already advanced (or closed).
    if (cr.stage !== CAB_STAGE) {
      throw new BadRequestException('CAB decisions can only be made during the CAB Evaluation stage');
    }
    const decision = dto.decision === 'APPROVED' ? 'APPROVED' : dto.decision === 'REJECTED' ? 'REJECTED' : null;
    if (!decision) throw new BadRequestException('Decision must be APPROVED or REJECTED');
    const reason = decision === 'REJECTED' ? trimOrNull(dto.reason) : null;
    if (decision === 'REJECTED' && !reason) throw new BadRequestException('A rejection reason is required');
    const updated = await this.prisma.changeRequest.update({
      where: { id },
      data: { cabApprovalStatus: decision, cabReason: reason, cabDecidedById: actor.id, cabDecidedAt: new Date(), updatedBy: actor.id },
    });
    if (cr.createdBy) {
      await this.notifications.notify({
        clientId, userId: cr.createdBy, type: 'CR_CAB_DECISION',
        title: `CAB ${decision === 'APPROVED' ? 'approved' : 'rejected'} a change`,
        body: `${cr.crNumber} — ${cr.title}${reason ? ` · ${reason}` : ''}`,
      });
    }
    return updated;
  }

  async remove(id: string, clientId: string) {
    await this.findOne(id, clientId);
    await this.prisma.changeRequest.delete({ where: { id } });
    return { message: 'Change request deleted' };
  }
}
