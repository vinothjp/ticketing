import { Module } from '@nestjs/common';
import { ProjectTemplatesService } from './project-templates.service';
import { ProjectTemplatesController } from './project-templates.controller';

@Module({
  providers: [ProjectTemplatesService],
  controllers: [ProjectTemplatesController],
})
export class ProjectTemplatesModule {}
