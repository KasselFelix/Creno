import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ThrottlerGuard } from '@nestjs/throttler';
import {
  type Booking,
  type BookingDetail,
  type BookingList,
  type BookingsQuery,
  bookingsQuerySchema,
  type CheckoutResponse,
  type CreateBookingInput,
  createBookingSchema,
  type ProviderBooking,
  type RescheduleBookingInput,
  rescheduleBookingSchema,
} from '@creno/shared';
import { CurrentUser, Roles } from '../auth/auth.decorators.js';
import type { AuthUser } from '../auth/auth.types.js';
import { OnlyThrottle } from '../common/throttle.js';
import { ApiZodBody, ApiZodQuery, ZodValidationPipe } from '../common/zod.js';
import { BookingsService } from './bookings.service.js';

@ApiTags('bookings')
@Controller('bookings')
@UseGuards(ThrottlerGuard)
@OnlyThrottle()
export class BookingsController {
  constructor(private readonly bookings: BookingsService) {}

  @Post()
  @OnlyThrottle('bookings')
  @ApiZodBody(createBookingSchema)
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createBookingSchema)) body: CreateBookingInput,
  ): Promise<Booking> {
    return this.bookings.createHold(user, body);
  }

  @Get()
  @ApiZodQuery(bookingsQuerySchema)
  list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(bookingsQuerySchema)) query: BookingsQuery,
  ): Promise<BookingList> {
    return this.bookings.listMine(user, query);
  }

  @Get(':id')
  getOne(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<BookingDetail> {
    return this.bookings.getOne(user, id);
  }

  // Les deux routes suivantes appellent Stripe : même limite de débit que la création d'un hold.
  @Post(':id/checkout')
  @HttpCode(200)
  @OnlyThrottle('bookings')
  checkout(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CheckoutResponse> {
    return this.bookings.checkout(user, id);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @OnlyThrottle('bookings')
  cancel(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<BookingDetail> {
    return this.bookings.cancel(user, id);
  }

  // Chaque déplacement envoie un email au client : même limite de débit que la création d'un hold.
  @Post(':id/reschedule')
  @HttpCode(200)
  @Roles('provider')
  @OnlyThrottle('bookings')
  @ApiZodBody(rescheduleBookingSchema)
  reschedule(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(rescheduleBookingSchema)) body: RescheduleBookingInput,
  ): Promise<ProviderBooking> {
    return this.bookings.reschedule(user, id, body);
  }
}
