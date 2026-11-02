import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

/**
 * Sends email through SMTP when SMTP_HOST is configured.
 * Without SMTP the message is logged and `sent: false` is returned, so the
 * caller can show the invite link to copy instead.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transport: nodemailer.Transporter | null;
  private readonly from: string;

  constructor(config: ConfigService) {
    const host = config.get<string>('SMTP_HOST');
    this.from =
      config.get<string>('MAIL_FROM') ?? 'Canopy <no-reply@canopy.local>';
    this.transport = host
      ? nodemailer.createTransport({
          host,
          port: Number(config.get('SMTP_PORT') ?? 587),
          secure: Number(config.get('SMTP_PORT') ?? 587) === 465,
          auth: {
            user: config.get<string>('SMTP_USER'),
            pass: config.get<string>('SMTP_PASS'),
          },
        })
      : null;
  }

  async send(to: string, subject: string, html: string): Promise<boolean> {
    if (!this.transport) {
      this.logger.log(`[no SMTP configured] email to ${to}: ${subject}`);
      return false;
    }
    try {
      await this.transport.sendMail({ from: this.from, to, subject, html });
      return true;
    } catch (err) {
      this.logger.error(`email to ${to} failed: ${(err as Error).message}`);
      return false;
    }
  }
}
