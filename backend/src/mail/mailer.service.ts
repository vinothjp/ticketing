import { Injectable, BadRequestException } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { PrismaService } from '../prisma/prisma.service';
import { decrypt } from '../lib/encryption';

@Injectable()
export class MailerService {
  constructor(private prisma: PrismaService) {}

  async getTransporter() {
    const config = await this.prisma.smtpConfig.findUnique({ where: { id: 'global' } });
    if (!config?.host || !config.username || !config.passwordEncrypted || !config.enabled) {
      throw new BadRequestException('SMTP is not configured');
    }

    return nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.port === 465,
      requireTLS: config.useTls && config.port !== 465,
      auth: { user: config.username, pass: decrypt(config.passwordEncrypted) },
    });
  }

  async sendMail(options: {
    to: string;
    subject: string;
    html: string;
    text?: string;
    replyTo?: string;
    headers?: Record<string, string>;
    attachments?: { filename: string; path: string }[];
  }): Promise<{ messageId?: string }> {
    const config = await this.prisma.smtpConfig.findUnique({ where: { id: 'global' } });
    const transporter = await this.getTransporter();
    const info = await transporter.sendMail({
      from: config?.fromAddress || config?.username || undefined,
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
      replyTo: options.replyTo,
      headers: options.headers,
      attachments: options.attachments,
    });
    return { messageId: (info as { messageId?: string })?.messageId };
  }

  /** Whether SMTP is configured + enabled (so callers can fall back to a mock channel). */
  async isConfigured(): Promise<boolean> {
    const config = await this.prisma.smtpConfig.findUnique({ where: { id: 'global' } });
    return !!(config?.host && config.username && config.passwordEncrypted && config.enabled);
  }

  async sendPasswordResetEmail(to: string, username: string, resetUrl: string) {
    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto;">
        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 32px; border-radius: 12px 12px 0 0; text-align: center;">
          <h1 style="color: #fff; margin: 0; font-size: 20px;">Password Reset Request</h1>
        </div>
        <div style="background: #fff; padding: 32px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px;">
          <p style="color: #374151; font-size: 14px;">Hi <strong>${username}</strong>,</p>
          <p style="color: #374151; font-size: 14px;">We received a request to reset your password. Click the button below to choose a new one. This link expires in 1 hour.</p>
          <div style="text-align: center; margin: 28px 0;">
            <a href="${resetUrl}" style="background: #4F46E5; color: #fff; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px;">Reset Password</a>
          </div>
          <p style="color: #6b7280; font-size: 12px;">If you didn't request this, you can safely ignore this email.</p>
        </div>
      </div>
    `;
    await this.sendMail({ to, subject: 'Reset your password', html, text: `Reset your password: ${resetUrl}` });
  }
}
