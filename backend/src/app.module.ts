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
import { TemplatesModule } from './templates/templates.module';
import { PicklistsModule } from './picklists/picklists.module';
import { SlaModule } from './sla/sla.module';
import { TicketsModule } from './tickets/tickets.module';
import { TasksModule } from './tasks/tasks.module';
import { ApprovalsModule } from './approvals/approvals.module';
import { MessagingModule } from './messaging/messaging.module';
import { CustomerCompaniesModule } from './customer-companies/customer-companies.module';
import { KbModule } from './kb/kb.module';
import { ProjectsModule } from './projects/projects.module';
import { ResourcesModule } from './resources/resources.module';
import { RegistersModule } from './project-registers/registers.module';
import { ProjectAttachmentsModule } from './project-attachments/project-attachments.module';

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
    TemplatesModule,
    PicklistsModule,
    SlaModule,
    TicketsModule,
    TasksModule,
    ApprovalsModule,
    MessagingModule,
    CustomerCompaniesModule,
    KbModule,
    ProjectsModule,
    ResourcesModule,
    RegistersModule,
    ProjectAttachmentsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
