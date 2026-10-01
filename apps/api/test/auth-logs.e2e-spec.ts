import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, registerAs, TEST_PASSWORD } from './app.js';

// Fichier à part : nestjs-pino garde un logger racine global au processus, créé par la première
// application ; Vitest isole chaque fichier, ce test a donc sa propre instance qui écrit dans `logs`.
describe('auth : logs', () => {
  let app: INestApplication;
  const logs: string[] = [];

  beforeAll(async () => {
    app = await createTestApp({ logs });
  });
  afterAll(async () => {
    await app.close();
  });

  it('journalise les événements auth.* sans email, mot de passe, hash ni token', async () => {
    const { agent, user } = await registerAs(app);
    await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ email: user.email, password: 'mauvais-mdp' });
    await agent.post('/v1/auth/logout');

    const events = logs
      .map((line) => (JSON.parse(line) as { event?: string }).event)
      .filter(Boolean);
    expect(events).toEqual(
      expect.arrayContaining(['auth.registered', 'auth.login_failed', 'auth.logged_out']),
    );
    const all = logs.join('\n');
    for (const secret of [user.email, TEST_PASSWORD, 'mauvais-mdp', '$argon2id']) {
      expect(all).not.toContain(secret);
    }
    expect(all).not.toMatch(/creno_(at|rt)=/);
  });
});
