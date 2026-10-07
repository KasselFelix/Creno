// Job de migration (Container Apps Job, lancé par la CI avant chaque déploiement de l'API) :
// `node dist/cli/migrate.js`. Logs JSON sur stdout, code de sortie ≠ 0 au premier échec.
import { deployDatabase, deployEnvSchema, describeDeployError } from './deploy-database.js';

const log = (line: Record<string, unknown>) => {
  process.stdout.write(`${JSON.stringify(line)}\n`);
};

async function main(): Promise<void> {
  const parsed = deployEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    // Le nom de la variable et la règle, jamais la valeur.
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    log({ level: 'error', event: 'migrate.invalid_config', problems });
    process.exit(1);
  }
  const env = parsed.data;
  const startedAt = Date.now();
  log({ level: 'info', event: 'migrate.started', demo: env.DEMO_MODE });
  try {
    await deployDatabase(env, log);
    log({ level: 'info', event: 'migrate.done', latencyMs: Date.now() - startedAt });
  } catch (error) {
    const secrets = [env.DATABASE_URL, env.DATABASE_URL_MIGRATE].map((url) =>
      decodeURIComponent(new URL(url).password),
    );
    log({ level: 'error', event: 'migrate.failed', err: describeDeployError(error, secrets) });
    process.exit(1);
  }
}

void main();
