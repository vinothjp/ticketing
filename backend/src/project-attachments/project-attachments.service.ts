import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

type Actor = { id: string };

// Generic attachments for project sub-entities (invoice / document / risk / issue …).
// Each attachment is either an uploaded file (filePath) or an external link (url),
// scoped by entityType + entityId within a project.
@Injectable()
export class ProjectAttachmentsService {
  constructor(private prisma: PrismaService) {}

  async list(projectId: string, entityType: string, entityId: string, clientId: string) {
    await this.owned(projectId, clientId);
    return this.prisma.projectAttachment.findMany({
      where: { projectId, entityType, entityId },
      orderBy: { uploadedAt: 'desc' },
    });
  }

  async upload(
    projectId: string, entityType: string, entityId: string,
    files: Express.Multer.File[], clientId: string, actor: Actor,
  ) {
    await this.owned(projectId, clientId);
    if (!entityType || !entityId) throw new BadRequestException('entityType and entityId are required');
    if (files?.length) {
      await this.prisma.projectAttachment.createMany({
        data: files.map((f) => ({
          projectId, entityType, entityId,
          fileName: f.originalname,
          filePath: `/uploads/projects/${f.filename}`,
          mimeType: f.mimetype,
          size: f.size,
          uploadedBy: actor.id,
        })),
      });
    }
    return this.list(projectId, entityType, entityId, clientId);
  }

  async addLink(
    projectId: string, entityType: string, entityId: string,
    url: string, fileName: string | undefined, clientId: string, actor: Actor,
  ) {
    await this.owned(projectId, clientId);
    if (!entityType || !entityId) throw new BadRequestException('entityType and entityId are required');
    if (!url?.trim()) throw new BadRequestException('A link is required');
    await this.prisma.projectAttachment.create({
      data: {
        projectId, entityType, entityId,
        url: url.trim(),
        fileName: fileName?.trim() || url.trim(),
        uploadedBy: actor.id,
      },
    });
    return this.list(projectId, entityType, entityId, clientId);
  }

  async remove(attId: string, clientId: string) {
    const att = await this.prisma.projectAttachment.findFirst({
      where: { id: attId, project: { clientId } },
      select: { id: true },
    });
    if (!att) throw new NotFoundException('Attachment not found');
    await this.prisma.projectAttachment.delete({ where: { id: attId } });
    return { message: 'Attachment removed' };
  }

  private async owned(projectId: string, clientId: string) {
    const p = await this.prisma.project.findFirst({ where: { id: projectId, clientId }, select: { id: true } });
    if (!p) throw new NotFoundException('Project not found');
  }
}
