import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

type Actor = { id: string };

// Slots the CR module recognises. Kept small + validated so the polymorphic
// entityType column can't be set to arbitrary values.
export const CR_ATTACHMENT_TYPES = ['blueprint', 'supportive', 'uat'] as const;

@Injectable()
export class CrAttachmentsService {
  constructor(private prisma: PrismaService) {}

  private async ownedCr(crId: string, clientId: string) {
    const cr = await this.prisma.changeRequest.findFirst({ where: { id: crId, clientId }, select: { id: true } });
    if (!cr) throw new NotFoundException('Change request not found');
  }

  private assertType(entityType: string) {
    if (!CR_ATTACHMENT_TYPES.includes(entityType as any)) {
      throw new BadRequestException('Invalid attachment type');
    }
  }

  async list(crId: string, entityType: string | undefined, clientId: string) {
    await this.ownedCr(crId, clientId);
    return this.prisma.changeRequestAttachment.findMany({
      where: { changeRequestId: crId, ...(entityType ? { entityType } : {}) },
      orderBy: { uploadedAt: 'desc' },
    });
  }

  async upload(
    crId: string, entityType: string, title: string | undefined,
    files: Express.Multer.File[], clientId: string, actor: Actor,
  ) {
    await this.ownedCr(crId, clientId);
    this.assertType(entityType);
    if (files?.length) {
      await this.prisma.changeRequestAttachment.createMany({
        data: files.map((f) => ({
          changeRequestId: crId,
          entityType,
          title: title?.trim() || null,
          fileName: f.originalname,
          filePath: `/uploads/change-requests/${f.filename}`,
          mimeType: f.mimetype,
          size: f.size,
          uploadedBy: actor.id,
        })),
      });
    }
    return this.list(crId, entityType, clientId);
  }

  async addLink(
    crId: string, entityType: string, url: string,
    fileName: string | undefined, title: string | undefined, clientId: string, actor: Actor,
  ) {
    await this.ownedCr(crId, clientId);
    this.assertType(entityType);
    if (!url?.trim()) throw new BadRequestException('A link is required');
    await this.prisma.changeRequestAttachment.create({
      data: {
        changeRequestId: crId,
        entityType,
        title: title?.trim() || null,
        url: url.trim(),
        fileName: fileName?.trim() || url.trim(),
        uploadedBy: actor.id,
      },
    });
    return this.list(crId, entityType, clientId);
  }

  async remove(attId: string, clientId: string) {
    const att = await this.prisma.changeRequestAttachment.findFirst({
      where: { id: attId, changeRequest: { clientId } },
      select: { id: true },
    });
    if (!att) throw new NotFoundException('Attachment not found');
    await this.prisma.changeRequestAttachment.delete({ where: { id: attId } });
    return { message: 'Attachment removed' };
  }
}
