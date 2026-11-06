import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'crypto';
import { MailService } from '../events/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto, RegisterDto } from './auth.dto';

const AVATAR_COLORS = ['#2f855a', '#276749', '#b7791f', '#2c7a7b', '#975a16'];
const VERIFY_HOURS = 24;

const sha256 = (t: string) => createHash('sha256').update(t).digest('hex');
const escape = (s: string) =>
  s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  async register(dto: RegisterDto) {
    const email = dto.email.toLowerCase().trim();
    const exists = await this.prisma.user.findUnique({ where: { email } });
    if (exists) throw new ConflictException('Email is already registered');

    // An invite sent to this exact address already proves ownership of it
    const invite = dto.inviteToken
      ? await this.prisma.invite.findUnique({
          where: { tokenHash: sha256(dto.inviteToken) },
        })
      : null;
    const inviteOk =
      !!invite &&
      invite.status === 'PENDING' &&
      invite.expiresAt > new Date() &&
      invite.email === email;

    const user = await this.prisma.user.create({
      data: {
        name: dto.name.trim(),
        email,
        passwordHash: await bcrypt.hash(dto.password, 12),
        avatarColor:
          AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)],
        emailVerifiedAt: inviteOk ? new Date() : null,
      },
    });

    // Every new user starts with a ready-to-use workspace
    const ws = await this.prisma.workspace.create({
      data: {
        name: `${user.name.split(' ')[0]}'s Workspace`,
        memberships: { create: { userId: user.id, role: 'OWNER' } },
        spaces: {
          create: {
            name: 'Team Space',
            lists: { create: [{ name: 'Getting Started' }] },
          },
        },
      },
    });
    await this.prisma.activity.create({
      data: {
        workspaceId: ws.id,
        actorId: user.id,
        action: 'workspace.created',
        target: ws.name,
      },
    });

    if (inviteOk) return this.issue(user);

    // No session until the email address is confirmed
    const sent = await this.sendVerification(user);
    return { verificationRequired: true, email, ...sent };
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase().trim() },
    });
    if (!user || !(await bcrypt.compare(dto.password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid email or password');
    }
    if (!user.emailVerifiedAt) {
      throw new ForbiddenException(
        'Please verify your email before signing in. Check your inbox, or ask for a new link.',
      );
    }
    return this.issue(user);
  }

  /** Confirms the address from the emailed link and signs the user in. */
  async verify(token: string) {
    const user = await this.prisma.user.findUnique({
      where: { verifyTokenHash: sha256(token) },
    });
    if (!user || !user.verifyExpiresAt) {
      throw new BadRequestException('This verification link is invalid.');
    }
    if (user.verifyExpiresAt < new Date()) {
      throw new BadRequestException(
        'This verification link has expired. Ask for a new one.',
      );
    }
    const verified = await this.prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerifiedAt: new Date(),
        verifyTokenHash: null,
        verifyExpiresAt: null,
      },
    });
    return this.issue(verified);
  }

  /** Always answers the same way, so it can't be used to discover accounts. */
  async resend(email: string) {
    const user = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
    });
    if (user && !user.emailVerifiedAt) await this.sendVerification(user);
    return {
      ok: true,
      message: 'If that account is waiting for verification, a new link is on its way.',
    };
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();
    return this.publicUser(user);
  }

  /** Creates a one-time token, emails it, and returns the link when email isn't set up (dev only). */
  private async sendVerification(user: { id: string; email: string; name: string }) {
    const token = randomBytes(32).toString('base64url');
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        verifyTokenHash: sha256(token),
        verifyExpiresAt: new Date(Date.now() + VERIFY_HOURS * 3600_000),
      },
    });
    const web = (
      this.config.get<string>('WEB_URL') ??
      this.config.get<string>('WEB_ORIGIN') ??
      'http://localhost:3000'
    ).split(',')[0];
    const url = `${web.replace(/\/$/, '')}/verify?token=${token}`;
    const emailed = await this.mail.send(
      user.email,
      'Confirm your email for Canopy',
      `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;padding:32px;background:#0b1510;color:#e6efe8;border-radius:16px">
        <h2 style="margin:0 0 12px;color:#34d399">Welcome, ${escape(user.name)} 🌲</h2>
        <p>Confirm your email address to finish creating your account.</p>
        <p style="margin:28px 0"><a href="${url}" style="background:#10b981;color:#04130b;padding:12px 22px;border-radius:10px;text-decoration:none;font-weight:bold">Confirm email</a></p>
        <p style="font-size:12px;color:#8aa595">This link expires in ${VERIFY_HOURS} hours. If you didn't sign up, ignore this email.</p>
      </div>`,
    );
    if (!emailed) this.logger.warn(`Verification link for ${user.email}: ${url}`);
    // Only expose the link outside production, where SMTP may not be set up yet
    const devLink = process.env.NODE_ENV !== 'production' && !emailed;
    return { emailed, ...(devLink ? { verifyLink: url } : {}) };
  }

  private async issue(user: {
    id: string;
    email: string;
    name: string;
    avatarColor: string;
  }) {
    const token = await this.jwt.signAsync({ sub: user.id, email: user.email });
    return { token, user: this.publicUser(user) };
  }

  private publicUser(user: {
    id: string;
    email: string;
    name: string;
    avatarColor: string;
  }) {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      avatarColor: user.avatarColor,
    };
  }
}
