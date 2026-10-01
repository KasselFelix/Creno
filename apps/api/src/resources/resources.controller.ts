import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ThrottlerGuard } from '@nestjs/throttler';
import {
  type CreateResourceInput,
  createResourceSchema,
  type Resource,
  type UpdateResourceInput,
  updateResourceSchema,
} from '@creno/shared';
import { CurrentUser, Public, Roles } from '../auth/auth.decorators.js';
import type { AuthUser } from '../auth/auth.types.js';
import { OnlyThrottle } from '../common/throttle.js';
import { ApiZodBody, ZodValidationPipe } from '../common/zod.js';
import { ResourcesService } from './resources.service.js';

@ApiTags('resources')
@Controller('resources')
@UseGuards(ThrottlerGuard)
@OnlyThrottle()
export class ResourcesController {
  constructor(private readonly resources: ResourcesService) {}

  @Post()
  @Roles('provider')
  @ApiZodBody(createResourceSchema)
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createResourceSchema)) body: CreateResourceInput,
  ): Promise<Resource> {
    return this.resources.create(user, body);
  }

  @Get(':id')
  @Public()
  @OnlyThrottle('public')
  getById(@Param('id', ParseUUIDPipe) id: string): Promise<Resource> {
    return this.resources.getPublic(id);
  }

  @Patch(':id')
  @Roles('provider')
  @ApiZodBody(updateResourceSchema)
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateResourceSchema)) body: UpdateResourceInput,
  ): Promise<Resource> {
    return this.resources.update(user, id, body);
  }
}
