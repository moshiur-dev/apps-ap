import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

interface NotifyInput {
  userId: string;
  actorId?: string;
  workspaceId?: string;
  type: 'ASSIGNED' | 'COMMENT' | 'MENTION' | 'INVITE' | 'ROLE' | 'STATUS';
  title: string;
  body?: string;
  link?: string;
}

/** Writes the activity log and inbox notifications. Never throws. */
@Injectable()
export class EventsService {
  private readonly logger = new Logger(EventsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async log(
    workspaceId: string,
    actorId: string,
    action: string,
    target: string,
    detail = '',
    link = '',
  ) {
    try {
      await this.prisma.activity.create({
        data: { workspaceId, actorId, action, target, detail, link },
      });
    } catch (err) {
      this.logger.warn(`activity log failed: ${(err as Error).message}`);
    }
  }

  async notify(input: NotifyInput) {
    // Don't notify people about their own actions
    if (input.actorId && input.actorId === input.userId) return;
    try {
      await this.prisma.notification.create({
        data: { ...input, body: input.body ?? '', link: input.link ?? '' },
      });
    } catch (err) {
      this.logger.warn(`notification failed: ${(err as Error).message}`);
    }
  }
}
