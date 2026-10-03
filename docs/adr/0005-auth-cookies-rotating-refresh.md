# ADR 0005 — Authentification par cookies `HttpOnly` et refresh token rotatif

- Statut : accepté
- Date : 2026-10-01

## Contexte

Les utilisateurs doivent rester connectés d'une visite à l'autre, pouvoir déconnecter un appareil, et un token volé doit avoir une durée de nuisance limitée. Le front est une application Next.js servie sur un autre domaine que l'API ; une application mobile viendra plus tard.

## Décision

- **Deux tokens, en cookies `HttpOnly`** posés par l'API : un access token JWT de 15 min (`SameSite=Lax`) et un refresh token opaque de 30 jours glissants (`SameSite=Strict`). `Secure` en production.
- **Cookies first-party** : le navigateur n'appelle que le front ; Next réécrit `/api/*` vers l'API. `proxy.ts` renouvelle la session côté serveur avant le rendu d'une page quand l'access token a expiré.
- **Sessions en base** : une ligne par appareil, refresh token stocké haché (sha256 d'un secret de 256 bits).
- **Rotation avec détection de réutilisation** : chaque refresh remplace le secret par un compare-and-swap. Un ancien secret reste accepté 10 secondes (plusieurs onglets qui renouvellent en même temps) ; au-delà, sa présentation révoque la session.
- **Mots de passe** en argon2id ; réponse identique, en contenu et en durée, pour un mauvais mot de passe et un email inconnu.
- **CSRF** : `SameSite`, corps JSON uniquement, et vérification de l'en-tête `Origin` sur les requêtes qui modifient.
- **Autorisation** : guard global (tout est privé sauf `@Public()`), rôles par `@Roles()`, propriété vérifiée dans les services.

## Conséquences

- Un XSS ne peut pas lire les tokens. Un refresh token volé est inutilisable dès que la victime ou le voleur renouvelle la session, et la session est alors révoquée.
- Après une déconnexion ou la révocation d'un appareil, son access token reste valable jusqu'à 15 minutes : c'est le prix d'un access token vérifié sans requête en base. Acceptable ici ; pour une action sensible, on vérifiera la session en base.
- Le refresh token est `SameSite=Strict` : en arrivant depuis un autre site (lien dans un email) avec un access token expiré, l'utilisateur repasse par la page de connexion alors que sa session est valide. Compromis accepté pour ne jamais envoyer le refresh token sur une navigation cross-site.
- Présenter un secret inconnu pour une session existante la révoque : c'est le prix de la détection de réutilisation (la base ne garde que les deux derniers hash). L'identifiant de session est un UUID aléatoire, visible seulement de son propriétaire.
- Le rate limit est en mémoire : suffisant pour une instance, à déplacer dans un stockage partagé si l'API passe à plusieurs réplicas.
- **Email déjà pris → 409 `EMAIL_TAKEN`** : choix d'ergonomie assumé, qui permet de tester l'existence d'un compte ; il est ralenti par le rate limit et sera revu quand la vérification d'email existera (réponse uniforme). **Remplacé par l'[ADR 0011](0011-pending-registration-uniform-signup.md)** : l'inscription répond désormais la même chose dans tous les cas.
- L'API accepte aussi `Authorization: Bearer` pour l'access token, ce qui prépare l'application mobile.

## Alternatives écartées

- **Tokens dans `localStorage` + en-tête `Authorization`** (choix de `brocoders/nestjs-boilerplate`) : un seul contrat pour web et mobile, mais les tokens sont lisibles par n'importe quel script de la page.
- **Session serveur classique (identifiant opaque vérifié en base à chaque requête)** : révocation immédiate, mais une lecture en base par requête.
- **Auth déléguée (Clerk, Auth0)** : plus rapide à intégrer, mais le projet sert à montrer la maîtrise de ces mécanismes.
- **Refresh token sans rotation** : plus simple, mais un token volé reste valable 30 jours sans que personne ne s'en aperçoive.

Le modèle « sessions en base + hash du refresh token » s'inspire de `brocoders/nestjs-boilerplate` (MIT).
