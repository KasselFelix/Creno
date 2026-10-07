// Infra Azure de Creno (API + base), dimensionnée pour rester dans les offres gratuites :
// Postgres B1ms 32 Go (12 mois gratuits), Container Apps en plan Consumption mis en veille (quota
// mensuel gratuit), pas de VNet (il ajouterait un load balancer et deux IP publiques facturés).
// Déploiement à la main : voir docs/deploy.md. La CI ne change ensuite que l'image.

targetScope = 'resourceGroup'

@description('Région de toutes les ressources.')
param location string = resourceGroup().location

@description('Identifiant d\'objet Entra de la personne qui déploie : reçoit le droit d\'écrire les secrets du coffre.')
param operatorObjectId string

@description('Dépôt GitHub autorisé à déployer (OIDC, environnement « production »).')
param githubRepository string = 'KasselFelix/Creno'

@description('Image de l\'API (ghcr.io/…@sha256:…). Vide au premier passage : ni API ni job de migration.')
param apiImage string = ''

@description('Origine du front (https://…), pour le CORS, l\'en-tête Origin et les liens des emails.')
param webOrigin string

@description('Expéditeur des emails, sur un domaine vérifié chez Resend : « Creno <bonjour@domaine> ».')
param emailFrom string

@description('Démo publique : Stripe en mode test, Twilio facultatif, seed de démo sur une base vide.')
param demoMode bool = true

@description('Compte Stripe Express de test rattaché au prestataire de démo (acct_…), facultatif.')
param seedStripeAccountId string = ''

@description('Secrets facultatifs présents dans le coffre (sinon la fonction correspondante est désactivée).')
param mistralEnabled bool = false
param sentryEnabled bool = false
param twilioEnabled bool = false
@description('Numéro ou Messaging Service Twilio (non secret), si Twilio est activé.')
param twilioFrom string = ''

@description('Administrateur de Postgres : rôle de migration, propriétaire des objets.')
param postgresAdminLogin string = 'creno_admin'
@secure()
@description('Mot de passe de l\'administrateur Postgres (généré une fois, rangé dans le coffre).')
param postgresAdminPassword string

@description('Budget mensuel du groupe de ressources, en euros. Alertes à 20 % et 100 %.')
param budgetAmount int = 5
@description('Email des alertes de budget. Vide : pas de budget.')
param budgetContactEmail string = ''
@description('Début du budget (premier jour d\'un mois). Vide : le mois en cours ; à fixer pour relancer le Bicep un autre mois.')
param budgetStartDate string = ''
param currentMonth string = utcNow('yyyy-MM-01')

var suffix = take(uniqueString(resourceGroup().id), 6)
var apiName = 'ca-creno-api'
var deployApp = !empty(apiImage)

// Rôles intégrés d'Azure (identifiants publics, les mêmes partout).
var roles = {
  contributor: 'b24988ac-6180-42a0-ab88-20f7382dd24c'
  // « Key Vault Secrets User » : lire les valeurs du coffre.
  vaultReader: '4633458b-17de-408a-b874-0445c86b69e6'
  // « Key Vault Secrets Officer » : les écrire.
  vaultWriter: 'b86a8fe4-44ce-4948-aee5-eccb2c155cd7'
  // « Managed Identity Operator » : rattacher une identité à une ressource.
  identityOperator: 'f1a07417-d97a-45cb-824c-7a7467783830'
}

// ─── Journaux ────────────────────────────────────────────────────────────────────────────────
resource logs 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: 'log-creno-${suffix}'
  location: location
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
    // Plafond d'ingestion : on reste sous les 5 Go gratuits par mois.
    workspaceCapping: { dailyQuotaGb: json('0.1') }
  }
}

// ─── Secrets ─────────────────────────────────────────────────────────────────────────────────
// Deux coffres : celui de l'API, et celui de la migration (URL du rôle propriétaire du schéma,
// mot de passe admin de Postgres). L'API ne peut pas lire le second : une faille dans l'API ne donne
// pas les droits de DDL.
resource vault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: 'kv-creno-${suffix}'
  location: location
  properties: {
    tenantId: subscription().tenantId
    sku: { family: 'A', name: 'standard' }
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 7
    // Pas de purge protection : sur une démo qu'on peut supprimer, le nom resterait bloqué.
  }
}

resource migrationVault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: 'kv-crenom-${suffix}'
  location: location
  properties: {
    tenantId: subscription().tenantId
    sku: { family: 'A', name: 'standard' }
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 7
  }
}

