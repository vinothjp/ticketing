import { Module } from '@nestjs/common';
import { ProjectAttachmentsController } from './project-attachments.controller';
import { ProjectAttachmentsService } from './project-attachments.service';

@Module({
  controllers: [ProjectAttachmentsController],
  providers: [ProjectAttachmentsService],
})
export class ProjectAttachmentsModule {}
