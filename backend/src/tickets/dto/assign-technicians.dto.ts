import { IsArray, IsString } from 'class-validator';

export class AssignTechniciansDto {
  @IsArray()
  @IsString({ each: true })
  userIds: string[];
}
