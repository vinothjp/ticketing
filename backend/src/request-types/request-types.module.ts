import { Module } from '@nestjs/common';
import { RequestTypesService } from './request-types.service';
import { RequestTypesController } from './request-types.controller';

@Module({
  providers: [RequestTypesService],
  controllers: [RequestTypesController],
  exports: [RequestTypesService],
})
export class RequestTypesModule {}
