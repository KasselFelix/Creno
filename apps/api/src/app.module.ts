import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import type { DestinationStream } from 'pino';
import { AiSearchModule } from './ai-search/ai-search.module.js';
import { AuthModule } from './auth/auth.module.js';
import { AvailabilityModule } from './availability/availability.module.js';
import { BookingsModule } from './bookings/bookings.module.js';
import { AllExceptionsFilter } from './common/all-exceptions.filter.js';
import { ClockModule } from './common/clock.js';
import { LOG_STREAM, LogStreamModule, loggerParams } from './common/logger.js';
import { APP_CONFIG, ConfigModule } from './config/config.module.js';
import type { AppConfig } from './config/env.js';
import { DatabaseModule } from './database/database.module.js';
import { GeocodingModule } from './geocoding/geocoding.module.js';
import { HealthModule } from './health/health.module.js';
import { JobsModule } from './jobs/jobs.module.js';
import { MaintenanceModule } from './maintenance/maintenance.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { PaymentsModule } from './payments/payments.module.js';
import { ProvidersModule } from './providers/providers.module.js';
import { ResourcesModule } from './resources/resources.module.js';
import { SearchModule } from './search/search.module.js';
import { UsersModule } from './users/users.module.js';

@Module({
  imports: [
    ConfigModule,
    ClockModule,
    LoggerModule.forRootAsync({
      imports: [LogStreamModule],
      inject: [APP_CONFIG, LOG_STREAM],
      useFactory: (config: AppConfig, stream: DestinationStream | null) =>
        loggerParams(config, stream),
    }),
    DatabaseModule,
    JobsModule,
    HealthModule,
    AuthModule,
    UsersModule,
    ProvidersModule,
    ResourcesModule,
    AvailabilityModule,
    BookingsModule,
    PaymentsModule,
    SearchModule,
    AiSearchModule,
    GeocodingModule,
    NotificationsModule,
    MaintenanceModule,
  ],
  providers: [{ provide: APP_FILTER, useClass: AllExceptionsFilter }],
})
export class AppModule {}
