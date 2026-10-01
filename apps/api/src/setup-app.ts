import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { originCheck } from './common/origin-check.middleware.js';
import type { AppConfig } from './config/env.js';

/** Configuration HTTP commune au serveur et aux tests e2e. */
export function setupApp(app: INestApplication, config: AppConfig): void {
  const express = app as NestExpressApplication;
  express.disable('x-powered-by');
  // Derrière un proxy (rewrite Next, ingress Azure), l'IP réelle est dans X-Forwarded-For :
  // indispensable pour que le rate limit ne compte pas tous les clients comme une seule IP.
  express.set('trust proxy', config.TRUST_PROXY);

  const swagger = config.NODE_ENV === 'development';
  // L'API ne sert que du JSON ; la CSP ne gêne que l'interface Swagger (scripts inline), active en dev seulement.
  app.use(helmet({ contentSecurityPolicy: swagger ? false : undefined }));
  app.use(cookieParser());
  app.use(originCheck(config.WEB_ORIGIN));

  app.setGlobalPrefix('v1', { exclude: ['health', 'health/ready'] });
  app.enableCors({ origin: config.WEB_ORIGIN, credentials: true });
  app.enableShutdownHooks();

  if (swagger) {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle('Creno API').setVersion('1').addCookieAuth('creno_at').build(),
    );
    SwaggerModule.setup('docs', app, document);
  }
}
