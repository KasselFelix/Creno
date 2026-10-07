// Vérifie la chaîne d'erreurs en production (runbook) :
// `node --import ./dist/instrument.js dist/cli/sentry-check.js`, lancé dans le conteneur de l'API.
import * as Sentry from '@sentry/nestjs';

async function main(): Promise<void> {
  if (!Sentry.isInitialized()) {
    process.stdout.write(`${JSON.stringify({ level: 'warn', event: 'sentry.not_configured' })}\n`);
    process.exit(1);
  }
  const eventId = Sentry.captureException(new Error('sentry-check : erreur de test volontaire'));
  const flushed = await Sentry.flush(10_000);
  process.stdout.write(
    `${JSON.stringify({ level: 'info', event: 'sentry.checked', eventId, flushed })}\n`,
  );
  process.exit(flushed ? 0 : 1);
}

void main();
