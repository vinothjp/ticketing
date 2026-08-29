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
import { OptionListsModule } from './option-lists/option-lists.module';
import { SlaModule } from './sla/sla.module';
import { TicketsModule } from './tickets/tickets.module';
import { SearchModule } from './search/search.module';
import { TasksModule } from './tasks/tasks.module';
import { CommentsModule } from './comments/comments.module';
import { ApprovalsModule } from './approvals/approvals.module';
import { MessagingModule } from './messaging/messaging.module';
import { CustomerCompaniesModule } from './customer-companies/customer-companies.module';
import { KbModule } from './kb/kb.module';
import { ProjectsModule } from './projects/projects.module';
import { ResourcesModule } from './resources/resources.module';
import { TimesheetModule } from './timesheet/timesheet.module';
import { ClientVisitsModule } from './client-visits/client-visits.module';
import { RegistersModule } from './project-registers/registers.module';
import { ProjectAttachmentsModule } from './project-attachments/project-attachments.module';
import { ChangeRequestsModule } from './change-requests/change-requests.module';
import { CustomerTeamModule } from './customer-team/customer-team.module';
import { ProjectTemplatesModule } from './project-templates/project-templates.module';
import { ProductsModule } from './products/products.module';
import { NotificationsModule } from './notifications/notifications.module';
import { AssetsModule } from './assets/assets.module';

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
    OptionListsModule,
    SlaModule,
    TicketsModule,
    SearchModule,
    TasksModule,
    CommentsModule,
    ApprovalsModule,
    MessagingModule,
    CustomerCompaniesModule,
    KbModule,
    ProjectsModule,
    ResourcesModule,
    TimesheetModule,
    ClientVisitsModule,
    RegistersModule,
    ProjectAttachmentsModule,
    ChangeRequestsModule,
    CustomerTeamModule,
    ProjectTemplatesModule,
    ProductsModule,
    NotificationsModule,
    AssetsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
