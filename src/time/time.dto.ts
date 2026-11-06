import {
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class ManualTimeDto {
  /** Minutes worked */
  @IsInt()
  @Min(1)
  @Max(24 * 60)
  minutes: number;

  /** Day the work happened (ISO). Defaults to now. */
  @IsOptional()
  @IsDateString()
  date?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}
