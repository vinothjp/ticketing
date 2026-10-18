import { Module } from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { ProjectsController } from './projects.controller';
import { CommunicationsModule } from '../communications/communications.module';

@Module({
  imports: [CommunicationsModule], // "Announce this?" suggestions on project events
  providers: [ProjectsService],
  controllers: [ProjectsController],
})
export class ProjectsModule {}
