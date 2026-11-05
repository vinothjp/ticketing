import { Module } from '@nestjs/common';
import { OptionListsService } from './option-lists.service';
import { OptionListsController } from './option-lists.controller';
import { ChangeRequestsModule } from '../change-requests/change-requests.module';

// Imports ChangeRequestsModule for `CrOptionsService` only — the registry has to
// trigger the CR module's own lazy seeding so value counts are honest.
@Module({
  imports: [ChangeRequestsModule],
  providers: [OptionListsService],
  controllers: [OptionListsController],
  exports: [OptionListsService],
})
export class OptionListsModule {}
