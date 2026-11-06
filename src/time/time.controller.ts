import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard, CurrentUser } from '../auth/auth.guard';
import type { AuthUser } from '../auth/auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { AccessService } from '../workspaces/access.service';
import { ManualTimeDto } from './time.dto';

const userSelect = { select: { id: true, name: true, avatarColor: true } };

/**
 * Time tracking. A user can run one timer at a time across all tasks;
 * starting a new timer stops the previous one.
 */
@Controller()
@UseGuards(AuthGuard)
export class TimeController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
  ) {}

  /** Entries for a task (newest first) plus the total in seconds. */
  @Get('tasks/:id/time')
  async list(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.access.task(user.sub, id);
    const entries = await this.prisma.timeEntry.findMany({
      where: { taskId: id },
      include: { user: userSelect },
      orderBy: { startedAt: 'desc' },
    });
    const now = Date.now();
    const total = entries.reduce(
      (sum, e) =>
        sum +
        (e.endedAt
          ? e.durationSec
          : Math.max(0, Math.floor((now - e.startedAt.getTime()) / 1000))),
      0,
    );
    return { entries, totalSec: total };
  }

  /** The timer this user has running, if any. */
  @Get('time/running')
  async running(@CurrentUser() user: AuthUser) {
    return this.prisma.timeEntry.findFirst({
      where: { userId: user.sub, endedAt: null },
      include: { task: { select: { id: true, title: true, listId: true } } },
    });
  }

  @Post('tasks/:id/time/start')
  async start(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.access.task(user.sub, id, 'MEMBER');
    await this.stopRunning(user.sub);
    return this.prisma.timeEntry.create({
      data: { taskId: id, userId: user.sub, startedAt: new Date() },
      include: { user: userSelect },
    });
  }

  @Post('tasks/:id/time/stop')
  async stop(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.access.task(user.sub, id, 'MEMBER');
    const stopped = await this.stopRunning(user.sub, id);
    if (!stopped) throw new NotFoundException('No timer is running on this task');
    return stopped;
  }

  /** Add time after the fact, e.g. "I spent 45 minutes on this yesterday". */
  @Post('tasks/:id/time')
  async manual(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: ManualTimeDto,
  ) {
    await this.access.task(user.sub, id, 'MEMBER');
    const end = dto.date ? new Date(dto.date) : new Date();
    const start = new Date(end.getTime() - dto.minutes * 60_000);
    return this.prisma.timeEntry.create({
      data: {
        taskId: id,
        userId: user.sub,
        startedAt: start,
        endedAt: end,
        durationSec: dto.minutes * 60,
        note: dto.note ?? '',
      },
      include: { user: userSelect },
    });
  }

  /** Remove an entry. Members can delete their own; admins can delete anyone's. */
  @Delete('time/:entryId')
  async remove(@CurrentUser() user: AuthUser, @Param('entryId') entryId: string) {
    const entry = await this.prisma.timeEntry.findUnique({
      where: { id: entryId },
      include: { task: { include: { list: { include: { space: true } } } } },
    });
    if (!entry) throw new NotFoundException('Time entry not found');
    if (entry.userId !== user.sub) {
      await this.access.workspace(
        user.sub,
        entry.task.list.space.workspaceId,
        'ADMIN',
      ).catch(() => {
        throw new ForbiddenException("You can only delete your own time entries");
      });
    }
    await this.prisma.timeEntry.delete({ where: { id: entryId } });
    return { ok: true };
  }

  /** Closes the user's running timer (on a given task, or any task). */
  private async stopRunning(userId: string, taskId?: string) {
    const running = await this.prisma.timeEntry.findFirst({
      where: { userId, endedAt: null, ...(taskId ? { taskId } : {}) },
    });
    if (!running) return null;
    const endedAt = new Date();
    const durationSec = Math.max(
      0,
      Math.floor((endedAt.getTime() - running.startedAt.getTime()) / 1000),
    );
    return this.prisma.timeEntry.update({
      where: { id: running.id },
      data: { endedAt, durationSec },
      include: { user: userSelect },
    });
  }
}
