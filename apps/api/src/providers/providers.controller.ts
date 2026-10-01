import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  type CreateProviderInput,
  createProviderSchema,
  type Provider,
  type PublicProvider,
  type ResourceList,
  type UpdateProviderInput,
  updateProviderSchema,
} from '@creno/shared';
import { CurrentUser, Public, Roles } from '../auth/auth.decorators.js';
import type { AuthUser } from '../auth/auth.types.js';
import { ApiZodBody, ZodValidationPipe } from '../common/zod.js';
import { ProvidersService } from './providers.service.js';

@ApiTags('providers')
@Controller('providers')
export class ProvidersController {
  constructor(private readonly providers: ProvidersService) {}

  @Post()
  @Roles('provider')
  @ApiZodBody(createProviderSchema)
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createProviderSchema)) body: CreateProviderInput,
  ): Promise<Provider> {
    return this.providers.create(user, body);
  }

  // Les routes `me` sont déclarées avant `:slug`, sinon `me` serait lu comme un slug.
  @Get('me')
  @Roles('provider')
  me(@CurrentUser() user: AuthUser): Promise<Provider> {
    return this.providers.me(user);
  }

  @Patch('me')
  @Roles('provider')
  @ApiZodBody(updateProviderSchema)
  updateMe(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(updateProviderSchema)) body: UpdateProviderInput,
  ): Promise<Provider> {
    return this.providers.updateMe(user, body);
  }

  @Get('me/resources')
  @Roles('provider')
  myResources(@CurrentUser() user: AuthUser): Promise<ResourceList> {
    return this.providers.myResources(user);
  }

  @Get(':slug')
  @Public()
  getBySlug(@Param('slug') slug: string): Promise<PublicProvider> {
    return this.providers.getBySlug(slug);
  }
}
