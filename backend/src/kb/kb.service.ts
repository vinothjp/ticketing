import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateKbArticleDto, UpdateKbArticleDto } from './dto/kb-article.dto';

type Viewer = { id: string; roles: string[] };
const isCustomer = (v: Viewer) => v.roles.includes('Customer') && !v.roles.includes('Admin');

@Injectable()
export class KbService {
  constructor(private prisma: PrismaService) {}

  // Customers only ever see published, customer-facing articles.
  private scope(clientId: string, viewer: Viewer): Prisma.KbArticleWhereInput {
    return isCustomer(viewer)
      ? { clientId, status: 'PUBLISHED', audience: 'CUSTOMER' }
      : { clientId };
  }

  private cleanKeywords(k?: string[]) {
    return Array.from(new Set((k ?? []).map((s) => s.trim()).filter(Boolean)));
  }

  private cleanUrls(refs?: { label?: string; url: string }[]) {
    return (refs ?? [])
      .filter((r) => r?.url?.trim())
      .map((r) => ({ label: r.label?.trim() || undefined, url: r.url.trim() }));
  }

  async list(clientId: string, viewer: Viewer, opts: { search?: string; category?: string }) {
    const where: Prisma.KbArticleWhereInput = { ...this.scope(clientId, viewer) };
    if (opts.category) where.category = opts.category;
    if (opts.search) {
      where.OR = [
        { title: { contains: opts.search, mode: 'insensitive' } },
        { body: { contains: opts.search, mode: 'insensitive' } },
        { keywords: { has: opts.search } },
      ];
    }
    return this.prisma.kbArticle.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      include: { attachments: true },
    });
  }

  /** Distinct keywords across the tenant's articles — powers the editor autocomplete. */
  async keywords(clientId: string) {
    const rows = await this.prisma.kbArticle.findMany({ where: { clientId }, select: { keywords: true } });
    return Array.from(new Set(rows.flatMap((r) => r.keywords))).sort((a, b) => a.localeCompare(b));
  }

  async findOne(id: string, clientId: string, viewer: Viewer) {
    const article = await this.prisma.kbArticle.findFirst({
      where: { id, ...this.scope(clientId, viewer) },
      include: { attachments: true },
    });
    if (!article) throw new NotFoundException('Article not found');
    return article;
  }

  private async ownerName(clientId: string, ownerId?: string) {
    if (!ownerId) return null;
    const u = await this.prisma.user.findFirst({ where: { id: ownerId, clientId }, select: { username: true } });
    return u?.username ?? null;
  }

  async create(dto: CreateKbArticleDto, clientId: string, actor: { id: string; username?: string }) {
    const status = dto.status ?? 'DRAFT';
    const knowledgeOwnerName = await this.ownerName(clientId, dto.knowledgeOwnerId);
    const publishedDate = dto.publishedDate ? new Date(dto.publishedDate)
      : status === 'PUBLISHED' ? new Date() : null;

    return this.prisma.$transaction(async (tx) => {
      const client = await tx.client.update({ where: { id: clientId }, data: { kbSequence: { increment: 1 } } });
      const documentNumber = `KB-${String(client.kbSequence).padStart(6, '0')}`;
      return tx.kbArticle.create({
        data: {
          clientId,
          documentNumber,
          title: dto.title,
          body: dto.body,
          articleType: dto.articleType ?? 'KNOWLEDGE',
          category: dto.category?.trim() || null,
          subCategory: dto.subCategory?.trim() || null,
          module: dto.module?.trim() || null,
          subject: dto.subject?.trim() || null,
          versionNumber: dto.versionNumber?.trim() || null,
          problemDescription: dto.problemDescription || null,
          resolution: dto.resolution || null,
          cause: dto.cause || null,
          prevention: dto.prevention || null,
          keywords: this.cleanKeywords(dto.keywords),
          urlReferences: this.cleanUrls(dto.urlReferences) as unknown as Prisma.InputJsonValue,
          status,
          audience: dto.audience ?? 'INTERNAL',
          knowledgeOwnerId: dto.knowledgeOwnerId || null,
          knowledgeOwnerName,
          publishedDate,
          expiryDate: dto.expiryDate ? new Date(dto.expiryDate) : null,
          createdBy: actor.id,
          createdByName: actor.username ?? null,
          updatedBy: actor.id,
        },
        include: { attachments: true },
      });
    });
  }

  async update(id: string, dto: UpdateKbArticleDto, clientId: string, actorId: string) {
    const existing = await this.getOwned(id, clientId);
    const set = <T>(v: T | undefined) => v !== undefined;

    const data: Prisma.KbArticleUpdateInput = { updatedBy: actorId };
    if (set(dto.title)) data.title = dto.title;
    if (set(dto.body)) data.body = dto.body;
    if (set(dto.articleType)) data.articleType = dto.articleType;
    if (set(dto.category)) data.category = dto.category?.trim() || null;
    if (set(dto.subCategory)) data.subCategory = dto.subCategory?.trim() || null;
    if (set(dto.module)) data.module = dto.module?.trim() || null;
    if (set(dto.subject)) data.subject = dto.subject?.trim() || null;
    if (set(dto.versionNumber)) data.versionNumber = dto.versionNumber?.trim() || null;
    if (set(dto.problemDescription)) data.problemDescription = dto.problemDescription || null;
    if (set(dto.resolution)) data.resolution = dto.resolution || null;
    if (set(dto.cause)) data.cause = dto.cause || null;
    if (set(dto.prevention)) data.prevention = dto.prevention || null;
    if (set(dto.keywords)) data.keywords = this.cleanKeywords(dto.keywords);
    if (set(dto.urlReferences)) data.urlReferences = this.cleanUrls(dto.urlReferences) as unknown as Prisma.InputJsonValue;
    if (set(dto.status)) data.status = dto.status;
    if (set(dto.audience)) data.audience = dto.audience;
    if (set(dto.expiryDate)) data.expiryDate = dto.expiryDate ? new Date(dto.expiryDate) : null;
    if (set(dto.knowledgeOwnerId)) {
      data.knowledgeOwnerId = dto.knowledgeOwnerId || null;
      data.knowledgeOwnerName = await this.ownerName(clientId, dto.knowledgeOwnerId);
    }
    // Published date: explicit value wins; otherwise auto-set on the DRAFT→PUBLISHED transition.
    if (set(dto.publishedDate)) {
      data.publishedDate = dto.publishedDate ? new Date(dto.publishedDate) : null;
    } else if (dto.status === 'PUBLISHED' && existing.status !== 'PUBLISHED' && !existing.publishedDate) {
      data.publishedDate = new Date();
    }

    return this.prisma.kbArticle.update({ where: { id }, data, include: { attachments: true } });
  }

  async remove(id: string, clientId: string) {
    await this.getOwned(id, clientId);
    await this.prisma.kbArticle.delete({ where: { id } });
    return { message: 'Article deleted' };
  }

  async addAttachments(articleId: string, clientId: string, files: Express.Multer.File[], actorId: string) {
    await this.getOwned(articleId, clientId);
    if (files?.length) {
      await this.prisma.kbAttachment.createMany({
        data: files.map((f) => ({
          articleId,
          fileName: f.originalname,
          filePath: `/uploads/kb/${f.filename}`,
          mimeType: f.mimetype,
          size: f.size,
          uploadedBy: actorId,
        })),
      });
    }
    return this.prisma.kbAttachment.findMany({ where: { articleId } });
  }

  async removeAttachment(articleId: string, attId: string, clientId: string) {
    await this.getOwned(articleId, clientId);
    await this.prisma.kbAttachment.deleteMany({ where: { id: attId, articleId } });
    return { message: 'Attachment removed' };
  }

  private async getOwned(id: string, clientId: string) {
    const article = await this.prisma.kbArticle.findFirst({ where: { id, clientId } });
    if (!article) throw new NotFoundException('Article not found');
    return article;
  }
}
