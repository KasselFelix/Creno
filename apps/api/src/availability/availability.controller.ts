import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ThrottlerGuard } from '@nestjs/throttler';
import {
  type AvailabilityException,
  type CreateExceptionInput,
  createExceptionSchema,
  type ExceptionList,
  type ReplaceRulesInput,
  replaceRulesSchema,
  type RulesResponse,
  type SlotsQuery,
  slotsQuerySchema,
  type SlotsResponse,
} from '@creno/shared';
import { CurrentUser, Public, Roles } from '../auth/auth.decorators.js';
import type { AuthUser } from '../auth/auth.types.js';
import { OnlyThrottle } from '../common/throttle.js';
import { ApiZodBody, ZodValidationPipe } from '../common/zod.js';
import { AvailabilityService } from './availability.service.js';

@ApiTags('availability')
@Controller('resources/:id')
@UseGuards(ThrottlerGuard)
@OnlyThrottle()
export class AvailabilityController {
  constructor(private readonly availability: AvailabilityService) {}

  @Get('availability-rules')
  @Roles('provider')
  getRules(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<RulesResponse> {
    return this.availability.getRules(user, id);
  }

  @Put('availability-rules')
  @Roles('provider')
  @ApiZodBody(replaceRulesSchema)
  replaceRules(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(replaceRulesSchema)) body: ReplaceRulesInput,
  ): Promise<RulesResponse> {
    return this.availability.replaceRules(user, id, body);
  }

  @Get('availability-exceptions')
  @Roles('provider')
  listExceptions(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ExceptionList> {
    return this.availability.listExceptions(user, id);
  }

  @Post('availability-exceptions')
  @Roles('provider')
  @ApiZodBody(createExceptionSchema)
  createException(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(createExceptionSchema)) body: CreateExceptionInput,
  ): Promise<AvailabilityException> {
    return this.availability.createException(user, id, body);
  }

  @Delete('availability-exceptions/:exceptionId')
  @Roles('provider')
  @HttpCode(204)
  deleteException(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('exceptionId', ParseUUIDPipe) exceptionId: string,
  ): Promise<void> {
    return this.availability.deleteException(user, id, exceptionId);
  }

  // Route publique qui calcule : limitée en débit par IP.
  @Get('slots')
  @Public()
  @OnlyThrottle('public')
  getSlots(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodValidationPipe(slotsQuerySchema)) query: SlotsQuery,
  ): Promise<SlotsResponse> {
    return this.availability.getSlots(id, query);
  }
}
