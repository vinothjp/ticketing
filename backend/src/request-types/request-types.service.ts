import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateRequestTypeDto } from './dto/create-request-type.dto';

@Injectable()
export class RequestTypesService {
  constructor(private prisma: PrismaService) {}

  findAll(clientId: string) {
    return this.prisma.requestType.findMany({
      where: { clientId },
      orderBy: { sortOrder: 'asc' },
      include: { template: { select: { id: true } } },
    });
  }

  async findOne(id: string, clientId: string) {
    const requestType = await this.prisma.requestType.findFirst({
      where: { id, clientId },
    });
    if (!requestType) throw new NotFoundException('Request type not found');
    return requestType;
  }

  async create(dto: CreateRequestTypeDto, clientId: string, actorId: string) {
    const existing = await this.prisma.requestType.findFirst({
      where: { clientId, name: dto.name },
    });
    if (existing)
      throw new ConflictException('Request type name already exists');

    return this.prisma.requestType.create({
      data: {
        ...dto,
        clientId,
        createdBy: actorId,
        updatedBy: actorId,
        template: {
          create: {
            clientId,
            name: `${dto.name} Template`,
            createdBy: actorId,
            updatedBy: actorId,
          },
        },
      },
      include: { template: { select: { id: true } } },
    });
  }

  async update(
    id: string,
    dto: Partial<CreateRequestTypeDto>,
    clientId: string,
    actorId: string,
  ) {
    await this.findOne(id, clientId);
    return this.prisma.requestType.update({
      where: { id },
      data: { ...dto, updatedBy: actorId },
    });
  }

  async remove(id: string, clientId: string) {
    await this.findOne(id, clientId);
    await this.prisma.requestType.delete({ where: { id } });
    return { message: 'Request type deleted' };
  }
}
