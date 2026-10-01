import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  type Pagination,
  paginationSchema,
  type PublicUser,
  type UpdateMeInput,
  updateMeSchema,
  type UserList,
} from '@creno/shared';
import { CurrentUser, Roles } from '../auth/auth.decorators.js';
import type { AuthUser } from '../auth/auth.types.js';
import { ApiZodBody, ZodValidationPipe } from '../common/zod.js';
import { UsersService } from './users.service.js';

@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me')
  me(@CurrentUser() user: AuthUser): Promise<PublicUser> {
    return this.users.me(user);
  }

  @Patch('me')
  @ApiZodBody(updateMeSchema)
  updateMe(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(updateMeSchema)) body: UpdateMeInput,
  ): Promise<PublicUser> {
    return this.users.updateMe(user, body);
  }

  @Get()
  @Roles('admin')
  list(@Query(new ZodValidationPipe(paginationSchema)) pagination: Pagination): Promise<UserList> {
    return this.users.list(pagination);
  }

  @Get(':id')
  getById(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PublicUser> {
    return this.users.getById(user, id);
  }
}
