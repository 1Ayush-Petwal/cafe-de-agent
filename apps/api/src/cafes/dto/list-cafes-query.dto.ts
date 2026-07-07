import { IsIn, IsOptional, IsString } from 'class-validator';

/**
 * Store-locator list filters (issue #18). All optional: the bare `GET /cafes`
 * still returns everything. Filtering/sorting is applied *after* the
 * cache-aside read of the full unfiltered list (CafesService.findAll), so the
 * café-list cache key never explodes per filter combination.
 */
export class ListCafesQueryDto {
  @IsOptional()
  @IsString()
  region?: string;

  @IsOptional()
  @IsString()
  cuisine?: string;

  @IsOptional()
  @IsIn(['rating'])
  sort?: 'rating';
}
