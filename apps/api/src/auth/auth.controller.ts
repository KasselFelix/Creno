import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import {
  AUTH_COOKIES,
  type AuthResponse,
  type CompleteRegistrationInput,
  completeRegistrationSchema,
  type LoginInput,
  loginSchema,
  type RegisterInput,
  registerSchema,
  type SessionList,
} from '@creno/shared';
import { DomainError } from '../common/domain-error.js';
import { ApiZodBody, ZodValidationPipe } from '../common/zod.js';
import { CurrentUser, Public } from './auth.decorators.js';
import { OnlyThrottle } from '../common/throttle.js';
import { AuthCookies } from './auth.cookies.js';
import { AuthService } from './auth.service.js';
import type { AuthUser } from './auth.types.js';

@ApiTags('auth')
@Controller('auth')
@UseGuards(ThrottlerGuard)
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly cookies: AuthCookies,
  ) {}

  // 202 sans corps ni cookie, que l'adresse ait déjà un compte ou non : la suite se passe par email.
  // Deux limites par IP : à la minute (rafales), et à l'heure (une boîte visée par des alias).
  @Public()
  @OnlyThrottle('credentials', 'registration')
  @Post('register')
  @HttpCode(202)
  @ApiZodBody(registerSchema)
  async register(@Body(new ZodValidationPipe(registerSchema)) body: RegisterInput): Promise<void> {
    await this.auth.register(body);
  }

  // Publique : le lien s'ouvre souvent sur un autre appareil que celui de la demande.
  @Public()
  @OnlyThrottle('credentials')
  @Post('register/complete')
  @HttpCode(200)
  @ApiZodBody(completeRegistrationSchema)
  async completeRegistration(
    @Body(new ZodValidationPipe(completeRegistrationSchema)) body: CompleteRegistrationInput,
    @Headers('user-agent') userAgent: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    const result = await this.auth.completeRegistration(body, userAgent);
    this.cookies.set(res, result);
    return { user: result.user };
  }

  @Public()
  @OnlyThrottle('credentials')
  @Post('login')
  @HttpCode(200)
  @ApiZodBody(loginSchema)
  async login(
    @Body(new ZodValidationPipe(loginSchema)) body: LoginInput,
    @Headers('user-agent') userAgent: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    const result = await this.auth.login(body, userAgent);
    this.cookies.set(res, result);
    return { user: result.user };
  }

  @Public()
  @OnlyThrottle('refresh')
  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    try {
      const result = await this.auth.refresh(req.cookies?.[AUTH_COOKIES.refresh]);
      this.cookies.set(res, result);
      return { user: result.user };
    } catch (error) {
      // Session morte : on efface les cookies pour que le front repasse par le login. Sur une autre
      // erreur (panne passagère de la base…), on les garde : la session est peut-être encore valide.
      if (error instanceof DomainError && error.code === 'SESSION_EXPIRED') this.cookies.clear(res);
      throw error;
    }
  }

  // Publique : on doit pouvoir se déconnecter même avec un access token expiré.
  @Public()
  @OnlyThrottle()
  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    try {
      await this.auth.logout(req.cookies?.[AUTH_COOKIES.refresh]);
    } finally {
      // Quoi qu'il arrive, ce navigateur n'a plus de session.
      this.cookies.clear(res);
    }
  }

  @OnlyThrottle()
  @Get('sessions')
  async sessions(@CurrentUser() user: AuthUser): Promise<SessionList> {
    return { items: await this.auth.listSessions(user) };
  }

  @OnlyThrottle()
  @Delete('sessions/:id')
  @HttpCode(204)
  async revokeSession(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.auth.revokeSession(user, id);
  }
}
