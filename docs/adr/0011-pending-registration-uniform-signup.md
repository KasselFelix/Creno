# ADR 0011 — Inscription par lien : l'email d'abord, le compte depuis le lien

- Statut : accepté
- Date : 2026-10-03

## Contexte

Jusqu'ici, l'inscription créait le compte et ouvrait la session tout de suite, et un email déjà pris donnait `409 EMAIL_TAKEN` (ADR 0005). Deux problèmes : le formulaire permettait de savoir qui est inscrit sur Creno, et un compte pouvait porter l'adresse de quelqu'un d'autre, qui recevait alors ses emails de réservation (ADR 0010). Il n'existe pas de « mot de passe oublié ».

## Décision

- **Deux étapes.** `POST /auth/register { email }` ne demande qu'une adresse et répond `202` sans corps ni cookie. Le lien reçu mène à `/register/complete`, où l'on choisit rôle, nom et mot de passe ; `POST /auth/register/complete { token, role, fullName, password }` crée le compte et ouvre la session.
- **Rien de ce qu'a saisi l'auteur de la demande ne finit dans le compte.** Il n'a donné qu'une adresse. Le mot de passe est choisi par celui qui a ouvert le lien, donc par le titulaire de la boîte mail. Aucun hash de mot de passe n'attend en base.
- **Réponse uniforme par construction.** La première étape ne lit jamais `users` : elle fait le même travail (verrou, comptage, INSERT, job) que l'adresse ait déjà un compte ou non. C'est le worker qui tranche : lien d'inscription pour une adresse nouvelle, email « vous avez déjà un compte » sinon. Seul le titulaire de la boîte mail voit la différence.
- **`pending_registrations` ne contient que l'adresse et le hash du lien.** Plusieurs demandes peuvent viser la même adresse (pas d'unicité) ; leurs liens se valent, le premier utilisé crée le compte et supprime les autres. `users.email_verified_at` est `NOT NULL` sans valeur par défaut : toute ligne de `users` est une adresse prouvée, donc la réservation et les notifications n'ont rien à vérifier de plus.
- **Jeton `<id>.<secret>`**, comme le refresh token : 256 bits aléatoires, seul `sha256(secret)` est en base, comparaison en temps constant, 24 h, usage unique. Le secret est généré **par le worker au moment de l'envoi** : ni la base ni le job (`{ pendingRegistrationId }`) ne contiennent de quoi fabriquer un lien.
- **Le lien met le jeton dans le fragment** (`/register/complete#<jeton>`) : le navigateur ne l'envoie pas au serveur web, il n'est donc ni dans ses logs ni dans un `Referer`. Le compte n'est créé qu'à l'envoi du formulaire : un antivirus de messagerie qui précharge les liens ne consomme pas le jeton. Après succès, la page est remplacée dans l'historique.
- **Le lien est vérifié avant le hash argon2** : un jeton bidon ne coûte pas un calcul de mot de passe.
- **Sérialisation par adresse** : demande et fin d'inscription prennent un verrou consultatif de transaction sur l'adresse (`pg_advisory_xact_lock`). Le plafond est exact même en rafale, et deux liens d'une même adresse utilisés en même temps donnent un compte et un refus, sans deadlock.
- **Freins à l'envoi d'emails** : 3 emails d'inscription par adresse et par heure (au-delà, `202` sans ligne ni email) ; par IP, 10 demandes par minute et `REGISTRATION_RATE_LIMIT_PER_HOUR` (20) par heure, quelle que soit l'adresse.
- **Aucun texte saisi dans un email d'inscription** : le lien ne salue personne, et l'email « déjà un compte » salue le nom du compte existant, choisi par son titulaire.
- **Ménage** : les demandes expirées sont supprimées toutes les heures.

## Conséquences

- Se connecter avant d'avoir terminé l'inscription donne `401 INVALID_CREDENTIALS` (le compte n'existe pas) ; la page de connexion le rappelle sous l'erreur.
- On n'est pas ramené à la page d'où l'on venait : après l'inscription, on arrive sur `/account` ou `/dashboard`.
- Pas de bouton « renvoyer le lien » : on refait une demande, dans la limite du plafond.
- **Le plafond par adresse peut être saturé par un tiers** : sa propre demande ne déclenche alors aucun email, mais les liens reçus à cause du tiers lui servent tout autant, puisqu'aucun ne porte de profil ni de mot de passe. Testé dans `registration.e2e-spec.ts`.
- **Risque résiduel** : celui qui obtient un lien valable avant son destinataire crée le compte de cette adresse. Le lien ne transite que par la boîte mail ; avant le déploiement, il faudra désactiver le suivi des clics chez Resend, qui réécrirait le lien et le verrait passer.
- Les alias (`prenom+tag@…`) sont des adresses distinctes pour le plafond : une même boîte peut recevoir plus de 3 emails par heure, dans la limite horaire par IP. Celle-ci ne compte la vraie IP du visiteur qu'avec un `TRUST_PROXY` juste (étape 9) ; un CAPTCHA sur `/register` reste possible si l'abus apparaît.
- Une reprise du job après un échec ambigu (délai dépassé) génère un nouveau secret : si le premier email était parti, son lien est mort et c'est le second qui fonctionne.
- **Passerelle email non configurée** (ni Resend ni Mailpit) : le job s'arrête sans reprise avec un log `warn`, comme pour les notifications (ADR 0010) ; réessayer n'y changerait rien. Ce cas n'existe pas en production, où `RESEND_API_KEY` est obligatoire.
- **Déploiement** : `users.email_verified_at` est `NOT NULL` sans valeur par défaut. Pendant une bascule progressive, une ancienne révision de l'API ne pourrait plus créer de compte tant qu'elle tourne. Sans effet aujourd'hui (aucune production) ; une évolution de ce type se fera ensuite en deux migrations (colonne nullable, puis `NOT NULL` à la version suivante).
- Le téléphone n'était pas encore vérifié à cette date : c'est fait depuis l'[ADR 0012](0012-verified-phone-only.md).
- Les comptes créés avant cette migration sont considérés vérifiés à leur date de création (aucune production à cette date).

## Alternatives écartées

- **Formulaire complet à la première étape (nom, rôle, mot de passe), compte créé au clic** : c'était la première version de cette étape. La review de sécurité a montré qu'un tiers pouvait remplir le plafond de l'adresse avec son propre mot de passe : la vraie demande ne partait plus, et les seuls liens reçus créaient un compte dont le tiers connaissait le mot de passe.
- **Créer le compte tout de suite, « non vérifié », et bloquer seulement la réservation** : la réponse uniforme interdit d'ouvrir une session à l'inscription, donc le gain d'ergonomie est mince ; en échange, il faut un état « non vérifié » partout (réservation, notifications, bandeau, renvoi du lien) et une adresse peut être occupée par le premier venu tant qu'il n'y a pas de « mot de passe oublié ».
- **Jeton JWT sans état** (comme `brocoders/nestjs-boilerplate`) : pas d'usage unique sans table, et une clé de signature de plus à protéger.
- **Jeton dérivé d'un secret serveur (HMAC de l'identifiant)** : stable d'une reprise à l'autre, mais demande une nouvelle variable d'environnement ; le cas qu'il améliore (double envoi après un délai dépassé) ne le justifie pas.
- **Envoyer l'email pendant la requête** : la durée de la réponse dépendrait du fournisseur, et une panne perdrait le message (ADR 0010).
