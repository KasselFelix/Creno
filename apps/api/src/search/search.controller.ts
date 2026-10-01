import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ThrottlerGuard } from '@nestjs/throttler';
import {
  type SearchProvidersQuery,
  searchProvidersQuerySchema,
  type SearchProvidersResponse,
} from '@creno/shared';
import { Public } from '../auth/auth.decorators.js';
import { OnlyThrottle } from '../common/throttle.js';
import { ApiZodQuery, ZodValidationPipe } from '../common/zod.js';
import { SearchService } from './search.service.js';

@ApiTags('search')
@Controller('search')
@UseGuards(ThrottlerGuard)
@OnlyThrottle()
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Get('providers')
  @Public()
  @OnlyThrottle('public')
  @ApiZodQuery(searchProvidersQuerySchema)
  providers(
    @Query(new ZodValidationPipe(searchProvidersQuerySchema)) query: SearchProvidersQuery,
  ): Promise<SearchProvidersResponse> {
    return this.search.searchProviders(query);
  }
}
