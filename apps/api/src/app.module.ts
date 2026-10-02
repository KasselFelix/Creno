import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import type { DestinationStream } from 'pino';
import { AuthModule } from './auth/auth.module.js';
import { AvailabilityModule } from './availability/availability.module.js';
import { BookingsModule } from './bookings/bookings.module.js';
import { AllExceptionsFilter } from './common/all-exceptions.filter.js';
import { LOG_STREAM, LogStreamModule, loggerParams } from './common/logger.js';
import { APP_CONFIG, ConfigModule } from './config/config.module.js';
import type { AppConfig } from './config/env.js';
import { DatabaseModule } from './database/database.module.js';
import { GeocodingModule } from './geocoding/geocoding.module.js';
import { HealthModule } from './health/health.module.js';
import { PaymentsModule } from './payments/payments.module.js';
import { ProvidersModule } from './providers/providers.module.js';
import { ResourcesModule } from './resources/resources.module.js';
import { SearchModule } from './search/search.module.js';
import { UsersModule } from './users/users.module.js';

@Module({
  imports: [
    ConfigModule,
    LoggerModule.forRootAsync({
      imports: [LogStreamModule],
      inject: [APP_CONFIG, LOG_STREAM],
      useFactory: (config: AppConfig, stream: DestinationStream | null) =>
        loggerParams(config, stream),
    }),
    DatabaseModule,
    HealthModule,
    AuthModule,
    UsersModule,
    ProvidersModule,
    ResourcesModule,
    AvailabilityModule,
    BookingsModule,
    PaymentsModule,
    SearchModule,
    GeocodingModule,
  ],
  providers: [{ provide: APP_FILTER, useClass: AllExceptionsFilter }],
})
export class AppModule {}
