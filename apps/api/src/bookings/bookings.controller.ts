import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ThrottlerGuard } from '@nestjs/throttler';
import { type Booking, type CreateBookingInput, createBookingSchema } from '@creno/shared';
import { CurrentUser } from '../auth/auth.decorators.js';
import type { AuthUser } from '../auth/auth.types.js';
import { OnlyThrottle } from '../common/throttle.js';
import { ApiZodBody, ZodValidationPipe } from '../common/zod.js';
import { BookingsService } from './bookings.service.js';

@ApiTags('bookings')
@Controller('bookings')
@UseGuards(ThrottlerGuard)
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
}