resource operatorSecretsOfficer 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(vault.id, operatorObjectId, roles.vaultWriter)
  scope: vault
  properties: {
    principalId: operatorObjectId
    principalType: 'User'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles.vaultWriter)
  }
}

resource operatorMigrationSecretsOfficer 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(migrationVault.id, operatorObjectId, roles.vaultWriter)
  scope: migrationVault
  properties: {
    principalId: operatorObjectId
    principalType: 'User'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles.vaultWriter)
  }
}

// ─── Identités ───────────────────────────────────────────────────────────────────────────────
// L'API lit ses secrets dans son coffre avec cette identité (aucun mot de passe).
resource apiIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: 'id-creno-api'
  location: location
}

resource apiSecretsUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(vault.id, apiIdentity.id, roles.vaultReader)
  scope: vault
  properties: {
    principalId: apiIdentity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles.vaultReader)
  }
}

// Le job de migration lit les deux coffres : l'URL du rôle de l'API (pour créer ce rôle) et celle
// du rôle de migration.
resource migrateIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: 'id-creno-migrate'
  location: location
}

resource migrateReadsApiVault 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(vault.id, migrateIdentity.id, roles.vaultReader)
  scope: vault
  properties: {
    principalId: migrateIdentity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles.vaultReader)
  }
}

resource migrateReadsMigrationVault 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(migrationVault.id, migrateIdentity.id, roles.vaultReader)
  scope: migrationVault
  properties: {
    principalId: migrateIdentity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles.vaultReader)
  }
}

// GitHub Actions s'authentifie par OIDC : un jeton à durée courte, émis pour ce dépôt et cet
// environnement seulement. Aucun secret n'est stocké chez GitHub.
resource githubIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: 'id-creno-github'
  location: location
}

resource githubFederation 'Microsoft.ManagedIdentity/userAssignedIdentities/federatedIdentityCredentials@2023-01-31' = {
  parent: githubIdentity
  name: 'github-production'
  properties: {
    issuer: 'https://token.actions.githubusercontent.com'
    subject: 'repo:${githubRepository}:environment:production'
    audiences: ['api://AzureADTokenExchange']
  }
}

// ─── Base de données ─────────────────────────────────────────────────────────────────────────
resource postgres 'Microsoft.DBforPostgreSQL/flexibleServers@2025-08-01' = {
  name: 'psql-creno-${suffix}'
  location: location
  sku: { name: 'Standard_B1ms', tier: 'Burstable' }
  properties: {
    version: '17'
    administratorLogin: postgresAdminLogin
    administratorLoginPassword: postgresAdminPassword
    // 32 Go sans croissance automatique : la taille couverte par l'offre gratuite.
    storage: { storageSizeGB: 32, autoGrow: 'Disabled' }
    backup: { backupRetentionDays: 7, geoRedundantBackup: 'Disabled' }
    highAvailability: { mode: 'Disabled' }
    // Accès public filtré (règle ci-dessous) : un réseau privé coûterait ~22 €/mois de plus.
    network: { publicNetworkAccess: 'Enabled' }
    authConfig: { activeDirectoryAuth: 'Disabled', passwordAuth: 'Enabled' }
  }
}

// Extensions utilisées par les migrations (0000_extensions.sql).
resource postgresExtensions 'Microsoft.DBforPostgreSQL/flexibleServers/configurations@2025-08-01' = {
  parent: postgres
  name: 'azure.extensions'
  properties: { value: 'POSTGIS,BTREE_GIST,CITEXT', source: 'user-override' }
}

resource database 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2025-08-01' = {
  parent: postgres
  name: 'creno'
  properties: { charset: 'UTF8', collation: 'en_US.utf8' }
  dependsOn: [postgresExtensions]
}

// Seules les IP d'Azure atteignent le port 5432 (convention 0.0.0.0 d'Azure). TLS obligatoire.
resource azureServicesOnly 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2025-08-01' = {
  parent: postgres
  name: 'AllowAllAzureServicesAndResourcesWithinAzureIps'
  properties: { startIpAddress: '0.0.0.0', endIpAddress: '0.0.0.0' }
  dependsOn: [database]
}

// ─── Container Apps ──────────────────────────────────────────────────────────────────────────
resource environment 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: 'cae-creno'
  location: location
  properties: {
    // Plan Consumption sans VNet : rien n'est facturé quand l'API dort.
    workloadProfiles: [{ name: 'Consumption', workloadProfileType: 'Consumption' }]
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logs.properties.customerId
        sharedKey: logs.listKeys().primarySharedKey
      }
    }
  }
}

