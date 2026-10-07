# ADR 0016 — Déploiement : Azure Container Apps, Postgres flexible, Vercel

- Statut : accepté
- Date : 2026-10-08

## Contexte

Creno doit être en ligne comme démo publique de portfolio : API NestJS, PostgreSQL avec PostGIS, front Next.js. Contraintes :

- **coût nul ou presque** : la démo tourne sur un compte Azure gratuit (crédit d'un mois, puis 12 mois de services gratuits et des quotas toujours gratuits) ;
- **aucun secret** dans le dépôt ni dans GitHub ;
- les règles déjà posées : migrations immuables, logs sans donnée personnelle, limites de débit par IP, cookies first-party (ADR 0005).

## Décision

**API sur Azure Container Apps, plan Consumption, de 0 à 1 réplica.** Sans trafic pendant 5 minutes, l'API descend à zéro réplica : rien n'est facturé, et le quota mensuel gratuit (180 000 vCPU-secondes) couvre environ 200 heures d'activité à 0,25 vCPU. Le prix : le premier visiteur après une pause attend 10 à 20 s. Le front attend jusqu'à 25 s (au lieu de 2 à 5) et le bandeau de démo le signale. Les tâches planifiées de pg-boss (rappels, ménage) attendent le réveil : leur correction n'en dépend pas (un rappel peut partir en retard ou être sauté si le créneau a commencé). Au plus un réplica : le throttler, le circuit breaker de l'IA et le plafond IA journalier restent en mémoire (ADR 0013).

**PostgreSQL Flexible Server B1ms, accès public filtré.** Gratuit 12 mois. Un réseau privé (VNet) aurait coûté ~22 €/mois : Container Apps ajoute un load balancer standard et deux IP publiques dès qu'il est branché sur un VNet. La base garde donc une IP publique, ouverte aux seules IP d'Azure (règle « services Azure », qui inclut celles des autres clients d'Azure). Protection :

- TLS obligatoire, certificat et nom d'hôte vérifiés (`sslmode=verify-full`) ;
- mots de passe aléatoires de 256 bits, authentification SCRAM ;
- **deux rôles** : `creno_admin` (migrations, propriétaire des objets) et `creno_app` (l'API), qui lit et écrit sans aucun droit de DDL. Le job de migration crée `creno_app`, lui donne ses droits et les privilèges par défaut des objets futurs.

**Un job de migration** (Container Apps Job, même image que l'API) lancé par la CI avant chaque mise à jour : migrations Drizzle, schéma `pgboss` (l'API démarre pg-boss avec `migrate: false`), rôle applicatif, seed de démo sur une base vide. Il tourne sous un verrou consultatif Postgres. Le même `migrateAll` sert en dev (`pnpm db:migrate`) et dans le setup des tests : le chemin de production est exercé à chaque `pnpm test`.

**Secrets dans Key Vault**, lus par l'API et le job via une identité managée (références Key Vault de Container Apps) ; aucun secret dans le Bicep ni dans les paramètres.

**GitHub Actions s'authentifie par OIDC** sur une identité managée avec identifiant fédéré (`repo:KasselFelix/Creno:environment:production`) : un jeton à durée courte, sans App Registration ni secret client. Cette identité ne peut que modifier l'API, le job et l'environnement Container Apps.

**Déploiement continu** : le job `deploy` de la CI (`needs` sur tous les autres jobs, push sur `main` seulement) appelle le workflow réutilisable `deploy-api.yml`. Il déploie le **digest** de l'image construite et testée par le job `prod-image` (migration puis API démarrée en mode production sous le rôle applicatif), puis vérifie que `GET /health` renvoie le nouveau commit. `workflow_run` a été écarté : son filtre de branche porte sur le nom de la branche d'origine, et une PR venant d'un fork nommée `main` aurait pu déclencher un déploiement.

**Images sur GitHub Container Registry**, publiques (elles ne contiennent aucun secret, le code est public) : gratuit et sans identifiants. Azure Container Registry coûterait ~4,5 €/mois (Basic), et l'offre gratuite de 12 mois (Standard) passerait ensuite à ~20 €/mois.

**Front sur Vercel**, fonctions à Paris (`cdg1`) : par défaut à Washington, chaque rendu serveur ferait des allers-retours transatlantiques vers l'API. Le navigateur n'appelle que le domaine du front (cookies first-party, ADR 0005) ; `proxy.ts` relaie `/api/*` vers l'API.

**IP réelle du visiteur par secret partagé.** Tous les appels à l'API viennent de Vercel : sans relais, tous les visiteurs partageraient les mêmes compteurs de limite de débit. Le serveur Next transmet `x-creno-client-ip` (lu dans `x-real-ip`, que Vercel réécrit) avec `x-creno-proxy-secret` ; l'API ne croit l'IP transmise que si le secret correspond (comparaison à temps constant), sinon elle garde l'adresse de la connexion (`TRUST_PROXY=1` derrière l'ingress de Container Apps). Les limites qui protègent la charge (`public`, `bookings`) comptent par compte quand la requête est authentifiée ; celles qui protègent un coût (SMS, IA) ou des identifiants restent par IP.

**Démo en mode test** (`DEMO_MODE=true`) : Stripe en clé `sk_test_` obligatoire (une clé live est refusée), Twilio facultatif (la vérification par SMS répond alors `503 SMS_UNAVAILABLE`), seed de démo sans compte admin, aucun email vers les adresses de démo (`@example.com`). Sans `DEMO_MODE`, la production exige une clé live et Twilio.

**Erreurs dans Sentry**, sans donnée personnelle : chaque log `error` devient un événement à partir de la ligne JSON déjà masquée par pino ; ni cookie, ni en-tête, ni corps, ni query string, ni IP. Le navigateur passe par un tunnel (`/monitoring`) : aucun domaine tiers dans la CSP.

## Alternatives écartées

- **Azure App Service** : l'offre gratuite (F1) est limitée à 60 minutes de CPU par jour ; l'offre B1 coûte ~12 €/mois, sans mise en veille.
- **AKS** : un cluster pour un seul conteneur, et un coût fixe.
- **VNet + Postgres privé** : la bonne cible pour une vraie production (~22 €/mois de plus) ; l'infra est écrite pour pouvoir y passer.
- **Authentification Entra ID vers Postgres** (identité managée, sans mot de passe) : plus solide qu'un mot de passe, mais un chemin différent en dev et en CI. Évolution possible.
- **Un seul rôle Postgres** : une injection SQL pourrait alors modifier le schéma.

## Conséquences

- Coût : 0 € par mois pendant 12 mois (hors nom de domaine), à condition de passer la souscription en paiement à l'utilisation avant la fin du crédit d'essai. Ensuite, Postgres coûte ~16 €/mois (à arrêter ou migrer, voir `docs/deploy.md`).
- Premier chargement lent après une pause ; tâches planifiées en pause pendant la veille.
- Toute évolution du schéma reste compatible avec la version précédente de l'API, qui tourne pendant la migration (colonne `NOT NULL` en deux migrations, pas de renommage en une fois).
- Les previews Vercel appellent l'API de production en lecture seule (leurs POST sont refusés par le contrôle d'origine).
