import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  GoneException,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'crypto';
import { AuthGuard, CurrentUser } from '../auth/auth.guard';
import type { AuthUser } from '../auth/auth.guard';
import { EventsService } from '../events/events.service';
import { MailService } from '../events/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { AccessService } from './access.service';
import { InviteDto } from './workspaces.dto';

const INVITE_DAYS = 7;
const hash = (token: string) =>
  createHash('sha256').update(token).digest('hex');
const escape = (s: string) =>
  s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

@Controller()
export class InvitesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly events: EventsService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  private newToken() {
    const token = randomBytes(32).toString('base64url');
    return {
      token,
      tokenHash: hash(token),
      expiresAt: new Date(Date.now() + INVITE_DAYS * 86400000),
    };
  }

  private link(token: string) {
    const web =
      this.config.get<string>('WEB_URL') ??
      (this.config.get<string>('WEB_ORIGIN') ?? 'http://localhost:3000').split(
        ',',
      )[0];
    return `${web}/invite/${token}`;
  }

  /** Emails the invite and drops a notification if the person already has an account. */
  private async deliver(
    invite: { email: string; role: string; workspaceId: string },
    token: string,
    inviterId: string,
  ) {
    const [ws, inviter, existing] = await Promise.all([
      this.prisma.workspace.findUnique({ where: { id: invite.workspaceId } }),
      this.prisma.user.findUnique({ where: { id: inviterId } }),
      this.prisma.user.findUnique({ where: { email: invite.email } }),
    ]);
    const url = this.link(token);
    const wsName = escape(ws?.name ?? 'a workspace');
    const who = escape(inviter?.name ?? 'Someone');
    const emailed = await this.mail.send(
      invite.email,
      `${inviter?.name ?? 'Someone'} invited you to ${ws?.name} on Canopy`,
      `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;padding:32px;background:#0b1510;color:#e6efe8;border-radius:16px">
        <h2 style="margin:0 0 12px;color:#34d399">You're invited 🌲</h2>
        <p><b>${who}</b> invited you to join <b>${wsName}</b> as <b>${invite.role.toLowerCase()}</b>.</p>
        <p style="margin:28px 0"><a href="${url}" style="background:#10b981;color:#04130b;padding:12px 22px;border-radius:10px;text-decoration:none;font-weight:bold">Accept invitation</a></p>
        <p style="font-size:12px;color:#8aa595">This link expires in ${INVITE_DAYS} days. If you weren't expecting it, ignore this email.</p>
      </div>`,
    );
    if (existing) {
      await this.events.notify({
        userId: existing.id,
        actorId: inviterId,
        workspaceId: invite.workspaceId,
        type: 'INVITE',
        title: `${inviter?.name} invited you to ${ws?.name}`,
        body: `Join as ${invite.role.toLowerCase()}`,
        link: `/invite/${token}`,
      });
    }
    return { emailed, link: url };
  }

  @Get('workspaces/:id/invites')
  @UseGuards(AuthGuard)
  async list(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.access.workspace(user.sub, id, 'ADMIN');
    return this.prisma.invite.findMany({
      where: { workspaceId: id, status: 'PENDING' },
      select: {
        id: true,
        email: true,
        role: true,
        expiresAt: true,
        createdAt: true,
        invitedBy: { select: { id: true, name: true, avatarColor: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  @Post('workspaces/:id/invites')
  @UseGuards(AuthGuard)
  async create(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: InviteDto,
  ) {
    const me = await this.access.workspace(user.sub, id, 'ADMIN');
    if (dto.role === 'ADMIN' && me.role !== 'OWNER') {
      throw new ForbiddenException('Only the owner can invite admins');
    }
    const email = dto.email.toLowerCase().trim();
    const already = await this.prisma.workspaceMember.findFirst({
      where: { workspaceId: id, user: { email } },
    });
    if (already)
      throw new BadRequestException('This person is already a member');

    // One live invite per email: a re-invite replaces the old link
    await this.prisma.invite.updateMany({
      where: { workspaceId: id, email, status: 'PENDING' },
      data: { status: 'REVOKED' },
    });
    const { token, tokenHash, expiresAt } = this.newToken();
    const invite = await this.prisma.invite.create({
      data: {
        email,
        role: dto.role,
        tokenHash,
        expiresAt,
        workspaceId: id,
        invitedById: user.sub,
      },
      select: { id: true, email: true, role: true, expiresAt: true },
    });
    const sent = await this.deliver(
      { ...invite, workspaceId: id },
      token,
      user.sub,
    );
    await this.events.log(
      id,
      user.sub,
      'invite.sent',
      email,
      dto.role,
      '/app/members',
    );
    return { invite, ...sent };
  }

  @Post('invites/:id/resend')
  @UseGuards(AuthGuard)
  async resend(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const invite = await this.prisma.invite.findUnique({ where: { id } });
    if (!invite || invite.status !== 'PENDING')
      throw new NotFoundException('Invite not found');
    await this.access.workspace(user.sub, invite.workspaceId, 'ADMIN');
    const { token, tokenHash, expiresAt } = this.newToken();
    await this.prisma.invite.update({
      where: { id },
      data: { tokenHash, expiresAt },
    });
    return this.deliver(invite, token, user.sub);
  }

  @Delete('invites/:id')
  @UseGuards(AuthGuard)
  async revoke(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const invite = await this.prisma.invite.findUnique({ where: { id } });
    if (!invite) throw new NotFoundException('Invite not found');
    await this.access.workspace(user.sub, invite.workspaceId, 'ADMIN');
    await this.prisma.invite.update({
      where: { id },
      data: { status: 'REVOKED' },
    });
    await this.events.log(
      invite.workspaceId,
      user.sub,
      'invite.revoked',
      invite.email,
    );
    return { ok: true };
  }

  /** Public: lets the invite page show who invited you before you sign in. */
  @Get('invites/token/:token')
  async preview(@Param('token') token: string) {
    const invite = await this.prisma.invite.findUnique({
      where: { tokenHash: hash(token) },
      include: {
        workspace: { select: { name: true, color: true } },
        invitedBy: { select: { name: true, avatarColor: true } },
      },
    });
    if (!invite || invite.status === 'REVOKED')
      throw new NotFoundException('This invite link is invalid');
    return {
      email: invite.email,
      role: invite.role,
      status: invite.status,
      expired: invite.expiresAt < new Date(),
      workspace: invite.workspace,
      invitedBy: invite.invitedBy,
    };
  }

  @Post('invites/token/:token/accept')
  @UseGuards(AuthGuard)
  async accept(@CurrentUser() user: AuthUser, @Param('token') token: string) {
    const invite = await this.prisma.invite.findUnique({
      where: { tokenHash: hash(token) },
    });
    if (!invite || invite.status === 'REVOKED')
      throw new NotFoundException('This invite link is invalid');
    if (invite.status === 'ACCEPTED')
      throw new GoneException('This invite was already used');
    if (invite.expiresAt < new Date())
      throw new GoneException('This invite has expired — ask for a new one');
    const me = await this.prisma.user.findUnique({ where: { id: user.sub } });
    if (me?.email !== invite.email) {
      throw new ForbiddenException(
        `This invite was sent to ${invite.email}. Sign in with that email to accept it.`,
      );
    }

    await this.prisma.workspaceMember.upsert({
      where: {
        userId_workspaceId: {
          userId: user.sub,
          workspaceId: invite.workspaceId,
        },
      },
      create: {
        userId: user.sub,
        workspaceId: invite.workspaceId,
        role: invite.role,
      },
      update: {},
    });
    await this.prisma.invite.update({
      where: { id: invite.id },
      data: { status: 'ACCEPTED', acceptedAt: new Date() },
    });
    await this.events.log(
      invite.workspaceId,
      user.sub,
      'member.joined',
      me.name,
      invite.role,
      '/app/members',
    );
    await this.events.notify({
      userId: invite.invitedById,
      actorId: user.sub,
      workspaceId: invite.workspaceId,
      type: 'INVITE',
      title: `${me.name} accepted your invite`,
      body: `Joined as ${invite.role.toLowerCase()}`,
      link: '/app/members',
    });
    return { workspaceId: invite.workspaceId };
  }
}
