import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePicklistOptionDto } from './dto/create-picklist-option.dto';

@Injectable()
export class PicklistsService {
  constructor(private prisma: PrismaService) {}

  findAll(clientId: string, listKey?: string) {
    return this.prisma.picklistOption.findMany({
      where: { clientId, ...(listKey ? { listKey } : {}) },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async findOne(id: string, clientId: string) {
    const option = await this.prisma.picklistOption.findFirst({
      where: { id, clientId },
    });
    if (!option) throw new NotFoundException('Picklist option not found');
    return option;
  }

  async create(
    dto: CreatePicklistOptionDto,
    clientId: string,
    actorId: string,
  ) {
    const existing = await this.prisma.picklistOption.findFirst({
      where: { clientId, listKey: dto.listKey, value: dto.value },
    });
    if (existing)
      throw new ConflictException(
        'An option with this value already exists in this list',
      );

    return this.prisma.picklistOption.create({
      data: { ...dto, clientId, createdBy: actorId, updatedBy: actorId },
    });
  }

  async update(
    id: string,
    dto: Partial<CreatePicklistOptionDto>,
    clientId: string,
    actorId: string,
  ) {
    await this.findOne(id, clientId);
    return this.prisma.picklistOption.update({
      where: { id },
      data: { ...dto, updatedBy: actorId },
    });
  }

  async remove(id: string, clientId: string) {
    await this.findOne(id, clientId);
    await this.prisma.picklistOption.delete({ where: { id } });
    return { message: 'Picklist option deleted' };
  }
}
