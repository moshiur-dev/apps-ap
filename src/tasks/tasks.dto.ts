import {
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsMongoId,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

/** Every status a task can have. Add new ones here and in web/src/components/ui.tsx. */
export const STATUSES = [
  'TODO',
  'IN_PROGRESS',
  'REVIEW',
  'SECOND_EYE',
  'DONE',
] as const;
export const PRIORITIES = ['URGENT', 'HIGH', 'NORMAL', 'LOW'] as const;

class TaskFields {
  @IsOptional()
  @IsString()
  @MaxLength(10000)
  description?: string;

  @IsOptional()
  @IsIn(STATUSES)
  status?: string;

  @IsOptional()
  @IsIn(PRIORITIES)
  priority?: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsDateString()
  startDate?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsDateString()
  dueDate?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(0)
  @Max(100000)
  timeEstimate?: number | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsMongoId()
  assigneeId?: string | null;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(30, { each: true })
  tags?: string[];
}

export class CreateTaskDto extends TaskFields {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title: string;

  @IsOptional()
  @IsMongoId()
  parentId?: string;
}

export class UpdateTaskDto extends TaskFields {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsNumber()
  position?: number;

  @IsOptional()
  @IsMongoId()
  listId?: string;
}

export class CommentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  body: string;
}
