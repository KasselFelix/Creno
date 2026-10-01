import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiErrorSchema, type GeocodingResult, geocodingResponseSchema } from '@creno/shared';
import { type Geocoder, GeocoderError } from '../src/geocoding/geocoder.js';
import { createTestApp } from './app.js';

const BELLECOUR: GeocodingResult = {
  label: 'Place Bellecour 69002 Lyon',
  name: 'Place Bellecour',
  city: 'Lyon',
  postcode: '69002',
  latitude: 45.7578,
  longitude: 4.832,
  kind: 'street',
};

describe('geocoding', () => {
  let app: INestApplication;
  // Le géocodeur est un service externe : toujours remplacé en test.
  const geocoder = { search: vi.fn<Geocoder['search']>() };

  beforeAll(async () => {
    app = await createTestApp({ geocoder });
  });
  beforeEach(() => {
    geocoder.search.mockReset();
  });
  afterAll(async () => {
    await app.close();
  });

  const get = (query: string) => request(app.getHttpServer()).get(`/v1/geocoding/search?${query}`);

  it('renvoie les suggestions du géocodeur, sans session', async () => {
    geocoder.search.mockResolvedValue([BELLECOUR]);
    const res = await get('q=place%20bellecour%20lyon').expect(200);
    expect(geocodingResponseSchema.parse(res.body)).toEqual({ items: [BELLECOUR] });
    expect(geocoder.search).toHaveBeenCalledWith('place bellecour lyon', 5);
  });

  it('ne renvoie jamais plus de 5 suggestions', async () => {
    geocoder.search.mockResolvedValue(Array.from({ length: 8 }, () => BELLECOUR));
    const res = await get('q=bellecour').expect(200);
    expect(geocodingResponseSchema.parse(res.body).items).toHaveLength(5);
  });

  it.each([
    ['trop court', 'q=ly'],
    ['espaces seulement', 'q=%20%20%20%20'],
    ['absent', ''],
    ['trop long', `q=${'a'.repeat(201)}`],
  ])('400 VALIDATION_FAILED sans appeler le géocodeur : %s', async (_label, query) => {
    const res = await get(query).expect(400);
    expect(apiErrorSchema.parse(res.body).code).toBe('VALIDATION_FAILED');
    expect(geocoder.search).not.toHaveBeenCalled();
  });

  it.each([
    ['délai dépassé', new GeocoderError('timeout')],
    ['erreur 5xx', new GeocoderError('http_502')],
    ['réponse invalide', new GeocoderError('invalid_response')],
    ['exception inattendue', new Error('boom')],
  ])('503 GEOCODING_UNAVAILABLE : %s', async (_label, failure) => {
    geocoder.search.mockRejectedValue(failure);
    const res = await get('q=place%20bellecour').expect(503);
    expect(apiErrorSchema.parse(res.body).code).toBe('GEOCODING_UNAVAILABLE');
  });

  it('429 TOO_MANY_REQUESTS au-delà de la limite par minute', async () => {
    geocoder.search.mockResolvedValue([]);
    const limited = await createTestApp({ geocoder, publicRateLimit: 2 });
    try {
      const url = '/v1/geocoding/search?q=lyon';
      for (let i = 0; i < 2; i++) await request(limited.getHttpServer()).get(url).expect(200);
      await request(limited.getHttpServer()).get(url).expect(429);
    } finally {
      await limited.close();
    }
  });
});
