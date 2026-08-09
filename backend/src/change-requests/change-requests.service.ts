import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CrOptionsService } from './cr-options.service';
import { CreateChangeRequestDto, UpdateChangeRequestDto } from './dto/change-request.dto';

type Actor = { id: string; username?: string; roles?: string[] };

const toDate = (v?: string | null) => (v ? new Date(v) : null);
const trimOrNull = (v?: string | null) => (v && v.trim() ? v.trim() : null);

@Injectable()
export class ChangeRequestsService {
  constructor(
    private prisma: PrismaService,
    private options: CrOptionsService,
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
          customer: trimOrNull(dto.customer),
          projectName: trimOrNull(dto.projectName),
          moduleName: trimOrNull(dto.moduleName),
          crType: trimOrNull(dto.crType),
          priority: trimOrNull(dto.priority),
          crCategory: trimOrNull(dto.crCategory),
          status: trimOrNull(dto.status) ?? 'New',
          requestedBy: trimOrNull(dto.requestedBy),
          businessOwner: trimOrNull(dto.businessOwner),
          functionalConsultant: trimOrNull(dto.functionalConsultant),
          technicalConsultant: trimOrNull(dto.technicalConsultant),
          projectManager: trimOrNull(dto.projectManager),
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
    if (has('customer')) data.customer = trimOrNull(dto.customer);
    if (has('projectName')) data.projectName = trimOrNull(dto.projectName);
    if (has('moduleName')) data.moduleName = trimOrNull(dto.moduleName);
    if (has('crType')) data.crType = trimOrNull(dto.crType);
    if (has('priority')) data.priority = trimOrNull(dto.priority);
    if (has('crCategory')) data.crCategory = trimOrNull(dto.crCategory);
    if (has('status')) data.status = trimOrNull(dto.status) ?? 'New';
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

  async remove(id: string, clientId: string) {
    await this.findOne(id, clientId);
    await this.prisma.changeRequest.delete({ where: { id } });
    return { message: 'Change request deleted' };
  }
}
