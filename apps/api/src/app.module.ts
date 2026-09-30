import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { AllExceptionsFilter } from './common/all-exceptions.filter.js';
import { loggerParams } from './common/logger.js';
import { APP_CONFIG, ConfigModule } from './config/config.module.js';
import type { AppConfig } from './config/env.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthModule } from './health/health.module.js';

@Module({
  imports: [
    ConfigModule,
    LoggerModule.forRootAsync({ inject: [APP_CONFIG], useFactory: (config: AppConfig) => loggerParams(config) }),
    DatabaseModule,
    HealthModule,
  ],
  providers: [{ provide: APP_FILTER, useClass: AllExceptionsFilter }],
})
export class AppModule {}
