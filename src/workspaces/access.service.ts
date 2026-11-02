import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export const ROLES = ['OWNER', 'ADMIN', 'MEMBER', 'GUEST'] as const;
export type Role = (typeof ROLES)[number];

const RANK: Record<Role, number> = { OWNER: 4, ADMIN: 3, MEMBER: 2, GUEST: 1 };

export const atLeast = (role: string, min: Role) =>
  (RANK[role as Role] ?? 0) >= RANK[min];

/**
 * Central place for "can this user touch this resource?" checks.
 *
 * GUEST  – view everything, comment
 * MEMBER – + create/edit/delete tasks, create folders & lists
 * ADMIN  – + manage spaces, folders, lists, members and invites
 * OWNER  – + rename/delete workspace, make admins
 */
@Injectable()
export class AccessService {
  constructor(private readonly prisma: PrismaService) {}

  async workspace(userId: string, workspaceId: string, min: Role = 'GUEST') {
    const member = await this.prisma.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId, workspaceId } },
    });
    if (!member) throw new ForbiddenException('Not a member of this workspace');
    if (!atLeast(member.role, min)) {
      throw new ForbiddenException(
        `This action needs the ${min.toLowerCase()} role or higher`,
      );
    }
    return member;
  }

  async space(userId: string, spaceId: string, min: Role = 'GUEST') {
    const space = await this.prisma.space.findUnique({
      where: { id: spaceId },
    });
    if (!space) throw new NotFoundException('Space not found');
    const member = await this.workspace(userId, space.workspaceId, min);
    return { ...space, member };
  }

  async folder(userId: string, folderId: string, min: Role = 'GUEST') {
    const folder = await this.prisma.folder.findUnique({
      where: { id: folderId },
      include: { space: true },
    });
    if (!folder) throw new NotFoundException('Folder not found');
    await this.workspace(userId, folder.space.workspaceId, min);
    return folder;
  }

  async list(userId: string, listId: string, min: Role = 'GUEST') {
    const list = await this.prisma.projectList.findUnique({
      where: { id: listId },
      include: { space: true },
    });
    if (!list) throw new NotFoundException('List not found');
    await this.workspace(userId, list.space.workspaceId, min);
    return list;
  }

  async task(userId: string, taskId: string, min: Role = 'GUEST') {
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      include: { list: { include: { space: true } } },
    });
    if (!task) throw new NotFoundException('Task not found');
    await this.workspace(userId, task.list.space.workspaceId, min);
    return task;
  }
}
