# Déploiement — runbook

Mise en ligne de Creno : API sur **Azure Container Apps**, base **Azure Database for PostgreSQL**, front sur **Vercel**, erreurs dans **Sentry**. Tout tient dans les offres gratuites (voir [Coûts](#coûts-et-garde-fous)). Les choix sont expliqués dans l'[ADR 0016](adr/0016-deploiement-azure-container-apps.md).

```
Navigateur ─> Vercel (Next.js, Paris) ─ /api/* et rendus serveur + IP du visiteur ─┐
Stripe (webhooks) ─────────────────────────────────────────────────────────────────┤
                                                                                   v
           Azure rg-creno (France Central)    Container App ca-creno-api (0 à 1 réplica)
                                                │  secrets = références Key Vault
           PostgreSQL B1ms (PG 17) <────────────┤  job caj-creno-migrate (lancé par la CI)
GitHub Actions ─OIDC─> Azure · image ─> ghcr.io/kasselfelix/creno-api
```

Après la mise en place, **chaque merge sur `main` redéploie l'API** : la CI construit et teste l'image, la pousse sur GHCR, lance le job de migration puis met à jour l'API et vérifie que `GET /health` renvoie le nouveau commit. Le front est redéployé par Vercel.

## 1. Préparer la souscription

```bash
az login --use-device-code
az account show --query "{name:name, id:id}"     # la bonne souscription ?

# Une souscription neuve n'a aucun fournisseur de ressources enregistré (gratuit, ~1 min chacun).
for ns in Microsoft.App Microsoft.DBforPostgreSQL Microsoft.KeyVault \
          Microsoft.OperationalInsights Microsoft.ManagedIdentity Microsoft.Network; do
  az provider register --namespace "$ns" --wait
done

az group create -n rg-creno -l francecentral
```

## 2. Variables du déploiement

Le fichier `infra/main.bicepparam` lit ses valeurs dans l'environnement du shell : rien de secret dans le dépôt ni dans l'historique. À refaire dans chaque nouveau terminal.

```bash
export CRENO_OPERATOR_ID="$(az ad signed-in-user show --query id -o tsv)"
export CRENO_WEB_ORIGIN="https://creno.<votre-domaine>"
export CRENO_EMAIL_FROM="Creno <bonjour@<votre-domaine>>"
export CRENO_BUDGET_EMAIL="<votre email>"
# Hexadécimal : aucun caractère à échapper dans une URL Postgres.
export CRENO_PG_ADMIN_PASSWORD="$(openssl rand -hex 32)"
```

> Le mot de passe admin de Postgres est généré **une seule fois** et rangé dans le coffre à l'étape 4. Pour toute relance du Bicep ensuite : `export CRENO_PG_ADMIN_PASSWORD="$(az keyvault secret show --vault-name "$KV" -n postgres-admin-password --query value -o tsv)"` (sinon le mot de passe changerait).

## 3. Infra, premier passage (sans API)

```bash
cd creno
az deployment group what-if -g rg-creno --parameters infra/main.bicepparam
az deployment group create -g rg-creno --parameters infra/main.bicepparam

out() { az deployment group show -g rg-creno -n main --query "properties.outputs.$1.value" -o tsv; }
export KV="$(out keyVaultName)" PG_HOST="$(out postgresHost)" API_URL="$(out apiUrl)"
echo "$API_URL"   # https://ca-creno-api.<…>.francecentral.azurecontainerapps.io
```

Crée : Log Analytics, Key Vault, identités (API, GitHub), PostgreSQL B1ms, environnement Container Apps, budget. L'URL de l'API est connue dès maintenant (le nom de l'app est fixe).

## 4. Services externes, puis secrets

**Stripe (mode test)**, Dashboard → Developers → Webhooks :

- endpoint « Your account » : `$API_URL/v1/payments/webhook`, événements `checkout.session.completed`, `checkout.session.expired`, `charge.refunded` → son secret `whsec_…` ;
- endpoint « Connected accounts » : même URL, événement `account.updated` → son secret.

**Resend** : ajouter le domaine, poser les enregistrements DNS (SPF, DKIM, DMARC), **désactiver le suivi des clics et des ouvertures** (il réécrirait le lien d'inscription et verrait son jeton), créer une clé « Sending access ».

**Sentry** (facultatif) : créer l'organisation en **région UE**, activer _Prevent Storing of IP Addresses_, deux projets (`creno-api` Node.js, `creno-web` Next.js).

**Mistral** (facultatif) : désactiver l'entraînement sur vos données (Settings → Privacy), garder `AI_DAILY_REQUEST_CAP` bas.

Puis les secrets. Les valeurs tapées passent par `read -rs` (ni écho, ni historique) :

```bash
secret() { az keyvault secret set --vault-name "$KV" -n "$1" --value "$2" -o none; }
# Si « Forbidden » : le rôle Key Vault Secrets Officer met quelques minutes à se propager.

APP_DB_PASSWORD="$(openssl rand -hex 32)"
secret postgres-admin-password "$CRENO_PG_ADMIN_PASSWORD"
secret database-url-migrate "postgres://creno_admin:${CRENO_PG_ADMIN_PASSWORD}@${PG_HOST}:5432/creno?sslmode=verify-full"
secret database-url "postgres://creno_app:${APP_DB_PASSWORD}@${PG_HOST}:5432/creno?sslmode=verify-full"
secret jwt-access-secret "$(openssl rand -base64 48)"
secret client-ip-secret "$(openssl rand -hex 32)"   # aussi dans Vercel (étape 7)

read -rs v && secret stripe-secret-key "$v"               # sk_test_…
read -rs v && secret stripe-webhook-secret "$v"           # whsec_… (endpoint compte)
read -rs v && secret stripe-connect-webhook-secret "$v"   # whsec_… (endpoint Connect)
read -rs v && secret resend-api-key "$v"                  # re_…
read -rs v && secret mistral-api-key "$v"                 # facultatif : export CRENO_MISTRAL_ENABLED=true
read -rs v && secret sentry-dsn "$v"                      # facultatif : export CRENO_SENTRY_ENABLED=true
unset v
```

Compte Stripe de démo (facultatif) : l'identifiant `acct_…` d'un compte Express de test, pour que « Studio Lumière » encaisse : `export CRENO_SEED_STRIPE_ACCOUNT_ID=acct_…`.

## 5. Première image

Pousser la branche et ouvrir la PR : le job `prod-image` de la CI construit l'image, la teste (migration + API sous le rôle applicatif) et la pousse sur `ghcr.io/kasselfelix/creno-api:<sha>`.

1. GitHub → Packages → `creno-api` → Package settings → **Change visibility → Public** (une fois : Container Apps la tire sans identifiants ; l'image ne contient aucun secret).
2. Récupérer son digest (immuable) :
   ```bash
   docker buildx imagetools inspect ghcr.io/kasselfelix/creno-api:<sha> --format '{{.Manifest.Digest}}'
   export CRENO_API_IMAGE="ghcr.io/kasselfelix/creno-api@sha256:<digest>"
   ```

## 6. Infra, second passage (API et job de migration)

```bash
az deployment group create -g rg-creno --parameters infra/main.bicepparam

# Premier lancement du job : migrations, schéma pg-boss, rôle creno_app, seed de démo.
az config set extension.use_dynamic_install=yes_without_prompt
az containerapp job start -n caj-creno-migrate -g rg-creno
az containerapp job execution list -n caj-creno-migrate -g rg-creno \
  --query "[0].{name:name, status:properties.status}" -o table   # jusqu'à Succeeded
az containerapp job logs show -n caj-creno-migrate -g rg-creno --container migrate   # en cas d'échec

curl -s "$API_URL/health"         # {"status":"ok","release":"<sha>"} (le 1er appel réveille l'API)
curl -s "$API_URL/health/ready"   # base joignable
```

Si l'API a démarré avant le job (rôle absent), `/health/ready` répond 503 : relancer la révision (`az containerapp revision restart -n ca-creno-api -g rg-creno --revision "$(az containerapp show -n ca-creno-api -g rg-creno --query properties.latestRevisionName -o tsv)"`).

## 7. GitHub et Vercel

**GitHub**, Settings → Environments → `production` : « Deployment branches » = `main` seulement. Puis Settings → Secrets and variables → Actions → **Variables** (pas des secrets : rien de sensible) :

| Variable                | Valeur                                       |
| ----------------------- | -------------------------------------------- |
| `AZURE_CLIENT_ID`       | `$(out githubClientId)`                      |
| `AZURE_TENANT_ID`       | `$(az account show --query tenantId -o tsv)` |
| `AZURE_SUBSCRIPTION_ID` | `$(az account show --query id -o tsv)`       |
| `RESOURCE_GROUP`        | `rg-creno`                                   |
| `API_URL`               | `$API_URL`                                   |

Tant que `AZURE_CLIENT_ID` n'existe pas, le job `deploy` de la CI est sauté.

**Vercel** : importer le dépôt, _Root Directory_ `apps/web`, Node.js 24. Les fonctions tournent à Paris (`apps/web/vercel.json`). Variables :

| Variable                                            | Production                                                                            | Preview    |
| --------------------------------------------------- | ------------------------------------------------------------------------------------- | ---------- |
| `API_INTERNAL_URL`                                  | `$API_URL`                                                                            | `$API_URL` |
| `CLIENT_IP_SECRET`                                  | `az keyvault secret show --vault-name "$KV" -n client-ip-secret --query value -o tsv` | —          |
| `NEXT_PUBLIC_DEMO_MODE`                             | `true`                                                                                | `true`     |
| `NEXT_PUBLIC_MAPBOX_TOKEN`                          | token `pk.…`                                                                          | idem       |
| `NEXT_PUBLIC_SENTRY_DSN`                            | DSN du projet `creno-web`                                                             | idem       |
| `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN` | envoi des sourcemaps                                                                  | —          |
| `ENABLE_EXPERIMENTAL_COREPACK`                      | `1` (pnpm de `packageManager`)                                                        | `1`        |

Domaine : ajouter `creno.<votre-domaine>` (CNAME vers Vercel). Les previews appellent l'API de production **en lecture seule** : leurs POST sont refusés (origine ≠ `WEB_ORIGIN`). Même chose pour l'alias `*.vercel.app` : utiliser le domaine.

**Mapbox** : restreindre le token aux URL `https://creno.<votre-domaine>` et `http://localhost:3000`.

## 8. Vérifier la mise en ligne

- `https://creno.<votre-domaine>` : recherche avec la carte, connexion avec un compte de démo (README), réservation payée avec `4242 4242 4242 4242` → réservation confirmée (webhook reçu).
- Inscription avec une adresse personnelle → lien reçu par email → confirmation de réservation reçue.
- IP réelle : 11 phrases de recherche IA en une minute depuis le Wi-Fi → 429 ; aussitôt depuis un téléphone en 4G → 200. Dans les logs (§ Exploitation), les requêtes ont `ipSource: "header"`.
- Sentry API (après avoir réveillé l'API) : `az containerapp exec -n ca-creno-api -g rg-creno --command "node --import ./dist/instrument.js dist/cli/sentry-check.js"`. Sentry web : dans la console du navigateur, `setTimeout(() => { throw new Error('sentry-check') })`.
- En-têtes : `curl -sI https://creno.<votre-domaine>/` (CSP, HSTS, nosniff) ; `curl -sI "$API_URL/health"` (`Cache-Control: no-store`).
- Mise en veille : 10 min sans requête → `az containerapp replica list -n ca-creno-api -g rg-creno` est vide.

## Exploitation

**Logs** (portail → Log Analytics → Logs) :

```kusto
ContainerAppConsoleLogs_CL
| where ContainerAppName_s == "ca-creno-api"
| extend log = parse_json(Log_s)
| where toint(log.level) >= 40          // warn et error
| project TimeGenerated, event = tostring(log.event), requestId = tostring(log.requestId), log
| order by TimeGenerated desc
```

**Changer un secret** : `secret <nom> <valeur>`, puis une nouvelle révision pour qu'elle le relise (`az containerapp update -n ca-creno-api -g rg-creno --revision-suffix "s$(date +%s)"`).

**psql** : la base n'accepte que les IP d'Azure. Ajouter temporairement la sienne, puis la retirer :

```bash
PG_NAME="${PG_HOST%%.*}"; MY_IP="$(curl -s https://api.ipify.org)"
az postgres flexible-server firewall-rule create -g rg-creno -n "$PG_NAME" --rule-name poste --start-ip-address "$MY_IP" --end-ip-address "$MY_IP"
psql "$(az keyvault secret show --vault-name "$KV" -n database-url-migrate --query value -o tsv)"
az postgres flexible-server firewall-rule delete -g rg-creno -n "$PG_NAME" --rule-name poste --yes
```

**Journée de démo** (pas de réveil de 20 s) : `az containerapp update -n ca-creno-api -g rg-creno --min-replicas 1` (~0,15 à 0,45 €/jour), puis `--min-replicas 0` le soir.

**Retour arrière** : `az containerapp update -n ca-creno-api -g rg-creno --image ghcr.io/kasselfelix/creno-api@sha256:<ancien>` (ou le workflow _Deploy API_ lancé à la main). Les migrations ne reculent pas : chaque migration reste compatible avec la version précédente de l'API (colonne `NOT NULL` en deux migrations, pas de renommage en une fois).

**Relancer le Bicep** (changement d'infra) : exporter les variables de l'étape 2, le mot de passe admin depuis le coffre, et l'image **en service**, sinon la relance ramènerait une ancienne version :

```bash
export CRENO_API_IMAGE="$(az containerapp show -n ca-creno-api -g rg-creno --query 'properties.template.containers[0].image' -o tsv)"
az deployment group what-if -g rg-creno --parameters infra/main.bicepparam
```

## Coûts et garde-fous

Souscription d'essai : 200 $ de crédit pendant 30 jours, puis **passage obligatoire en paiement à l'utilisation** (sinon tout est désactivé). Ensuite, seul ce qui dépasse les quotas gratuits est facturé, sans plafond automatique : le budget alerte dès 1 €.

| Ressource                              | Offre                                             | Coût                    |
| -------------------------------------- | ------------------------------------------------- | ----------------------- |
| PostgreSQL B1ms, 32 Go, sauvegarde 7 j | 750 h/mois pendant 12 mois                        | 0 €                     |
| Container Apps (API + job), 0,25 vCPU  | 180 000 vCPU-s / 360 000 Gio-s par mois, toujours | 0 € (~200 h d'activité) |
| Log Analytics (plafond 0,1 Go/jour)    | 5 Go/mois                                         | 0 €                     |
| Key Vault                              | quelques opérations                               | ≈ 0 €                   |
| Images                                 | GitHub Container Registry, public                 | 0 €                     |

À ne **jamais** activer sans regarder le prix : VNet ou endpoint privé (~22 €/mois), Azure Container Registry, haute disponibilité ou sauvegarde géo-redondante de Postgres, Postgres au-delà de B1ms / 32 Go, fenêtre de maintenance Container Apps, `--min-replicas 1` en permanence.

**Fin des 12 mois gratuits** : Postgres B1ms coûte ensuite ~16 €/mois. L'arrêter quand la démo ne sert pas (`az postgres flexible-server stop -g rg-creno -n "$PG_NAME"`, redémarrage automatique après 7 jours) ou migrer vers une offre gratuite qui accepte PostGIS (Neon).
