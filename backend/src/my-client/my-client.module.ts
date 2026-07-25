import { Module } from '@nestjs/common';
import { MyClientController } from './my-client.controller';
import { ClientsModule } from '../clients/clients.module';

@Module({
  imports: [ClientsModule],
  controllers: [MyClientController],
})
export class MyClientModule {}
