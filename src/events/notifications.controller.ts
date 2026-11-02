import { Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard, CurrentUser } from '../auth/auth.guard';
import type { AuthUser } from '../auth/auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { AccessService } from '../workspaces/access.service';

const actor = { select: { id: true, name: true, avatarColor: true } };

@Controller()
@UseGuards(AuthGuard)
export class NotificationsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
  ) {}

  @Get('notifications')
  async list(@CurrentUser() user: AuthUser) {
    const [items, unread] = await Promise.all([
      this.prisma.notification.findMany({
        where: { userId: user.sub },
        include: { actor },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
      this.prisma.notification.count({
        where: { userId: user.sub, read: false },
      }),
    ]);
    return { items, unread };
  }

  @Post('notifications/read-all')
  async readAll(@CurrentUser() user: AuthUser) {
    await this.prisma.notification.updateMany({
      where: { userId: user.sub, read: false },
      data: { read: true },
    });
    return { ok: true };
  }

  @Post('notifications/:id/read')
  async read(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.prisma.notification.updateMany({
      where: { id, userId: user.sub },
      data: { read: true },
    });
    return { ok: true };
  }

  @Get('workspaces/:id/activity')
  async activity(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query('take') take?: string,
  ) {
    await this.access.workspace(user.sub, id);
    return this.prisma.activity.findMany({
      where: { workspaceId: id },
      include: { actor },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Number(take) || 100, 300),
    });
  }
}
