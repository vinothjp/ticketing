import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { mkdir, writeFile, unlink, rm } from 'fs/promises';
import { join } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAlbumDto, UpdateAlbumDto, UpdatePhotoDto } from './dto/gallery.dto';

type Actor = { id: string; username?: string };

/**
 * The slice of `sharp` this file uses, typed here on purpose. Importing sharp's
 * own types (`typeof import('sharp')`) would make the *compile* depend on the
 * package — and the dev containers compile at start-up, so a deploy that
 * restarted instead of rebuilt would take the whole backend down, not just
 * photo shrinking. Typed locally, a missing sharp costs only the shrinking.
 */
type Rendered = { data: Buffer; info: { width: number; height: number } };
interface SharpPipeline {
  rotate(): SharpPipeline;
  resize(opts: { width: number; height: number; fit: 'inside'; withoutEnlargement: boolean }): SharpPipeline;
  jpeg(opts: { quality: number; mozjpeg: boolean }): SharpPipeline;
  toBuffer(opts: { resolveWithObject: true }): Promise<Rendered>;
}
type SharpFn = (input: Buffer, opts: { failOn: 'none' }) => SharpPipeline;

/**
 * `sharp` shrinks uploads. It is loaded defensively: if a deploy ever ships
 * without it (a restart instead of a rebuild), the gallery still works — it
 * just refuses photos over the stored-size cap instead of shrinking them.
 */
let sharp: SharpFn | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  sharp = require('sharp') as SharpFn;
} catch {
  sharp = null;
}

/** Nothing stored is larger than this — the agreed per-photo cap. */
export const MAX_STORED_BYTES = 1024 * 1024;
/** Photos per upload, as agreed. Enforced by the route's interceptor too. */
export const MAX_PHOTOS_PER_UPLOAD = 10;
/**
 * What an upload may weigh *before* shrinking. Phone photos are 3–8 MB; this
 * leaves room above that while still refusing something absurd.
 */
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp'];
/** Progressively smaller/lower-quality passes until the web copy fits the cap. */
const PASSES: [maxSide: number, quality: number][] = [[1600, 82], [1600, 72], [1280, 72], [1280, 62], [1024, 60], [800, 60]];
const THUMB: [maxSide: number, quality: number] = [480, 72];

