import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard, CurrentUser } from '../auth/auth.guard';
import type { AuthUser } from '../auth/auth.guard';
import { EventsService } from '../events/events.service';
import { PrismaService } from '../prisma/prisma.service';
import { AccessService } from '../workspaces/access.service';
import { CommentDto, CreateTaskDto, UpdateTaskDto } from './tasks.dto';

const userSelect = { select: { id: true, name: true, avatarColor: true } };
// On MongoDB a missing field is not the same as null, so match both
const topLevel = {
  OR: [{ parentId: null }, { parentId: { isSet: false } }],
};

const taskInclude = {
  assignee: userSelect,
  list: { select: { id: true, name: true, spaceId: true } },
  _count: { select: { subtasks: true, comments: true } },
};

const STATUS_LABEL: Record<string, string> = {
  TODO: 'To Do',
  IN_PROGRESS: 'In Progress',
  REVIEW: 'Review',
  DONE: 'Complete',
};

const toDate = (v: string | null | undefined) =>
  v === undefined ? undefined : v ? new Date(v) : null;

@Controller()
@UseGuards(AuthGuard)
export class TasksController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly events: EventsService,
  ) {}

  @Get('lists/:id/tasks')
  async byList(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.access.list(user.sub, id);
    return this.prisma.task.findMany({
      where: { listId: id, ...topLevel },
      include: taskInclude,
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    });
  }

  /** All top-level tasks in a workspace — powers Home, Calendar, Dashboard and My Tasks. */
  @Get('workspaces/:id/tasks')
  async byWorkspace(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.access.workspace(user.sub, id);
    const lists = await this.prisma.projectList.findMany({
      where: { space: { workspaceId: id } },
      select: { id: true },
    });
    return this.prisma.task.findMany({
      where: { listId: { in: lists.map((l) => l.id) }, ...topLevel },
      include: taskInclude,
      orderBy: { updatedAt: 'desc' },
    });
  }

  @Post('lists/:id/tasks')
  async create(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: CreateTaskDto,
  ) {
    const list = await this.access.list(user.sub, id, 'MEMBER');
    const wsId = list.space.workspaceId;
    if (dto.assigneeId) await this.assertMember(dto.assigneeId, wsId);
    if (dto.parentId) {
      const parent = await this.access.task(user.sub, dto.parentId);
      if (parent.listId !== id)
        throw new BadRequestException('Parent is in another list');
    }
    const last = await this.prisma.task.findFirst({
      where: { listId: id },
      orderBy: { position: 'desc' },
    });
    const task = await this.prisma.task.create({
      data: {
        title: dto.title,
        description: dto.description ?? '',
        status: dto.status,
        priority: dto.priority,
        startDate: toDate(dto.startDate) ?? null,
        dueDate: toDate(dto.dueDate) ?? null,
        timeEstimate: dto.timeEstimate ?? null,
        assigneeId: dto.assigneeId ?? null,
        parentId: dto.parentId ?? null,
        tags: dto.tags ?? [],
        position: (last?.position ?? 0) + 1000,
        listId: id,
        creatorId: user.sub,
      },
      include: taskInclude,
    });
    const link = `/app/list/${id}?task=${task.id}`;
    await this.events.log(
      wsId,
      user.sub,
      dto.parentId ? 'subtask.created' : 'task.created',
      task.title,
      list.name,
      link,
    );
    if (task.assigneeId)
      await this.notifyAssigned(
        task.assigneeId,
        user.sub,
        wsId,
        task.title,
        link,
      );
    return task;
  }

  @Get('tasks/:id')
  async detail(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.access.task(user.sub, id);
    return this.prisma.task.findUnique({
      where: { id },
      include: {
        ...taskInclude,
        creator: userSelect,
        parent: { select: { id: true, title: true } },
        subtasks: {
          include: { assignee: userSelect },
          orderBy: { position: 'asc' },
        },
        comments: {
          include: { author: userSelect },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
  }

  @Patch('tasks/:id')
  async update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateTaskDto,
  ) {
    const before = await this.access.task(user.sub, id, 'MEMBER');
    const wsId = before.list.space.workspaceId;
    if (dto.assigneeId) await this.assertMember(dto.assigneeId, wsId);
    if (dto.listId && dto.listId !== before.listId) {
      const target = await this.access.list(user.sub, dto.listId, 'MEMBER');
      if (target.space.workspaceId !== wsId)
        throw new BadRequestException('List is in another workspace');
    }
    const task = await this.prisma.task.update({
      where: { id },
      data: {
        ...dto,
        startDate: toDate(dto.startDate),
        dueDate: toDate(dto.dueDate),
      },
      include: taskInclude,
    });

    const link = `/app/list/${task.listId}?task=${task.id}`;
    if (dto.status && dto.status !== before.status) {
      await this.events.log(
        wsId,
        user.sub,
        'task.status',
        task.title,
        `${STATUS_LABEL[before.status]} → ${STATUS_LABEL[dto.status]}`,
        link,
      );
      for (const uid of new Set([before.creatorId, before.assigneeId])) {
        if (uid) {
          await this.events.notify({
            userId: uid,
            actorId: user.sub,
            workspaceId: wsId,
            type: 'STATUS',
            title: `“${task.title}” moved to ${STATUS_LABEL[dto.status]}`,
            link,
          });
        }
      }
    }
    if (dto.assigneeId !== undefined && dto.assigneeId !== before.assigneeId) {
      const who = task.assignee?.name ?? 'nobody';
      await this.events.log(
        wsId,
        user.sub,
        'task.assigned',
        task.title,
        `to ${who}`,
        link,
      );
      if (dto.assigneeId)
        await this.notifyAssigned(
          dto.assigneeId,
          user.sub,
          wsId,
          task.title,
          link,
        );
    }
    if (dto.priority && dto.priority !== before.priority) {
      await this.events.log(
        wsId,
        user.sub,
        'task.priority',
        task.title,
        dto.priority.toLowerCase(),
        link,
      );
    }
    if (
      dto.dueDate !== undefined &&
      String(task.dueDate) !== String(before.dueDate)
    ) {
      await this.events.log(
        wsId,
        user.sub,
        'task.due',
        task.title,
        task.dueDate ? task.dueDate.toISOString().slice(0, 10) : 'removed',
        link,
      );
    }
    return task;
  }

  @Delete('tasks/:id')
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const task = await this.access.task(user.sub, id, 'MEMBER');
    const subs = await this.prisma.task.findMany({
      where: { parentId: id },
      select: { id: true },
    });
    const ids = [id, ...subs.map((s) => s.id)];
    await this.prisma.comment.deleteMany({ where: { taskId: { in: ids } } });
    await this.prisma.task.deleteMany({ where: { parentId: id } });
    await this.prisma.task.delete({ where: { id } });
    await this.events.log(
      task.list.space.workspaceId,
      user.sub,
      'task.deleted',
      task.title,
      task.list.name,
    );
    return { ok: true };
  }

  /** Guests can comment too. @FirstName mentions notify that member. */
  @Post('tasks/:id/comments')
  async comment(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: CommentDto,
  ) {
    const task = await this.access.task(user.sub, id, 'GUEST');
    const wsId = task.list.space.workspaceId;
    const comment = await this.prisma.comment.create({
      data: { body: dto.body, taskId: id, authorId: user.sub },
      include: { author: userSelect },
    });
    const link = `/app/list/${task.listId}?task=${id}`;
    const preview =
      dto.body.length > 120 ? `${dto.body.slice(0, 117)}…` : dto.body;
    await this.events.log(
      wsId,
      user.sub,
      'comment.added',
      task.title,
      preview,
      link,
    );

    const members = await this.prisma.workspaceMember.findMany({
      where: { workspaceId: wsId },
      include: { user: { select: { id: true, name: true } } },
    });
    const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const mentioned = new Set(
      members
        .filter((m) =>
          new RegExp(`@${escapeRe(m.user.name.split(' ')[0])}\\b`, 'i').test(
            dto.body,
          ),
        )
        .map((m) => m.user.id),
    );
    for (const uid of mentioned) {
      await this.events.notify({
        userId: uid,
        actorId: user.sub,
        workspaceId: wsId,
        type: 'MENTION',
        title: `${comment.author.name} mentioned you on “${task.title}”`,
        body: preview,
        link,
      });
    }
    for (const uid of new Set([task.creatorId, task.assigneeId])) {
      if (uid && !mentioned.has(uid)) {
        await this.events.notify({
          userId: uid,
          actorId: user.sub,
          workspaceId: wsId,
          type: 'COMMENT',
          title: `${comment.author.name} commented on “${task.title}”`,
          body: preview,
          link,
        });
      }
    }
    return comment;
  }

  private async notifyAssigned(
    userId: string,
    actorId: string,
    workspaceId: string,
    title: string,
    link: string,
  ) {
    await this.events.notify({
      userId,
      actorId,
      workspaceId,
      type: 'ASSIGNED',
      title: `You were assigned “${title}”`,
      link,
    });
  }

  private async assertMember(userId: string, workspaceId: string) {
    const m = await this.prisma.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId, workspaceId } },
    });
    if (!m) throw new BadRequestException('Assignee is not in this workspace');
  }
}
