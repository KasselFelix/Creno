// Paramètres lus dans l'environnement du shell (voir docs/deploy.md) : ni secret ni email dans le
// dépôt, ni dans l'historique des commandes.
using 'main.bicep'

param operatorObjectId = readEnvironmentVariable('CRENO_OPERATOR_ID')
param webOrigin = readEnvironmentVariable('CRENO_WEB_ORIGIN')
param emailFrom = readEnvironmentVariable('CRENO_EMAIL_FROM')
param postgresAdminPassword = readEnvironmentVariable('CRENO_PG_ADMIN_PASSWORD')
// Vide au premier passage (infra seule), puis l'image en service (relue par le runbook).
param apiImage = readEnvironmentVariable('CRENO_API_IMAGE', '')
param budgetContactEmail = readEnvironmentVariable('CRENO_BUDGET_EMAIL', '')
param seedStripeAccountId = readEnvironmentVariable('CRENO_SEED_STRIPE_ACCOUNT_ID', '')
param mistralEnabled = bool(readEnvironmentVariable('CRENO_MISTRAL_ENABLED', 'false'))
param sentryEnabled = bool(readEnvironmentVariable('CRENO_SENTRY_ENABLED', 'false'))
