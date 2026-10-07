import { Controller, Get, Inject } from '@nestjs/common';
import type { LivenessResponse } from '@creno/shared';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/auth.decorators.js';
import { HealthCheck, HealthCheckService } from '@nestjs/terminus';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/env.js';
import { DatabaseHealthIndicator } from './database.health.js';

@ApiTags('health')
@Public()
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly database: DatabaseHealthIndicator,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * Liveness : le process répond. Ne touche pas la base. `release` (SHA du commit) permet au smoke
   * test du déploiement de vérifier que c'est bien la nouvelle révision qui répond.
   */
  @Get()
  live(): LivenessResponse {
    return { status: 'ok', release: this.config.SENTRY_RELEASE };
  }

  /** Readiness : l'API peut servir du trafic (base joignable), sinon 503. */
  @Get('ready')
  @HealthCheck()
  ready() {
    return this.health.check([() => this.database.isHealthy('database')]);
  }
}
