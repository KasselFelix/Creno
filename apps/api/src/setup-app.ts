import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { AppConfig } from './config/env.js';

/** Configuration HTTP commune au serveur et aux tests e2e. */
export function setupApp(app: INestApplication, config: AppConfig): void {
  (app as NestExpressApplication).disable('x-powered-by');
  app.setGlobalPrefix('v1', { exclude: ['health', 'health/ready'] });
  app.enableCors({ origin: config.WEB_ORIGIN, credentials: true });
  app.enableShutdownHooks();

  if (config.NODE_ENV === 'development') {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle('Creno API').setVersion('1').build(),
    );
    SwaggerModule.setup('docs', app, document);
  }
}
