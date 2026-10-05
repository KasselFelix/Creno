import { Module } from '@nestjs/common';
import { AvailabilityModule } from '../availability/availability.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { PaymentsGatewayModule } from '../payments/payments-gateway.module.js';
import { ResourcesModule } from '../resources/resources.module.js';
import { BookingsController } from './bookings.controller.js';
import { ProviderBookingsController } from './provider-bookings.controller.js';
import { BookingsRepository } from './bookings.repository.js';
import { BookingsService } from './bookings.service.js';

@Module({
  imports: [ResourcesModule, AvailabilityModule, PaymentsGatewayModule, NotificationsModule],
  controllers: [BookingsController, ProviderBookingsController],
  providers: [BookingsRepository, BookingsService],
  exports: [BookingsRepository],
})
export class BookingsModule {}
