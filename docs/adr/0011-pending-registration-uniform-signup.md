# ADR 0011 — Inscription en attente : le compte naît à la confirmation de l'adresse

- Statut : accepté
- Date : 2026-10-03

## Contexte

Jusqu'ici, l'inscription créait le compte et ouvrait la session tout de suite, et un email déjà pris donnait `409 EMAIL_TAKEN` (ADR 0005). Deux problèmes : le formulaire permettait de savoir qui est inscrit sur Creno, et un compte pouvait porter l'adresse de quelqu'un d'autre, qui recevait alors ses emails de réservation (ADR 0010). Il n'existe pas de « mot de passe oublié ».

## Décision

- **`POST /auth/register` ne crée pas de compte.** Il écrit une ligne `pending_registrations` (adresse, nom, rôle, hash argon2id du mot de passe) et, dans la même transaction, un job pg-boss. Il répond `202` sans corps ni cookie.
- **Réponse uniforme par construction.** La requête ne lit jamais `users` : elle fait le même travail (hash, comptage, INSERT, job) que l'adresse ait déjà un compte ou non. C'est le worker qui tranche : lien de confirmation pour une adresse nouvelle, email « vous avez déjà un compte » sinon. Seul le titulaire de la boîte mail voit la différence.
- **Le compte est créé au clic**, par `POST /auth/email/verify`, avec le nom, le rôle et le mot de passe de la tentative dont vient le lien. Toutes les tentatives de l'adresse sont alors supprimées. `users.email_verified_at` est `NOT NULL` sans valeur par défaut : toute ligne de `users` est une adresse prouvée, donc la réservation et les notifications n'ont rien à vérifier de plus.
- **Plusieurs tentatives peuvent coexister pour une adresse** (pas d'unicité sur `pending_registrations.email`). Personne ne peut « réserver » l'adresse d'un autre en s'inscrivant le premier : chaque lien porte ses propres identifiants, le premier confirmé gagne.
- **Jeton `<id>.<secret>`**, comme le refresh token : 256 bits aléatoires, seul `sha256(secret)` est en base, comparaison en temps constant, 24 h, usage unique. Le secret est généré **par le worker au moment de l'envoi** : ni la base ni le job (`{ pendingRegistrationId }`) ne contiennent de quoi fabriquer un lien.
- **Le lien met le jeton dans le fragment** (`/verify-email#<jeton>`) : le navigateur ne l'envoie pas au serveur web, il n'est donc ni dans ses logs ni dans un `Referer`. La page demande un clic avant d'appeler l'API : un antivirus de messagerie qui précharge les liens ne consomme pas le jeton.
- **La confirmation n'ouvre pas de session.** Le lien prouve l'accès à la boîte mail, pas la connaissance du mot de passe.
- **Sérialisation par adresse** : inscription et confirmation prennent un verrou consultatif de transaction sur l'adresse (`pg_advisory_xact_lock`). Le plafond est exact même en rafale, et deux liens d'une même adresse confirmés en même temps donnent un compte et un refus, sans deadlock.
- **Plafond : 3 emails d'inscription par adresse et par heure**, en plus de la limite par IP. Au-delà, `202` sans ligne ni email.
- **L'email de confirmation ne contient aucun texte saisi dans le formulaire** (pas de « Bonjour <nom> ») : sinon, n'importe qui ferait envoyer par Creno le message de son choix à l'adresse de son choix.
- **Ménage** : les tentatives expirées sont supprimées toutes les heures (elles portent un hash de mot de passe).

## Conséquences

- Une étape de plus avant de pouvoir réserver : il faut ouvrir l'email, puis se connecter. On n'est pas ramené à la page d'où l'on venait.
- Se connecter avant d'avoir confirmé donne `401 INVALID_CREDENTIALS` (le compte n'existe pas) ; la page de connexion le rappelle sous l'erreur.
- Pas de bouton « renvoyer le lien » : on refait l'inscription, dans la limite du plafond.
- **Risque résiduel** : si quelqu'un demande une inscription avec l'adresse d'un tiers et que ce tiers clique sur le lien, le compte est créé avec le mot de passe du demandeur. L'email dit d'ignorer un message non sollicité, et le tiers ne se retrouve pas connecté à ce compte (pas de session à la confirmation). Un « mot de passe oublié » lui permettra de le reprendre ; il n'existe pas encore.
- Une reprise du job après un échec ambigu (délai dépassé) génère un nouveau secret : si le premier email était parti, son lien est mort et c'est le second qui fonctionne.
- Une tentative faite sur une adresse déjà inscrite reste en base jusqu'à son expiration (elle compte pour le plafond) mais n'a jamais de `token_hash` : personne ne peut la confirmer.
- **Le plafond se retourne contre l'adresse visée** : trois demandes faites par un tiers empêchent le vrai titulaire de recevoir un lien pendant une heure (il reçoit quand même les trois emails du tiers, dont il ne doit pas se servir). C'est le prix d'un plafond par adresse non prouvée ; la limite par IP ralentit l'abus.
- **Passerelle email non configurée** (ni Resend ni Mailpit) : le job s'arrête sans reprise avec un log `warn`, comme pour les notifications (ADR 0010) ; réessayer n'y changerait rien. La personne a reçu un 202 et aucun email. Ce cas n'existe pas en production, où `RESEND_API_KEY` est obligatoire.
- **Déploiement** : `users.email_verified_at` est `NOT NULL` sans valeur par défaut. Pendant une bascule progressive, une ancienne révision de l'API ne pourrait plus créer de compte tant qu'elle tourne. Sans effet aujourd'hui (aucune production) ; une évolution de ce type se fera ensuite en deux migrations (colonne nullable, puis `NOT NULL` à la version suivante).
- Le téléphone n'est toujours pas vérifié : les garde-fous SMS de l'ADR 0010 restent en place jusqu'à l'étape `phone-verification`.
- Les comptes créés avant cette migration sont considérés vérifiés à leur date de création (aucune production à cette date).

## Alternatives écartées

- **Créer le compte tout de suite, « non vérifié », et bloquer seulement la réservation** : la réponse uniforme interdit d'ouvrir une session à l'inscription, donc le gain d'ergonomie est mince ; en échange, il faut un état « non vérifié » partout (réservation, notifications, bandeau, renvoi du lien) et une adresse peut être occupée par le premier venu tant qu'il n'y a pas de « mot de passe oublié ».
- **Jeton JWT sans état** (comme `brocoders/nestjs-boilerplate`) : pas d'usage unique sans table, et une clé de signature de plus à protéger.
- **Jeton dérivé d'un secret serveur (HMAC de l'identifiant)** : stable d'une reprise à l'autre, mais demande une nouvelle variable d'environnement ; le cas qu'il améliore (double envoi après un délai dépassé) ne le justifie pas.
- **Envoyer l'email pendant la requête** : la durée de la réponse dépendrait du fournisseur, et une panne perdrait le message (ADR 0010).
- **Ouvrir une session à la confirmation** : le tiers du risque résiduel se retrouverait connecté, sans le savoir, à un compte dont un autre connaît le mot de passe.
