import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class RegisterDto {
  @ApiProperty({ example: 'jane@example.com' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(254)
  email: string;

  // bcrypt only uses the first 72 bytes, so longer passwords would silently be truncated.
  @ApiProperty({ minLength: 8, maxLength: 72, example: 'correct-horse-battery' })
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password: string;
}
