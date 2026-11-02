import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto, RegisterDto } from './auth.dto';

const AVATAR_COLORS = ['#2f855a', '#276749', '#b7791f', '#2c7a7b', '#975a16'];

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async register(dto: RegisterDto) {
    const email = dto.email.toLowerCase().trim();
    const exists = await this.prisma.user.findUnique({ where: { email } });
    if (exists) throw new ConflictException('Email is already registered');

    const user = await this.prisma.user.create({
      data: {
        name: dto.name.trim(),
        email,
        passwordHash: await bcrypt.hash(dto.password, 12),
        avatarColor:
          AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)],
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

    return this.issue(user);
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase().trim() },
    });
    if (!user || !(await bcrypt.compare(dto.password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid email or password');
    }
    return this.issue(user);
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();
    return this.publicUser(user);
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
