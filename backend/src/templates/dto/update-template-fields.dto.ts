import { Type } from 'class-transformer';
import { IsArray, ValidateNested } from 'class-validator';
import { TemplateFieldInputDto } from './create-template.dto';

export class UpdateTemplateFieldsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TemplateFieldInputDto)
  fields: TemplateFieldInputDto[];
}
