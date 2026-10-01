import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerModule } from '@nestjs/throttler';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/env.js';
import { UsersModule } from '../users/users.module.js';
import { AuthController } from './auth.controller.js';
import { AuthCookies } from './auth.cookies.js';
import { AuthService } from './auth.service.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { PasswordHasher } from './password-hasher.js';
import { RolesGuard } from './roles.guard.js';
import { SessionsRepository } from './sessions.repository.js';
import { TokensService } from './tokens.service.js';

@Module({
  imports: [
    UsersModule,
    JwtModule.registerAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({
        secret: config.JWT_ACCESS_SECRET,
        signOptions: { algorithm: 'HS256', issuer: 'creno-api' },
        verifyOptions: { algorithms: ['HS256'], issuer: 'creno-api' },
      }),
    }),
    // Stockage en mémoire : suffisant pour une instance ; à déplacer (Redis) si l'API passe à plusieurs réplicas.
    ThrottlerModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => [
        { name: 'credentials', ttl: 60_000, limit: config.AUTH_RATE_LIMIT_PER_MINUTE },
        { name: 'refresh', ttl: 60_000, limit: config.AUTH_RATE_LIMIT_PER_MINUTE * 3 },
      ],
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthCookies,
    PasswordHasher,
    SessionsRepository,
    TokensService,
    // Ordre important : on identifie l'utilisateur, puis on vérifie son rôle.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AuthModule {}
