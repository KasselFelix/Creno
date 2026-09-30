import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { HealthCheck, HealthCheckService } from '@nestjs/terminus';
import { DatabaseHealthIndicator } from './database.health.js';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly database: DatabaseHealthIndicator,
  ) {}

  /** Liveness : le process répond. Ne touche pas la base. */
  @Get()
  live() {
    return { status: 'ok' };
  }

  /** Readiness : l'API peut servir du trafic (base joignable), sinon 503. */
  @Get('ready')
  @HealthCheck()
  ready() {
    return this.health.check([() => this.database.isHealthy('database')]);
  }
}
