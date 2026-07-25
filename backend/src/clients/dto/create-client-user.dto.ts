import { IsString, IsNotEmpty, IsEmail, MinLength } from 'class-validator';

export class CreateClientUserDto {
  @IsString()
  @IsNotEmpty()
  username: string;

  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;
}
