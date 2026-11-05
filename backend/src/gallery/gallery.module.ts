import { Module } from '@nestjs/common';
import { GalleryService } from './gallery.service';
import { GalleryController } from './gallery.controller';

@Module({
  providers: [GalleryService],
  controllers: [GalleryController],
  exports: [GalleryService], // the album → announcement step reads albums from here
})
export class GalleryModule {}
