import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiErrorSchema, healthResponseSchema } from '@creno/shared';
import { createTestApp } from './app.js';

describe('health', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => {
    await app.close();
  });

  it('GET /health → 200 sans toucher la base', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    expect(res.body).toEqual({ status: 'ok', release: 'dev' });
  });

  it('GET /health/ready → 200 quand la base répond', async () => {
    const res = await request(app.getHttpServer()).get('/health/ready').expect(200);
    const body = healthResponseSchema.parse(res.body);
    expect(body.info?.database?.status).toBe('up');
  });

  it('renvoie un x-request-id, et réutilise celui du client', async () => {
    const generated = await request(app.getHttpServer()).get('/health');
    expect(generated.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    const forwarded = await request(app.getHttpServer())
      .get('/health')
      .set('x-request-id', 'trace-123');
    expect(forwarded.headers['x-request-id']).toBe('trace-123');
  });

  it('Cache-Control: no-store sur toutes les réponses', async () => {
    const res = await request(app.getHttpServer()).get('/health');
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('route inconnue → 404 au format d’erreur commun', async () => {
    const res = await request(app.getHttpServer()).get('/v1/nope').expect(404);
    const body = apiErrorSchema.parse(res.body);
    expect(body.code).toBe('NOT_FOUND');
  });
});

describe('health quand la base est injoignable', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp({ databaseUrl: 'postgres://creno:creno@127.0.0.1:1/creno' });
  });
  afterAll(async () => {
    await app.close();
  });

  it('GET /health/ready → 503, /health reste 200', async () => {
    const res = await request(app.getHttpServer()).get('/health/ready').expect(503);
    const body = healthResponseSchema.parse(res.body);
    expect(body.status).toBe('error');
    expect(body.error?.database?.status).toBe('down');
    await request(app.getHttpServer()).get('/health').expect(200);
  });
});
