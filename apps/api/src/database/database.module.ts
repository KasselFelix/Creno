import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { createDb, type DbHandle } from '@creno/db';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/env.js';

export const DB = Symbol('DB');

@Global()
@Module({
  providers: [
    {
      provide: DB,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): DbHandle => createDb(config.DATABASE_URL),
    },
  ],
  exports: [DB],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  async onApplicationShutdown(): Promise<void> {
    await this.handle.pool.end();
  }
}
