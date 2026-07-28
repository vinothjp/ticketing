import {
  Controller, Get, Post, Body, Param, UseGuards, Request,
  UseInterceptors, UploadedFiles,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { randomUUID } from 'crypto';
import { ChannelService } from './channel.service';
import { SendMessageDto } from './dto/send-message.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../auth/tenant.guard';

type AuthedRequest = { user: { id: string; clientId: string; roles: string[] } };

@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('api/tickets/:ticketId/messages')
export class MessagesController {
  constructor(private channels: ChannelService) {}

  @Get()
  list(@Param('ticketId') ticketId: string, @Request() req: AuthedRequest) {
    return this.channels.listMessages(ticketId, req.user.clientId, req.user);
  }

  @Post()
  @UseInterceptors(
    FilesInterceptor('attachments', 10, {
      storage: diskStorage({
        destination: join(process.cwd(), 'uploads/messages'),
        filename: (req, file, cb) => cb(null, `${randomUUID()}${extname(file.originalname)}`),
      }),
      limits: { fileSize: 5 * 1024 * 1024 },
    }),
  )
  send(
    @Param('ticketId') ticketId: string,
    @Body() dto: SendMessageDto,
    @UploadedFiles() files: Express.Multer.File[],
    @Request() req: AuthedRequest,
  ) {
    return this.channels.sendReply(ticketId, req.user.clientId, dto, files ?? [], req.user, req.user);
  }
}
