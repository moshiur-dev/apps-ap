import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { AuthGuard, CurrentUser } from './auth.guard';
import type { AuthUser } from './auth.guard';
import { LoginDto, RegisterDto, ResendDto, VerifyDto } from './auth.dto';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  @Post('verify')
  verify(@Body() dto: VerifyDto) {
    return this.auth.verify(dto.token);
  }

  @Post('resend-verification')
  resend(@Body() dto: ResendDto) {
    return this.auth.resend(dto.email);
  }

  @Get('me')
  @UseGuards(AuthGuard)
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user.sub);
  }
}
