import {
  Controller,
  Get,
  Headers,
  HttpCode,
  Post,
  type RawBodyRequest,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';
import type { ConnectOnboarding, ConnectStatus } from '@creno/shared';
import { CurrentUser, Public, Roles } from '../auth/auth.decorators.js';
import type { AuthUser } from '../auth/auth.types.js';
import { OnlyThrottle } from '../common/throttle.js';
import { ConnectService } from './connect.service.js';
import { WebhookService } from './webhook.service.js';

@ApiTags('payments')
@Controller('payments')
@UseGuards(ThrottlerGuard)
@OnlyThrottle()
export class PaymentsController {
  constructor(
    private readonly connect: ConnectService,
    private readonly webhooks: WebhookService,
  ) {}

  // Les deux POST `connect` appellent Stripe : limités en débit comme les réservations.
  @Post('connect/onboarding')
  @HttpCode(200)
  @Roles('provider')
  @OnlyThrottle('bookings')
  onboarding(@CurrentUser() user: AuthUser): Promise<ConnectOnboarding> {
    return this.connect.startOnboarding(user);
  }

  @Get('connect/status')
  @Roles('provider')
  status(@CurrentUser() user: AuthUser): Promise<ConnectStatus> {
    return this.connect.status(user);
  }

  @Post('connect/refresh')
  @HttpCode(200)
  @Roles('provider')
  @OnlyThrottle('bookings')
  refresh(@CurrentUser() user: AuthUser): Promise<ConnectStatus> {
    return this.connect.refresh(user);
  }

  /**
   * Appelée par Stripe, sans session : c'est la signature qui authentifie l'appel. Elle porte sur
   * le corps brut de la requête (`rawBody`), pas sur le JSON re-sérialisé. Pas de limite de débit :
   * Stripe renvoie les événements refusés.
   */
  @Post('webhook')
  @HttpCode(200)
  @Public()
  @ApiExcludeEndpoint()
  async webhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string | undefined,
  ): Promise<{ received: true }> {
    await this.webhooks.receive(req.rawBody, signature);
    return { received: true };
  }
}
