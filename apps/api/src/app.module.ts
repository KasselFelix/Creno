import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import type { DestinationStream } from 'pino';
import { AuthModule } from './auth/auth.module.js';
import { AllExceptionsFilter } from './common/all-exceptions.filter.js';
import { LOG_STREAM, LogStreamModule, loggerParams } from './common/logger.js';
import { APP_CONFIG, ConfigModule } from './config/config.module.js';
import type { AppConfig } from './config/env.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthModule } from './health/health.module.js';
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
  ],
  providers: [{ provide: APP_FILTER, useClass: AllExceptionsFilter }],
})
export class AppModule {}
