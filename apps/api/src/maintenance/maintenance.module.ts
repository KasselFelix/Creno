import { Module } from '@nestjs/common';
import { PaymentsGatewayModule } from '../payments/payments-gateway.module.js';
import { MaintenanceRepository } from './maintenance.repository.js';
import { MaintenanceService } from './maintenance.service.js';

@Module({
  imports: [PaymentsGatewayModule],
  providers: [MaintenanceRepository, MaintenanceService],
})
export class MaintenanceModule {}
