import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, ValidateNested } from 'class-validator';
import { NOTIFICATION_EVENTS, NOTIFICATION_RECIPIENTS } from '../notification-vocab';

export class NotificationRuleDto {
  @IsIn(NOTIFICATION_EVENTS as readonly string[], { message: 'Pick an event for every row' })
  event: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'Every row needs at least one recipient' })
  @IsIn(NOTIFICATION_RECIPIENTS as readonly string[], { each: true, message: 'Unknown recipient' })
  recipients: string[];

  @IsBoolean()
  email: boolean;

  @IsBoolean()
  bell: boolean;
}

export class SaveNotificationRulesDto {
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => NotificationRuleDto)
  rules: NotificationRuleDto[];
}
