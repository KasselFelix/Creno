import { Module } from '@nestjs/common';
import { ResourcesController } from './resources.controller.js';
import { ResourcesRepository } from './resources.repository.js';
import { ResourcesService } from './resources.service.js';

@Module({
  controllers: [ResourcesController],
  providers: [ResourcesRepository, ResourcesService],
  exports: [ResourcesRepository, ResourcesService],
})
export class ResourcesModule {}
