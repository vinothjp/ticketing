import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateFormDto } from './dto/create-form.dto';

@Injectable()
export class FormsService {
  constructor(private prisma: PrismaService) {}

  findAll() { return this.prisma.appForm.findMany(); }

  async findOne(id: string) {
    const form = await this.prisma.appForm.findUnique({ where: { id } });
    if (!form) throw new NotFoundException('Form not found');
    return form;
  }

  async create(dto: CreateFormDto, actorId: string) {
    const existing = await this.prisma.appForm.findUnique({ where: { name: dto.name } });
    if (existing) throw new ConflictException('Form name already exists');
    return this.prisma.appForm.create({ data: { ...dto, createdBy: actorId, updatedBy: actorId } });
  }

  async update(id: string, dto: Partial<CreateFormDto>, actorId: string) {
    await this.findOne(id);
    return this.prisma.appForm.update({ where: { id }, data: { ...dto, updatedBy: actorId } });
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.appForm.delete({ where: { id } });
    return { message: 'Form deleted' };
  }
}
