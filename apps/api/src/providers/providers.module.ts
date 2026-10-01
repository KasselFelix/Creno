import { Module } from '@nestjs/common';
import { ResourcesModule } from '../resources/resources.module.js';
import { ProvidersController } from './providers.controller.js';
import { ProvidersRepository } from './providers.repository.js';
import { ProvidersService } from './providers.service.js';

@Module({
  imports: [ResourcesModule],
  controllers: [ProvidersController],
  providers: [ProvidersRepository, ProvidersService],
})
export class ProvidersModule {}
