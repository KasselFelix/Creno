import { Module } from '@nestjs/common';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/env.js';
import { BanGeocoder } from './ban-geocoder.js';
import { GEOCODER } from './geocoder.js';
import { GeocodingController } from './geocoding.controller.js';
import { GeocodingService } from './geocoding.service.js';

@Module({
  controllers: [GeocodingController],
  providers: [
    GeocodingService,
    {
      provide: GEOCODER,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => new BanGeocoder(config.GEOCODER_URL),
    },
  ],
  // La recherche en langage naturel géocode le lieu cité dans la phrase.
  exports: [GEOCODER],
})
export class GeocodingModule {}
