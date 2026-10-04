import { randomUUID } from 'node:crypto';
import { Body, Controller, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';
import {
  type InterpretRequest,
  interpretRequestSchema,
  type InterpretResponse,
} from '@creno/shared';
import { Public } from '../auth/auth.decorators.js';
import { OnlyThrottle } from '../common/throttle.js';
import { ApiZodBody, ZodValidationPipe } from '../common/zod.js';
import { AiSearchService } from './ai-search.service.js';

@ApiTags('search')
@Controller('search')
@UseGuards(ThrottlerGuard)
@OnlyThrottle()
export class AiSearchController {
  constructor(private readonly aiSearch: AiSearchService) {}

  // Route publique qui appelle un modèle de langage : limite par IP, en plus du plafond journalier.
  // En POST : la phrase reste hors de l'URL, donc hors des logs d'accès.
  @Post('interpret')
  @HttpCode(200)
  @Public()
  @OnlyThrottle('ai')
  @ApiZodBody(interpretRequestSchema)
  interpret(
    @Body(new ZodValidationPipe(interpretRequestSchema)) body: InterpretRequest,
    @Req() req: Request,
  ): Promise<InterpretResponse> {
    return this.aiSearch.interpret(body.query, requestIdOf(req));
  }
}

/** Identifiant posé par pino-http sur chaque requête, le même que dans les logs. */
function requestIdOf(req: Request): string {
  const id = (req as Request & { id?: unknown }).id;
  return typeof id === 'string' && id.length > 0 ? id : randomUUID();
}