const GALLERY_DIR = join(process.cwd(), 'uploads/gallery');
const fsPath = (url: string) => join(process.cwd(), url.replace(/^\//, ''));

@Injectable()
export class GalleryService {
  private readonly logger = new Logger(GalleryService.name);

  constructor(private prisma: PrismaService) {
    if (!sharp) this.logger.warn('sharp is not available — gallery uploads over 1 MB will be refused, not shrunk');
  }

  // ---- albums ---------------------------------------------------------------

  async list(clientId: string, category?: string) {
    const albums = await this.prisma.galleryAlbum.findMany({
      where: { clientId, ...(category ? { category } : {}) },
      orderBy: [{ eventDate: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
      include: {
        project: { select: { id: true, name: true } },
        customerCompany: { select: { id: true, name: true } },
        _count: { select: { photos: true } },
        photos: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }], take: 1, select: { id: true, thumbUrl: true } },
      },
    });
    // The cover is the chosen photo, else the first one — looked up in one query.
    const coverIds = albums.map((a) => a.coverPhotoId).filter((x): x is string => !!x);
    const covers = coverIds.length
      ? new Map((await this.prisma.galleryPhoto.findMany({ where: { id: { in: coverIds } }, select: { id: true, thumbUrl: true } })).map((p) => [p.id, p.thumbUrl]))
      : new Map<string, string>();
    return albums.map(({ photos, _count, ...a }) => ({
      ...a,
      photoCount: _count.photos,
      coverUrl: (a.coverPhotoId && covers.get(a.coverPhotoId)) || photos[0]?.thumbUrl || null,
    }));
  }

  async get(id: string, clientId: string) {
    const album = await this.prisma.galleryAlbum.findFirst({
      where: { id, clientId },
      include: {
        project: { select: { id: true, name: true } },
        customerCompany: { select: { id: true, name: true } },
        photos: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] },
      },
    });
    if (!album) throw new NotFoundException('Album not found');
    return album;
  }

  async create(dto: CreateAlbumDto, clientId: string, actor: Actor) {
    await this.assertContext(clientId, dto.projectId, dto.customerCompanyId);
    return this.prisma.galleryAlbum.create({
      data: {
        clientId,
        title: dto.title.trim(),
        description: dto.description?.trim() || null,
        category: dto.category,
        eventDate: dto.eventDate ? new Date(dto.eventDate) : null,
        projectId: dto.projectId || null,
        customerCompanyId: dto.customerCompanyId || null,
        createdBy: actor.id,
        createdByName: actor.username ?? null,
      },
    });
  }

  async update(id: string, dto: UpdateAlbumDto, clientId: string) {
    await this.owned(id, clientId);
    await this.assertContext(clientId, dto.projectId, dto.customerCompanyId);
    return this.prisma.galleryAlbum.update({
      where: { id },
      data: {
        ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
        ...(dto.description !== undefined ? { description: dto.description?.trim() || null } : {}),
        ...(dto.category !== undefined ? { category: dto.category } : {}),
        ...(dto.eventDate !== undefined ? { eventDate: dto.eventDate ? new Date(dto.eventDate) : null } : {}),
        ...(dto.projectId !== undefined ? { projectId: dto.projectId || null } : {}),
        ...(dto.customerCompanyId !== undefined ? { customerCompanyId: dto.customerCompanyId || null } : {}),
      },
    });
  }

  /** Deleting an album deletes its photos and their files. */
  async remove(id: string, clientId: string) {
    await this.owned(id, clientId);
    await this.prisma.galleryAlbum.delete({ where: { id } });
    await rm(join(GALLERY_DIR, id), { recursive: true, force: true }).catch(() => undefined);
    return { message: 'Album deleted' };
  }

  // ---- photos ---------------------------------------------------------------

  /**
   * Add up to MAX_PHOTOS_PER_UPLOAD photos. Each is handled on its own and
   * serially (shrinking is memory-hungry), so one bad file is reported by name
   * while the rest are saved.
   */
  async addPhotos(albumId: string, files: Express.Multer.File[], clientId: string, actor: Actor) {
    await this.owned(albumId, clientId);
    if (!files?.length) throw new BadRequestException('Choose at least one photo');
    if (files.length > MAX_PHOTOS_PER_UPLOAD) {
      throw new BadRequestException(`Upload at most ${MAX_PHOTOS_PER_UPLOAD} photos at a time`);
    }
    const dir = join(GALLERY_DIR, albumId);
    await mkdir(dir, { recursive: true });
    const last = await this.prisma.galleryPhoto.aggregate({ where: { albumId }, _max: { sortOrder: true } });
    let order = (last._max.sortOrder ?? -1) + 1;

    const added: { id: string; name: string; sizeBytes: number }[] = [];
    const errors: { name: string; message: string }[] = [];
    for (const f of files) {
      const name = f.originalname;
      try {
        if (!ACCEPTED.includes(f.mimetype)) throw new BadRequestException('Only JPEG, PNG or WebP photos can be uploaded');
        const out = await this.process(f.buffer);
        const id = randomUUID();
        const fileUrl = `/uploads/gallery/${albumId}/${id}.jpg`;
        const thumbUrl = out.thumb ? `/uploads/gallery/${albumId}/${id}_t.jpg` : fileUrl;
        await writeFile(fsPath(fileUrl), out.main);
        if (out.thumb) await writeFile(fsPath(thumbUrl), out.thumb);
        await this.prisma.galleryPhoto.create({
          data: {
            id, albumId, fileUrl, thumbUrl, width: out.width, height: out.height,
            sizeBytes: out.main.length, originalName: name, sortOrder: order++, uploadedBy: actor.id,
          },
        });
        added.push({ id, name, sizeBytes: out.main.length });
      } catch (e) {
        errors.push({ name, message: (e as Error).message || 'Could not save this photo' });
      }
    }
    await this.prisma.galleryAlbum.update({ where: { id: albumId }, data: { updatedAt: new Date() } });
    return { added, errors };
  }

  async updatePhoto(photoId: string, dto: UpdatePhotoDto, clientId: string) {
    const photo = await this.ownedPhoto(photoId, clientId);
    if (dto.caption !== undefined) {
      await this.prisma.galleryPhoto.update({ where: { id: photoId }, data: { caption: dto.caption?.trim() || null } });
    }
    if (dto.cover) {
      await this.prisma.galleryAlbum.update({ where: { id: photo.albumId }, data: { coverPhotoId: photoId } });
    }
    return this.prisma.galleryPhoto.findUnique({ where: { id: photoId } });
  }

  async removePhoto(photoId: string, clientId: string) {
    const photo = await this.ownedPhoto(photoId, clientId);
    await this.prisma.galleryPhoto.delete({ where: { id: photoId } });
    // A deleted cover falls back to the album's first photo.
    await this.prisma.galleryAlbum.updateMany({ where: { id: photo.albumId, coverPhotoId: photoId }, data: { coverPhotoId: null } });
    for (const url of new Set([photo.fileUrl, photo.thumbUrl])) await unlink(fsPath(url)).catch(() => undefined);
    return { message: 'Photo deleted' };
  }

  // ---- helpers --------------------------------------------------------------

  /**
   * Shrink an upload to a JPEG web copy of at most MAX_STORED_BYTES plus a
   * thumbnail, honouring the camera's orientation and dropping its metadata
   * (EXIF, including GPS location). Without sharp, the file is kept as-is only
   * if it is a JPEG already within the cap.
   */
  private async process(buf: Buffer): Promise<{ main: Buffer; thumb: Buffer | null; width: number | null; height: number | null }> {
    if (!sharp) {
      if (buf.length > MAX_STORED_BYTES) {
        throw new BadRequestException('This photo is over 1 MB. Shrink it and upload again.');
      }
      if (!(buf[0] === 0xff && buf[1] === 0xd8)) throw new BadRequestException('Only JPEG photos can be uploaded right now');
      return { main: buf, thumb: null, width: null, height: null };
    }
    const s = sharp;
    const render = (side: number, quality: number): Promise<Rendered> =>
      s(buf, { failOn: 'none' })
        .rotate()
        .resize({ width: side, height: side, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality, mozjpeg: true })
        .toBuffer({ resolveWithObject: true });

    /** The first pass that fits the cap, or null if none does. */
    const fit = async (): Promise<Rendered | null> => {
      for (const [side, q] of PASSES) {
        const r = await render(side, q);
        if (r.data.length <= MAX_STORED_BYTES) return r;
      }
      return null;
    };
    let main: Rendered | null;
    try {
      main = await fit();
    } catch {
      throw new BadRequestException('This file could not be read as a photo');
    }
    if (!main) throw new BadRequestException('This photo could not be shrunk under 1 MB');
    const thumb = await render(...THUMB);
    return { main: main.data, thumb: thumb.data, width: main.info.width, height: main.info.height };
  }

  private async owned(id: string, clientId: string) {
    const album = await this.prisma.galleryAlbum.findFirst({ where: { id, clientId }, select: { id: true } });
    if (!album) throw new NotFoundException('Album not found');
    return album;
  }

  private async ownedPhoto(photoId: string, clientId: string) {
    const photo = await this.prisma.galleryPhoto.findFirst({ where: { id: photoId, album: { clientId } } });
    if (!photo) throw new NotFoundException('Photo not found');
    return photo;
  }

  /** A linked project or client must be this tenant's own. */
  private async assertContext(clientId: string, projectId?: string | null, customerCompanyId?: string | null) {
    if (projectId && !(await this.prisma.project.count({ where: { id: projectId, clientId } }))) {
      throw new BadRequestException('Project not found');
    }
    if (customerCompanyId && !(await this.prisma.customerCompany.count({ where: { id: customerCompanyId, clientId } }))) {
      throw new BadRequestException('Client not found');
    }
  }
}
