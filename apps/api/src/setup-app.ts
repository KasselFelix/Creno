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
  // Par défaut (false), l'API ignore X-Forwarded-For, qu'un client peut falsifier : le rate limit
  // se base sur l'adresse de la connexion. Derrière des proxys de confiance qui réécrivent cet
  // en-tête (ingress de production), on déclare leur nombre exact pour retrouver l'IP du visiteur.
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
