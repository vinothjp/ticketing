import { IsString, IsNotEmpty } from 'class-validator';

export class CheckPermissionDto {
  @IsString()
  @IsNotEmpty()
  formName: string;

  @IsString()
  @IsNotEmpty()
  action: string;
}
