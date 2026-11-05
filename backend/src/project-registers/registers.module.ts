import { Module } from '@nestjs/common';
import { RegistersService } from './registers.service';
import { RegistersController } from './registers.controller';

@Module({
  providers: [RegistersService],
  controllers: [RegistersController],
})
export class RegistersModule {}
