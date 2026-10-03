import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { PhoneCodeWorker } from './phone-code.worker.js';
import { PhoneVerificationService } from './phone-verification.service.js';
import { PhoneVerificationsRepository } from './phone-verifications.repository.js';
import { UsersController } from './users.controller.js';
import { UsersRepository } from './users.repository.js';
import { UsersService } from './users.service.js';

@Module({
  // Pour la passerelle SMS (codes de vérification).
  imports: [NotificationsModule],
  controllers: [UsersController],
  providers: [
    UsersRepository,
    UsersService,
    PhoneVerificationsRepository,
    PhoneVerificationService,
    PhoneCodeWorker,
  ],
  exports: [UsersRepository],
})
export class UsersModule {}
