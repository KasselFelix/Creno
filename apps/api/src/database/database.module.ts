import { Global, Inject, Logger, Module, type OnApplicationShutdown } from '@nestjs/common';
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
      useFactory: (config: AppConfig): DbHandle => {
        const logger = new Logger('Database');
        return createDb(config.DATABASE_URL, {
          onIdleClientError: (error) =>
            logger.warn(
              { event: 'db.idle_client_error', err: error.message },
              'Connexion Postgres coupée',
            ),
        });
      },
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
