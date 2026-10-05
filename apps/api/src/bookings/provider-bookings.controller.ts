import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ThrottlerGuard } from '@nestjs/throttler';
import {
  type Calendar,
  type CalendarQuery,
  calendarQuerySchema,
  type ProviderBookingList,
  type ProviderBookingsQuery,
  providerBookingsQuerySchema,
} from '@creno/shared';
import { CurrentUser, Roles } from '../auth/auth.decorators.js';
import type { AuthUser } from '../auth/auth.types.js';
import { OnlyThrottle } from '../common/throttle.js';
import { ApiZodQuery, ZodValidationPipe } from '../common/zod.js';
import { BookingsService } from './bookings.service.js';

/** Réservations vues depuis le dashboard du prestataire connecté. */
@ApiTags('bookings')
@Controller('providers/me')
@UseGuards(ThrottlerGuard)
@OnlyThrottle()
@Roles('provider')
export class ProviderBookingsController {
  constructor(private readonly bookings: BookingsService) {}

  @Get('bookings')
  @ApiZodQuery(providerBookingsQuerySchema)
  list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(providerBookingsQuerySchema)) query: ProviderBookingsQuery,
  ): Promise<ProviderBookingList> {
    return this.bookings.listForProvider(user, query);
  }

  @Get('calendar')
  @ApiZodQuery(calendarQuerySchema)
  calendar(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(calendarQuerySchema)) query: CalendarQuery,
  ): Promise<Calendar> {
    return this.bookings.calendar(user, query);
  }
}
