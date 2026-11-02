import {
  IsEmail,
  IsHexColor,
  IsIn,
  IsMongoId,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class NameDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name: string;

  @IsOptional()
  @IsHexColor()
  color?: string;
}

export class RenameDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsHexColor()
  color?: string;
}

export class CreateListDto extends NameDto {
  @IsOptional()
  @IsMongoId()
  folderId?: string;
}

export class MoveListDto extends RenameDto {
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsMongoId()
  folderId?: string | null;
}

export class RoleDto {
  @IsIn(['ADMIN', 'MEMBER', 'GUEST'])
  role: 'ADMIN' | 'MEMBER' | 'GUEST';
}

export class InviteDto extends RoleDto {
  @IsEmail()
  email: string;
}
