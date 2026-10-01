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
import { SkipThrottle, ThrottlerGuard } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import {
  AUTH_COOKIES,
  type AuthResponse,
  type LoginInput,
  loginSchema,
  type RegisterInput,
  registerSchema,
  type SessionList,
} from '@creno/shared';
import { ApiZodBody, ZodValidationPipe } from '../common/zod.js';
import { CurrentUser, Public } from './auth.decorators.js';
import { AuthCookies } from './auth.cookies.js';
import { AuthService } from './auth.service.js';
import type { AuthUser } from './auth.types.js';

/** Limites nommées (voir ThrottlerModule dans auth.module.ts). */
const onlyCredentialsLimit = { refresh: true };
const onlyRefreshLimit = { credentials: true };
const noLimit = { credentials: true, refresh: true };

@ApiTags('auth')
@Controller('auth')
@UseGuards(ThrottlerGuard)
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly cookies: AuthCookies,
  ) {}

  @Public()
  @SkipThrottle(onlyCredentialsLimit)
  @Post('register')
  @ApiZodBody(registerSchema)
  async register(
    @Body(new ZodValidationPipe(registerSchema)) body: RegisterInput,
    @Headers('user-agent') userAgent: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    const result = await this.auth.register(body, userAgent);
    this.cookies.set(res, result);
    return { user: result.user };
  }

  @Public()
  @SkipThrottle(onlyCredentialsLimit)
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
  @SkipThrottle(onlyRefreshLimit)
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
      // Session morte : on efface les cookies pour que le front repasse par le login.
      this.cookies.clear(res);
      throw error;
    }
  }

  @SkipThrottle(noLimit)
  @Post('logout')
  @HttpCode(204)
  async logout(
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.logout(user);
    this.cookies.clear(res);
  }

  @SkipThrottle(noLimit)
  @Get('sessions')
  async sessions(@CurrentUser() user: AuthUser): Promise<SessionList> {
    return { items: await this.auth.listSessions(user) };
  }

  @SkipThrottle(noLimit)
  @Delete('sessions/:id')
  @HttpCode(204)
  async revokeSession(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.auth.revokeSession(user, id);
  }
}
