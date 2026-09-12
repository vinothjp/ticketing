import { IsArray, IsOptional, IsUUID, ArrayMaxSize } from 'class-validator';

/**
 * What the list screen is currently showing. The whole ticket list is already
 * loaded client-side, so the screen sends the ids left after its month, view,
 * filters and sort rather than re-expressing all of that as query params — one
 * copy of the filter logic, not two that can disagree.
 *
 * Omitted, the export is everything the viewer may see. The ids only ever narrow
 * that: the rows are still fetched through the list's own visibility clause.
 */
export class ExportTicketsDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5000)
  @IsUUID('4', { each: true })
  ids?: string[];
}
