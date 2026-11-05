import { Module } from '@nestjs/common';
import { CustomerTeamService } from './customer-team.service';
import { CustomerTeamController } from './customer-team.controller';

@Module({
  providers: [CustomerTeamService],
  controllers: [CustomerTeamController],
})
export class CustomerTeamModule {}