// Secrets lus dans le coffre par l'identité de l'API (références, jamais copiés dans le Bicep).
var requiredSecrets = [
  'database-url'
  'jwt-access-secret'
  'client-ip-secret'
  'stripe-secret-key'
  'stripe-webhook-secret'
  'stripe-connect-webhook-secret'
  'resend-api-key'
]
var optionalSecrets = concat(
  mistralEnabled ? ['mistral-api-key'] : [],
  sentryEnabled ? ['sentry-dsn'] : [],
  twilioEnabled ? ['twilio-account-sid', 'twilio-auth-token'] : []
)
var apiSecretNames = concat(requiredSecrets, optionalSecrets)
var secretEnv = {
  'database-url': 'DATABASE_URL'
  'jwt-access-secret': 'JWT_ACCESS_SECRET'
  'client-ip-secret': 'CLIENT_IP_SECRET'
  'stripe-secret-key': 'STRIPE_SECRET_KEY'
  'stripe-webhook-secret': 'STRIPE_WEBHOOK_SECRET'
  'stripe-connect-webhook-secret': 'STRIPE_CONNECT_WEBHOOK_SECRET'
  'resend-api-key': 'RESEND_API_KEY'
  'mistral-api-key': 'MISTRAL_API_KEY'
  'sentry-dsn': 'SENTRY_DSN'
  'twilio-account-sid': 'TWILIO_ACCOUNT_SID'
  'twilio-auth-token': 'TWILIO_AUTH_TOKEN'
}

var apiEnv = concat(
  [
    { name: 'NODE_ENV', value: 'production' }
    { name: 'API_PORT', value: '4000' }
    { name: 'LOG_LEVEL', value: 'info' }
    { name: 'WEB_ORIGIN', value: webOrigin }
    // Un proxy de confiance devant l'API : l'ingress de Container Apps (Envoy).
    { name: 'TRUST_PROXY', value: '1' }
    { name: 'DEMO_MODE', value: string(demoMode) }
    { name: 'EMAIL_FROM', value: emailFrom }
    { name: 'JOBS_WORKERS_ENABLED', value: 'true' }
  ],
  twilioEnabled ? [{ name: 'TWILIO_FROM', value: twilioFrom }] : [],
  map(apiSecretNames, name => { name: secretEnv[name], secretRef: name })
)

resource api 'Microsoft.App/containerApps@2024-03-01' = if (deployApp) {
  name: apiName
  location: location
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: { '${apiIdentity.id}': {} }
  }
  properties: {
    environmentId: environment.id
    workloadProfileName: 'Consumption'
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: 4000
        transport: 'auto'
        allowInsecure: false
      }
      secrets: map(apiSecretNames, name => {
        name: name
        keyVaultUrl: '${vault.properties.vaultUri}secrets/${name}'
        identity: apiIdentity.id
      })
    }
    template: {
      containers: [
        {
          name: 'api'
          // Image publique sur GHCR : pas d'identifiants de registre.
          image: apiImage
          resources: { cpu: json('0.25'), memory: '0.5Gi' }
          env: apiEnv
          probes: [
            // Démarrage lent à 0,25 vCPU : jusqu'à 60 s avant de déclarer l'échec.
            {
              type: 'Startup'
              httpGet: { path: '/health', port: 4000 }
              periodSeconds: 2
              failureThreshold: 30
            }
            // Vivacité sans la base : une base arrêtée ne fait pas redémarrer l'API en boucle.
            {
              type: 'Liveness'
              httpGet: { path: '/health', port: 4000 }
              periodSeconds: 10
              failureThreshold: 3
            }
            {
              type: 'Readiness'
              httpGet: { path: '/health/ready', port: 4000 }
              periodSeconds: 10
              failureThreshold: 3
            }
          ]
        }
      ]
      // 0 réplica sans trafic (gratuit), 1 au plus : throttler et circuit breaker restent en mémoire.
      scale: {
        minReplicas: 0
        maxReplicas: 1
        rules: [{ name: 'http', http: { metadata: { concurrentRequests: '50' } } }]
      }
    }
  }
  dependsOn: [apiSecretsUser, azureServicesOnly]
}

