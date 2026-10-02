import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ThrottlerGuard } from '@nestjs/throttler';
import { type GeocodingQuery, geocodingQuerySchema, type GeocodingResponse } from '@creno/shared';
import { Public } from '../auth/auth.decorators.js';
import { OnlyThrottle } from '../common/throttle.js';
import { ApiZodQuery, ZodValidationPipe } from '../common/zod.js';
import { GeocodingService } from './geocoding.service.js';

@ApiTags('geocoding')
@Controller('geocoding')
@UseGuards(ThrottlerGuard)
@OnlyThrottle()
export class GeocodingController {
  constructor(private readonly geocoding: GeocodingService) {}

  // Route publique qui appelle un service tiers : limitée en débit par IP.
  @Get('search')
  @Public()
  @OnlyThrottle('public')
  @ApiZodQuery(geocodingQuerySchema)
  search(
    @Query(new ZodValidationPipe(geocodingQuerySchema)) query: GeocodingQuery,
  ): Promise<GeocodingResponse> {
    return this.geocoding.search(query);
  }
}
