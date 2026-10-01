import { Module } from '@nestjs/common';
import { ResourcesModule } from '../resources/resources.module.js';
import { AvailabilityController } from './availability.controller.js';
import { AvailabilityRepository } from './availability.repository.js';
import { AvailabilityService } from './availability.service.js';

@Module({
  imports: [ResourcesModule],
  controllers: [AvailabilityController],
  providers: [AvailabilityRepository, AvailabilityService],
  exports: [AvailabilityService],
})
export class AvailabilityModule {}
