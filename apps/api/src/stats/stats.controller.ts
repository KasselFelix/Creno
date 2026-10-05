import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ThrottlerGuard } from '@nestjs/throttler';
import { type ProviderStats, type StatsQuery, statsQuerySchema } from '@creno/shared';
import { CurrentUser, Roles } from '../auth/auth.decorators.js';
import type { AuthUser } from '../auth/auth.types.js';
import { OnlyThrottle } from '../common/throttle.js';
import { ApiZodQuery, ZodValidationPipe } from '../common/zod.js';
import { StatsService } from './stats.service.js';

@ApiTags('stats')
@Controller('providers/me')
@UseGuards(ThrottlerGuard)
// Lectures de données clients : la même limite par IP que les lectures publiques freine l'aspiration.
@OnlyThrottle('public')
export class StatsController {
  constructor(private readonly stats: StatsService) {}

  @Get('stats')
  @Roles('provider')
  @ApiZodQuery(statsQuerySchema)
  week(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(statsQuerySchema)) query: StatsQuery,
  ): Promise<ProviderStats> {
    return this.stats.week(user, query);
  }
}
