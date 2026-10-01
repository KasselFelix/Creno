import { Module } from '@nestjs/common';
import { AvailabilityModule } from '../availability/availability.module.js';
import { ResourcesModule } from '../resources/resources.module.js';
import { BookingsController } from './bookings.controller.js';
import { BookingsRepository } from './bookings.repository.js';
import { BookingsService } from './bookings.service.js';

@Module({
  imports: [ResourcesModule, AvailabilityModule],
  controllers: [BookingsController],
  providers: [BookingsRepository, BookingsService],
})
export class BookingsModule {}
