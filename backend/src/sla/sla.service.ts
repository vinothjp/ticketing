import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSlaPolicyDto } from './dto/create-sla-policy.dto';
import { UpdateSlaPolicyDto } from './dto/update-sla-policy.dto';

@Injectable()
export class SlaService {
  constructor(private prisma: PrismaService) {}

  findAll(clientId: string) {
    return this.prisma.slaPolicy.findMany({
      where: { clientId },
      orderBy: { resolutionHours: 'asc' },
    });
  }

  async create(dto: CreateSlaPolicyDto, clientId: string, actorId: string) {
    const existing = await this.prisma.slaPolicy.findFirst({
      where: { clientId, priority: dto.priority },
    });
    if (existing) {
      throw new ConflictException('An SLA policy for this priority already exists');
    }
    return this.prisma.slaPolicy.create({
      data: {
        clientId,
        priority: dto.priority,
        resolutionHours: dto.resolutionHours,
        responseHours: dto.responseHours,
        isActive: dto.isActive ?? true,
        createdBy: actorId,
        updatedBy: actorId,
      },
    });
  }

  async update(
    id: string,
    clientId: string,
    dto: UpdateSlaPolicyDto,
    actorId: string,
  ) {
    const existing = await this.prisma.slaPolicy.findFirst({
      where: { id, clientId },
    });
    if (!existing) throw new NotFoundException('SLA policy not found');
    return this.prisma.slaPolicy.update({
      where: { id },
      data: { ...dto, updatedBy: actorId },
    });
  }

  async remove(id: string, clientId: string) {
    const existing = await this.prisma.slaPolicy.findFirst({
      where: { id, clientId },
    });
    if (!existing) throw new NotFoundException('SLA policy not found');
    await this.prisma.slaPolicy.delete({ where: { id } });
    return { message: 'SLA policy deleted' };
  }
}
