import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class RegisterDto {
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name: string;

  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  @MaxLength(100)
  password: string;

  /** Set when signing up from an invite link. The invite proves the address, so no second email is needed. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  inviteToken?: string;
}

export class LoginDto {
  @IsEmail()
  email: string;

  @IsString()
  password: string;
}

export class VerifyDto {
  @IsString()
  @MinLength(20)
  @MaxLength(200)
  token: string;
}

export class ResendDto {
  @IsEmail()
  email: string;
}
