import { randomBytes } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiErrorSchema, CLIENT_IP_HEADERS } from '@creno/shared';
import { createTestApp } from './app.js';

interface LogLine {
  level: number;
  event?: string;
  ipSource?: string;
  req?: { url?: string; headers?: Record<string, string> };
}

const SECRET = randomBytes(24).toString('hex');
const VISITOR_IP = '203.0.113.42';

// Fichier à part, comme auth-logs : le logger racine de nestjs-pino est global au processus.
describe('HTTP : logs', () => {
  let app: INestApplication;
  const logs: string[] = [];
  const lines = () => logs.map((line) => JSON.parse(line) as LogLine);

  beforeAll(async () => {
    app = await createTestApp({ logs, clientIpSecret: SECRET });
  });
  afterAll(async () => {
    await app.close();
  });

  it('corps trop gros → 413 PAYLOAD_TOO_LARGE, en warn et sans erreur pour Sentry', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ email: 'a@b.test', password: 'x'.repeat(200_000) }))
      .expect(413);
    expect(apiErrorSchema.parse(res.body).code).toBe('PAYLOAD_TOO_LARGE');
    expect(lines().find((l) => l.event === 'http.payload_too_large')?.level).toBe(40);
    expect(lines().filter((l) => l.level >= 50)).toEqual([]);
  });

  it('journalise d’où vient l’IP, jamais l’IP transmise ni le secret', async () => {
    await request(app.getHttpServer())
      .get('/v1/providers/inconnu')
      .set(CLIENT_IP_HEADERS.ip, VISITOR_IP)
      .set(CLIENT_IP_HEADERS.secret, SECRET)
      .expect(404);
    await request(app.getHttpServer()).get('/v1/providers/autre').expect(404);

    const access = lines().filter((l) => l.req?.url?.startsWith('/v1/providers/'));
    expect(access.map((l) => l.ipSource)).toEqual(['header', 'socket']);
    const raw = logs.join('\n');
    expect(raw).not.toContain(VISITOR_IP);
    expect(raw).not.toContain(SECRET);
  });
});
