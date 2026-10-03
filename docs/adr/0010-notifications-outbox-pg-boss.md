# ADR 0010 — Notifications par outbox transactionnelle, jobs pg-boss dans Postgres

- Statut : accepté
- Date : 2026-10-02

## Contexte

Une réservation confirmée, annulée ou remboursée doit prévenir le client et le prestataire (email), et rappeler le créneau la veille (email et SMS). Ces envois passent par des services externes (Resend, Twilio) qui peuvent être lents ou en panne. Deux risques : prévenir d'un changement qui n'a finalement pas eu lieu (transaction annulée après l'envoi), ou ne jamais prévenir d'un changement qui a eu lieu (l'API tombe entre le commit et l'envoi).

## Décision

- **pg-boss** : une file de jobs stockée dans Postgres. Il installe et met à jour son propre schéma (`pgboss`) au démarrage de l'API ; nos migrations Drizzle ne le connaissent pas. Les workers tournent dans le processus de l'API ; `JOBS_WORKERS_ENABLED=false` donne une instance qui crée des jobs sans en exécuter.
- **Outbox transactionnelle.** La table `notifications` porte une ligne par message à envoyer. Cette ligne **et** son job d'envoi sont écrits dans la transaction qui change le statut de la réservation (`boss.send(…, { db: fromDrizzle(tx, sql) })`). Transaction annulée (erreur, deadlock rejoué) : ni ligne ni job. Transaction validée : le job existe, l'envoi aura lieu même si l'API tombe juste après. Aucun appel à Resend ou Twilio pendant une requête HTTP ou un webhook Stripe.
- **Idempotence par la base.** `UNIQUE (booking_id, kind, channel, recipient_id)` + `ON CONFLICT DO NOTHING` : un webhook rejoué n'insère rien, donc ne crée aucun job. Le worker ne traite qu'une ligne `pending`. pg-boss livre « au moins une fois » : l'email part avec l'en-tête `Idempotency-Key` de Resend (l'identifiant de la notification).
- **Aucune donnée personnelle dans les jobs.** Un job ne contient que `{ notificationId }`. L'adresse, le numéro et la réservation sont relus au moment de l'envoi ; `notifications` ne stocke ni adresse ni contenu.
- **État revérifié à l'envoi.** Une confirmation ou un rappel dont la réservation n'est plus `confirmed` est clos en `skipped`. Annuler une réservation ne demande donc d'annuler aucun job.
- **Le rappel n'est pas un job différé.** Sa ligne est créée en `scheduled` avec `scheduled_for = début − 24 h`, seulement si cet instant est dans le futur (un créneau réservé la veille n'a pas de rappel : il partirait avec la confirmation). Une tâche planifiée passe les lignes dues en `pending` et crée leurs jobs toutes les 5 minutes. pg-boss supprime un job resté 14 jours en attente, alors qu'un créneau se réserve des mois à l'avance : l'échéance vit dans notre table.
- **Reprises et file morte.** Cinq reprises en backoff exponentiel (30 s de base). Un job qui les épuise est copié dans `notifications.dead`, dont le worker passe la ligne en `failed` et loggue en `error`. Un refus définitif du fournisseur (4xx : adresse ou numéro invalide) donne `failed` tout de suite.
- **Passerelles derrière une interface**, appelées par `fetch`, sans SDK : `EMAIL_GATEWAY` (Resend ; à défaut Mailpit, une boîte de réception de développement ; à défaut rien) et `SMS_GATEWAY` (Twilio). Sans configuration, la notification est `skipped` (`not_configured`) : `docker compose up` marche sans aucun compte.
- **Ménage planifié** : holds expirés passés à `expired` (et session Checkout fermée chez Stripe), sessions mortes et événements Stripe de plus de 90 jours supprimés. Ces tâches lisent avec `FOR UPDATE SKIP LOCKED` : elles n'attendent jamais une réservation ou un webhook en cours.

## Conséquences

- Les notifications partent avec un léger décalage (le worker interroge la file toutes les 2 s ; un rappel peut partir jusqu'à 5 min après son échéance).
- Twilio n'a pas de clé d'idempotence : si le processus meurt entre l'envoi du SMS et l'écriture du statut, le job rejoué renvoie le SMS. Rare, accepté. Deux cas sont traités pour limiter les doublons : un délai dépassé pendant l'envoi d'un SMS donne `failed` sans reprise (le message est peut-être parti) ; et si seule l'écriture du statut échoue, le SMS n'est pas rejoué (log `error` `notification.sent_unrecorded`, la ligne reste `pending` : à passer à `sent` à la main après vérification chez Twilio, aucun balayage ne la reprend). L'email, lui, est rejoué sans risque grâce à la clé d'idempotence.
- L'API ne démarre plus si la base est injoignable : pg-boss vérifie son schéma au démarrage. Le conteneur est alors relancé par l'orchestrateur.
- pg-boss crée son schéma : le rôle de base de l'API a besoin du droit `CREATE` sur la base. En production (étape 9), le schéma sera installé par le rôle de migration et l'API tournera avec `migrate: false`.
- **L'email et le téléphone ne sont pas encore vérifiés** (étape 6 bis) : un compte peut porter l'adresse ou le numéro d'un tiers. D'ici là, deux freins : SMS réservés aux préfixes de `SMS_ALLOWED_PREFIXES` (mobiles français par défaut, donc pas de numéro surtaxé à l'étranger), et un plafond par destinataire (5 SMS par jour, 30 emails par heure) au-delà duquel la notification est `skipped` (`rate_limited`). Ces plafonds sont par compte : plusieurs comptes portant le même numéro ou des alias de la même boîte les contournent. Seule la vérification règle le problème ; elle doit être livrée avant tout déploiement public. **Mise à jour** : l'adresse email est confirmée à l'inscription depuis l'[ADR 0011](0011-pending-registration-uniform-signup.md) ; le téléphone reste à vérifier (étape `phone-verification`).
- Les `CREATE INDEX` de la migration ne sont pas `CONCURRENTLY` (impossible dans la transaction du migrateur) : ils bloquent brièvement les écritures sur `bookings` et `stripe_events`. Sans effet à notre volume ; sur une grosse base, ils iraient dans une migration à part.
- pg-boss ouvre son propre pool (4 connexions) en plus de celui de l'API (10) : à compter dans la limite de connexions du serveur Postgres.
- Le job de ménage des holds ne change rien à la correction : la réservation suivante expire déjà les holds qui la gênent, et le calcul des créneaux les ignore (ADR 0002). Un paiement reçu après son passage suit le chemin de l'ADR 0009 (confirmation si le créneau est libre, sinon remboursement et email).
- Les SMS sont limités au rappel et à l'alphabet GSM-7 (160 caractères, un segment) : un seul caractère hors de cet alphabet triplerait le prix du message.
- En production, `RESEND_API_KEY` est obligatoire et `MAILPIT_URL` refusée.

## Alternatives écartées

- **Envoyer l'email dans la requête, après le commit** : une panne de Resend ralentit ou fait échouer la réservation, et un arrêt de l'API entre le commit et l'envoi perd le message sans trace.
- **BullMQ + Redis** : un service de plus à déployer et à payer, et surtout pas de transaction commune avec Postgres : il faudrait quand même une table outbox et un relais.
- **`@nestjs/outbox`** : même idée, mais pg-boss apporte déjà les reprises, la file morte et les tâches planifiées dont le ménage a besoin.
- **Un job différé par rappel (`startAfter`)** : supprimé par la rétention de pg-boss pour les créneaux lointains, et à annuler à chaque annulation.
- **SDK Resend et Twilio** : deux dépendances pour deux requêtes HTTP ; `fetch` avec un timeout suffit et se teste en injectant un faux `fetch`, comme le géocodeur (ADR 0008).
- **react-email** : ferait entrer React dans l'API pour six gabarits ; des fonctions TypeScript pures suffisent.
