import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerModule } from '@nestjs/throttler';
import { trackByIp, trackByUserOrIp } from '../common/client-ip.js';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/env.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { UsersModule } from '../users/users.module.js';
import { AuthController } from './auth.controller.js';
import { AuthCookies } from './auth.cookies.js';
import { AuthService } from './auth.service.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { PasswordHasher } from './password-hasher.js';
import { PendingRegistrationsRepository } from './pending-registrations.repository.js';
import { RegistrationWorker } from './registration.worker.js';
import { RolesGuard } from './roles.guard.js';
import { SessionsRepository } from './sessions.repository.js';
import { TokensService } from './tokens.service.js';

@Module({
  imports: [
    UsersModule,
    // Pour la passerelle email (emails d'inscription).
    NotificationsModule,
    JwtModule.registerAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({
        secret: config.JWT_ACCESS_SECRET,
        signOptions: { algorithm: 'HS256', issuer: 'creno-api' },
        verifyOptions: { algorithms: ['HS256'], issuer: 'creno-api' },
      }),
    }),
    // Stockage en mémoire : suffisant pour une instance ; à déplacer (Redis) si l'API passe à plusieurs réplicas.
    // Compteurs par IP réelle du visiteur (`clientIp`), sauf `public` et `bookings` : par compte
    // quand la requête est authentifiée (voir client-ip.ts).
    ThrottlerModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({
        throttlers: [
          { name: 'credentials', ttl: 60_000, limit: config.AUTH_RATE_LIMIT_PER_MINUTE },
          { name: 'refresh', ttl: 60_000, limit: config.AUTH_RATE_LIMIT_PER_MINUTE * 3 },
          { name: 'registration', ttl: 3_600_000, limit: config.REGISTRATION_RATE_LIMIT_PER_HOUR },
          {
            name: 'public',
            ttl: 60_000,
            limit: config.PUBLIC_RATE_LIMIT_PER_MINUTE,
            getTracker: trackByUserOrIp,
          },
          {
            name: 'bookings',
            ttl: 60_000,
            limit: config.BOOKING_RATE_LIMIT_PER_MINUTE,
            getTracker: trackByUserOrIp,
          },
          { name: 'phone', ttl: 3_600_000, limit: config.PHONE_CODE_RATE_LIMIT_PER_HOUR },
          { name: 'ai', ttl: 60_000, limit: config.AI_RATE_LIMIT_PER_MINUTE },
        ],
        getTracker: trackByIp,
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthCookies,
    PasswordHasher,
    PendingRegistrationsRepository,
    RegistrationWorker,
    SessionsRepository,
    TokensService,
    // Ordre important : on identifie l'utilisateur, puis on vérifie son rôle.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AuthModule {}
