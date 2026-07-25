import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { RolesModule } from './roles/roles.module';
import { FormsModule } from './forms/forms.module';
import { PermissionsModule } from './permissions/permissions.module';
import { ClientsModule } from './clients/clients.module';
import { SmtpModule } from './smtp/smtp.module';
import { MyClientModule } from './my-client/my-client.module';
import { RequestTypesModule } from './request-types/request-types.module';
import { TemplatesModule } from './templates/templates.module';
import { PicklistsModule } from './picklists/picklists.module';
import { TicketsModule } from './tickets/tickets.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    UsersModule,
    RolesModule,
    FormsModule,
    PermissionsModule,
    ClientsModule,
    SmtpModule,
    MyClientModule,
    RequestTypesModule,
    TemplatesModule,
    PicklistsModule,
    TicketsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
