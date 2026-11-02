import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard, CurrentUser } from '../auth/auth.guard';
import type { AuthUser } from '../auth/auth.guard';
import { EventsService } from '../events/events.service';
import { PrismaService } from '../prisma/prisma.service';
import { AccessService } from './access.service';
import {
  CreateListDto,
  MoveListDto,
  NameDto,
  RenameDto,
  RoleDto,
} from './workspaces.dto';

const byCreated = { orderBy: { createdAt: 'asc' as const } };
const tree = {
  spaces: {
    ...byCreated,
    include: {
      folders: { ...byCreated, include: { lists: byCreated } },
      lists: byCreated,
    },
  },
};
const userCard = {
  select: { id: true, name: true, email: true, avatarColor: true },
};

@Controller()
@UseGuards(AuthGuard)
export class WorkspacesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly events: EventsService,
  ) {}

  /** Deletes tasks (and their comments) in the given lists. */
  private async purgeLists(listIds: string[]) {
    if (!listIds.length) return;
    const where = { listId: { in: listIds } };
    const tasks = await this.prisma.task.findMany({
      where,
      select: { id: true },
    });
    await this.prisma.comment.deleteMany({
      where: { taskId: { in: tasks.map((t) => t.id) } },
    });
    // Detach subtasks first so the self-relation never blocks the delete
    await this.prisma.task.updateMany({ where, data: { parentId: null } });
    await this.prisma.task.deleteMany({ where });
    await this.prisma.projectList.deleteMany({
      where: { id: { in: listIds } },
    });
  }

  // ---------- Workspaces ----------

  @Get('workspaces')
  async mine(@CurrentUser() user: AuthUser) {
    const memberships = await this.prisma.workspaceMember.findMany({
      where: { userId: user.sub },
      include: { workspace: { include: tree } },
      orderBy: { createdAt: 'asc' },
    });
    return memberships.map((m) => ({ ...m.workspace, role: m.role }));
  }

  @Post('workspaces')
  async create(@CurrentUser() user: AuthUser, @Body() dto: NameDto) {
    const ws = await this.prisma.workspace.create({
      data: {
        name: dto.name,
        color: dto.color,
        memberships: { create: { userId: user.sub, role: 'OWNER' } },
        spaces: {
          create: {
            name: 'Team Space',
            lists: { create: [{ name: 'Tasks' }] },
          },
        },
      },
      include: tree,
    });
    await this.events.log(ws.id, user.sub, 'workspace.created', ws.name);
    return { ...ws, role: 'OWNER' };
  }

  @Patch('workspaces/:id')
  async rename(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: RenameDto,
  ) {
    await this.access.workspace(user.sub, id, 'ADMIN');
    const ws = await this.prisma.workspace.update({ where: { id }, data: dto });
    await this.events.log(id, user.sub, 'workspace.updated', ws.name);
    return ws;
  }

  @Delete('workspaces/:id')
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.access.workspace(user.sub, id, 'OWNER');
    const spaces = await this.prisma.space.findMany({
      where: { workspaceId: id },
      include: { lists: { select: { id: true } } },
    });
    await this.purgeLists(spaces.flatMap((s) => s.lists.map((l) => l.id)));
    const spaceIds = spaces.map((s) => s.id);
    await this.prisma.folder.deleteMany({
      where: { spaceId: { in: spaceIds } },
    });
    await this.prisma.space.deleteMany({ where: { workspaceId: id } });
    await this.prisma.invite.deleteMany({ where: { workspaceId: id } });
    await this.prisma.activity.deleteMany({ where: { workspaceId: id } });
    await this.prisma.workspaceMember.deleteMany({
      where: { workspaceId: id },
    });
    await this.prisma.workspace.delete({ where: { id } });
    return { ok: true };
  }

  // ---------- Members ----------

  @Get('workspaces/:id/members')
  async members(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.access.workspace(user.sub, id);
    const members = await this.prisma.workspaceMember.findMany({
      where: { workspaceId: id },
      include: { user: userCard },
      orderBy: { createdAt: 'asc' },
    });
    return members.map((m) => ({
      ...m.user,
      role: m.role,
      joinedAt: m.createdAt,
    }));
  }

  @Patch('workspaces/:id/members/:userId')
  async changeRole(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('userId') userId: string,
    @Body() dto: RoleDto,
  ) {
    const me = await this.access.workspace(user.sub, id, 'ADMIN');
    const target = await this.findMember(id, userId);
    if (userId === user.sub)
      throw new BadRequestException("You can't change your own role");
    if (target.role === 'OWNER')
      throw new ForbiddenException("The owner's role can't be changed");
    // Only the owner can create or demote admins
    if (
      me.role !== 'OWNER' &&
      (dto.role === 'ADMIN' || target.role === 'ADMIN')
    ) {
      throw new ForbiddenException('Only the owner can manage admins');
    }
    await this.prisma.workspaceMember.update({
      where: { id: target.id },
      data: { role: dto.role },
    });
    const ws = await this.prisma.workspace.findUnique({ where: { id } });
    await this.events.log(
      id,
      user.sub,
      'member.role_changed',
      target.user.name,
      `${target.role} → ${dto.role}`,
      '/app/members',
    );
    await this.events.notify({
      userId,
      actorId: user.sub,
      workspaceId: id,
      type: 'ROLE',
      title: `Your role in ${ws?.name} is now ${dto.role.toLowerCase()}`,
      link: '/app/members',
    });
    return { ok: true };
  }

  @Delete('workspaces/:id/members/:userId')
  async removeMember(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('userId') userId: string,
  ) {
    const leaving = userId === user.sub;
    const me = await this.access.workspace(
      user.sub,
      id,
      leaving ? 'GUEST' : 'ADMIN',
    );
    const target = await this.findMember(id, userId);
    if (target.role === 'OWNER') {
      throw new ForbiddenException(
        leaving
          ? 'The owner cannot leave — delete the workspace instead'
          : 'The owner cannot be removed',
      );
    }
    if (!leaving && target.role === 'ADMIN' && me.role !== 'OWNER') {
      throw new ForbiddenException('Only the owner can remove admins');
    }
    await this.prisma.workspaceMember.delete({ where: { id: target.id } });
    await this.prisma.task.updateMany({
      where: { assigneeId: userId, list: { space: { workspaceId: id } } },
      data: { assigneeId: null },
    });
    await this.events.log(
      id,
      user.sub,
      leaving ? 'member.left' : 'member.removed',
      target.user.name,
      '',
      '/app/members',
    );
    return { ok: true };
  }

  private async findMember(workspaceId: string, userId: string) {
    const m = await this.prisma.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId, workspaceId } },
      include: { user: true },
    });
    if (!m) throw new NotFoundException('Member not found');
    return m;
  }

  // ---------- Spaces ----------

  @Post('workspaces/:id/spaces')
  async createSpace(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: NameDto,
  ) {
    await this.access.workspace(user.sub, id, 'ADMIN');
    const space = await this.prisma.space.create({
      data: { name: dto.name, color: dto.color, workspaceId: id },
    });
    await this.events.log(id, user.sub, 'space.created', space.name);
    return space;
  }

  @Patch('spaces/:id')
  async updateSpace(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: RenameDto,
  ) {
    await this.access.space(user.sub, id, 'ADMIN');
    return this.prisma.space.update({ where: { id }, data: dto });
  }

  @Delete('spaces/:id')
  async deleteSpace(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const space = await this.access.space(user.sub, id, 'ADMIN');
    const lists = await this.prisma.projectList.findMany({
      where: { spaceId: id },
    });
    await this.purgeLists(lists.map((l) => l.id));
    await this.prisma.folder.deleteMany({ where: { spaceId: id } });
    await this.prisma.space.delete({ where: { id } });
    await this.events.log(
      space.workspaceId,
      user.sub,
      'space.deleted',
      space.name,
    );
    return { ok: true };
  }

  // ---------- Folders ----------

  @Post('spaces/:id/folders')
  async createFolder(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: NameDto,
  ) {
    const space = await this.access.space(user.sub, id, 'MEMBER');
    const folder = await this.prisma.folder.create({
      data: { name: dto.name, spaceId: id },
    });
    await this.events.log(
      space.workspaceId,
      user.sub,
      'folder.created',
      folder.name,
      space.name,
    );
    return folder;
  }

  @Patch('folders/:id')
  async renameFolder(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: RenameDto,
  ) {
    await this.access.folder(user.sub, id, 'MEMBER');
    return this.prisma.folder.update({
      where: { id },
      data: { name: dto.name },
    });
  }

  @Delete('folders/:id')
  async deleteFolder(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const folder = await this.access.folder(user.sub, id, 'ADMIN');
    const lists = await this.prisma.projectList.findMany({
      where: { folderId: id },
    });
    await this.purgeLists(lists.map((l) => l.id));
    await this.prisma.folder.delete({ where: { id } });
    await this.events.log(
      folder.space.workspaceId,
      user.sub,
      'folder.deleted',
      folder.name,
    );
    return { ok: true };
  }

  // ---------- Lists ----------

  @Post('spaces/:id/lists')
  async createList(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: CreateListDto,
  ) {
    const space = await this.access.space(user.sub, id, 'MEMBER');
    if (dto.folderId) {
      const folder = await this.prisma.folder.findUnique({
        where: { id: dto.folderId },
      });
      if (folder?.spaceId !== id)
        throw new BadRequestException('Folder is in another space');
    }
    const list = await this.prisma.projectList.create({
      data: { name: dto.name, spaceId: id, folderId: dto.folderId ?? null },
    });
    await this.events.log(
      space.workspaceId,
      user.sub,
      'list.created',
      list.name,
      space.name,
      `/app/list/${list.id}`,
    );
    return list;
  }

  @Patch('lists/:id')
  async updateList(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: MoveListDto,
  ) {
    const list = await this.access.list(user.sub, id, 'MEMBER');
    if (dto.folderId) {
      const folder = await this.prisma.folder.findUnique({
        where: { id: dto.folderId },
      });
      if (folder?.spaceId !== list.spaceId)
        throw new BadRequestException('Folder is in another space');
    }
    return this.prisma.projectList.update({
      where: { id },
      data: { name: dto.name, folderId: dto.folderId },
    });
  }

  @Delete('lists/:id')
  async deleteList(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const list = await this.access.list(user.sub, id, 'ADMIN');
    await this.purgeLists([id]);
    await this.events.log(
      list.space.workspaceId,
      user.sub,
      'list.deleted',
      list.name,
    );
    return { ok: true };
  }

  // ---------- Search ----------

  @Get('workspaces/:id/search')
  async search(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query('q') q = '',
  ) {
    await this.access.workspace(user.sub, id);
    const term = q.trim();
    if (term.length < 2) return { tasks: [], lists: [], members: [] };
    const contains = { contains: term, mode: 'insensitive' as const };
    const spaces = await this.prisma.space.findMany({
      where: { workspaceId: id },
      include: { lists: true },
    });
    const listIds = spaces.flatMap((s) => s.lists.map((l) => l.id));
    const [tasks, members] = await Promise.all([
      this.prisma.task.findMany({
        where: {
          listId: { in: listIds },
          OR: [{ title: contains }, { description: contains }],
        },
        select: {
          id: true,
          title: true,
          status: true,
          list: { select: { name: true } },
        },
        take: 8,
      }),
      this.prisma.workspaceMember.findMany({
        where: {
          workspaceId: id,
          user: { OR: [{ name: contains }, { email: contains }] },
        },
        include: { user: userCard },
        take: 5,
      }),
    ]);
    const lower = term.toLowerCase();
    const lists = spaces
      .flatMap((s) =>
        s.lists.map((l) => ({ id: l.id, name: l.name, space: s.name })),
      )
      .filter((l) => l.name.toLowerCase().includes(lower))
      .slice(0, 5);
    return {
      tasks,
      lists,
      members: members.map((m) => ({ ...m.user, role: m.role })),
    };
  }
}