// Job de migration : même image, lancé par la CI avant chaque mise à jour de l'API.
resource migrateJob 'Microsoft.App/jobs@2024-03-01' = if (deployApp) {
  name: 'caj-creno-migrate'
  location: location
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: { '${migrateIdentity.id}': {} }
  }
  properties: {
    environmentId: environment.id
    workloadProfileName: 'Consumption'
    configuration: {
      triggerType: 'Manual'
      replicaTimeout: 600
      replicaRetryLimit: 0
      manualTriggerConfig: { parallelism: 1, replicaCompletionCount: 1 }
      secrets: [
        {
          name: 'database-url'
          keyVaultUrl: '${vault.properties.vaultUri}secrets/database-url'
          identity: migrateIdentity.id
        }
        {
          name: 'database-url-migrate'
          keyVaultUrl: '${migrationVault.properties.vaultUri}secrets/database-url-migrate'
          identity: migrateIdentity.id
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'migrate'
          image: apiImage
          command: ['node', 'dist/cli/migrate.js']
          resources: { cpu: json('0.25'), memory: '0.5Gi' }
          env: [
            { name: 'NODE_ENV', value: 'production' }
            { name: 'DATABASE_URL', secretRef: 'database-url' }
            { name: 'DATABASE_URL_MIGRATE', secretRef: 'database-url-migrate' }
            { name: 'DEMO_MODE', value: string(demoMode) }
            { name: 'SEED_STRIPE_ACCOUNT_ID', value: seedStripeAccountId }
          ]
        }
      ]
    }
  }
  dependsOn: [migrateReadsApiVault, migrateReadsMigrationVault, azureServicesOnly]
}

// La CI change l'image de l'API et du job, et lance le job. Contributor sur ces deux ressources
// (et l'environnement), pas sur la base ni les coffres. Risque accepté : un workflow compromis sur
// main pourrait modifier le job, qui lit l'URL du rôle de migration. D'où l'environnement GitHub
// `production` limité à la branche main, et main protégée par revue.
resource githubOnApi 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (deployApp) {
  name: guid(resourceGroup().id, apiName, githubIdentity.id, roles.contributor)
  scope: api
  properties: {
    principalId: githubIdentity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles.contributor)
  }
}

resource githubOnJob 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (deployApp) {
  name: guid(resourceGroup().id, 'caj-creno-migrate', githubIdentity.id, roles.contributor)
  scope: migrateJob
  properties: {
    principalId: githubIdentity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles.contributor)
  }
}

// L'app et le job portent chacun une identité : les mettre à jour demande de pouvoir la rattacher.
resource githubOnApiIdentity 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(apiIdentity.id, githubIdentity.id, roles.identityOperator)
  scope: apiIdentity
  properties: {
    principalId: githubIdentity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles.identityOperator)
  }
}

resource githubOnMigrateIdentity 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(migrateIdentity.id, githubIdentity.id, roles.identityOperator)
  scope: migrateIdentity
  properties: {
    principalId: githubIdentity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles.identityOperator)
  }
}

// Mettre à jour une app ou un job demande aussi le droit de les rattacher à l'environnement.
resource githubOnEnvironment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(environment.id, githubIdentity.id, roles.contributor)
  scope: environment
  properties: {
    principalId: githubIdentity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles.contributor)
  }
}

// ─── Budget ──────────────────────────────────────────────────────────────────────────────────
resource budget 'Microsoft.Consumption/budgets@2023-05-01' = if (!empty(budgetContactEmail)) {
  name: 'budget-creno'
  properties: {
    category: 'Cost'
    amount: budgetAmount
    timeGrain: 'Monthly'
    timePeriod: { startDate: empty(budgetStartDate) ? currentMonth : budgetStartDate }
    notifications: {
      firstEuro: {
        enabled: true
        operator: 'GreaterThanOrEqualTo'
        threshold: 20
        thresholdType: 'Actual'
        contactEmails: [budgetContactEmail]
      }
      reached: {
        enabled: true
        operator: 'GreaterThanOrEqualTo'
        threshold: 100
        thresholdType: 'Actual'
        contactEmails: [budgetContactEmail]
      }
      forecast: {
        enabled: true
        operator: 'GreaterThanOrEqualTo'
        threshold: 100
        thresholdType: 'Forecasted'
        contactEmails: [budgetContactEmail]
      }
    }
  }
}

// ─── Sorties (utilisées par le runbook et la CI) ─────────────────────────────────────────────
output apiUrl string = 'https://${apiName}.${environment.properties.defaultDomain}'
output keyVaultName string = vault.name
output migrationKeyVaultName string = migrationVault.name
output postgresHost string = postgres.properties.fullyQualifiedDomainName
output githubClientId string = githubIdentity.properties.clientId
output resourceGroupName string = resourceGroup().name
