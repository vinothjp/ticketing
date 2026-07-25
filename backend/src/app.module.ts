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
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
