import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { ApiTags } from '@nestjs/swagger';
import {
  type Pagination,
  type PhoneCodeRequested,
  paginationSchema,
  type PublicUser,
  type RequestPhoneCodeInput,
  requestPhoneCodeSchema,
  type UpdateMeInput,
  updateMeSchema,
  type UserList,
  type VerifyPhoneInput,
  verifyPhoneSchema,
} from '@creno/shared';
import { CurrentUser, Roles } from '../auth/auth.decorators.js';
import type { AuthUser } from '../auth/auth.types.js';
import { OnlyThrottle } from '../common/throttle.js';
import { ApiZodBody, ZodValidationPipe } from '../common/zod.js';
import { PhoneVerificationService } from './phone-verification.service.js';
import { UsersService } from './users.service.js';

@ApiTags('users')
@Controller('users')
@UseGuards(ThrottlerGuard)
@OnlyThrottle()
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly phone: PhoneVerificationService,
  ) {}

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

  /** Envoie un code par SMS au numéro donné ; il n'est enregistré qu'une fois le code saisi. */
  @Post('me/phone')
  @HttpCode(202)
  @OnlyThrottle('phone')
  @ApiZodBody(requestPhoneCodeSchema)
  requestPhoneCode(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(requestPhoneCodeSchema)) body: RequestPhoneCodeInput,
  ): Promise<PhoneCodeRequested> {
    return this.phone.requestCode(user, body.phone);
  }

  @Post('me/phone/verify')
  @HttpCode(200)
  @OnlyThrottle('credentials')
  @ApiZodBody(verifyPhoneSchema)
  verifyPhone(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(verifyPhoneSchema)) body: VerifyPhoneInput,
  ): Promise<PublicUser> {
    return this.phone.verify(user, body.code);
  }

  @Delete('me/phone')
  @HttpCode(204)
  removePhone(@CurrentUser() user: AuthUser): Promise<void> {
    return this.phone.remove(user);
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
