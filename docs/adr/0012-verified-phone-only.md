# ADR 0012 — Téléphone : uniquement des numéros vérifiés, un par compte

- Statut : accepté
- Date : 2026-10-03

## Contexte

Le rappel de la veille part par SMS au numéro du compte. Jusqu'ici, ce numéro se saisissait librement dans « Mon compte » : n'importe qui pouvait faire envoyer nos rappels au téléphone d'un tiers, et plusieurs comptes pouvaient porter le même numéro (ce qui contournait le plafond de 5 SMS par jour, compté par compte). L'ADR 0010 en faisait un prérequis du déploiement.

## Décision

- **`users.phone` ne contient que des numéros prouvés.** `PATCH /users/me` n'accepte plus `phone` (schéma strict : 400). Le numéro n'est écrit que par la saisie d'un code (`POST /users/me/phone/verify`) et effacé par `DELETE /users/me/phone`. Le worker de notifications n'a rien à vérifier de plus : un numéro présent est un numéro vérifié.
- **L'invariant est en base** : index unique `users_phone_unique`, CHECK `(phone IS NULL) = (phone_verified_at IS NULL)` et format E.164.
- **Demande de code** : `POST /users/me/phone { phone }` → 202 `{ expiresAt }`. Indicatif hors `SMS_ALLOWED_PREFIXES` → `400 PHONE_NOT_ALLOWED`, avant toute écriture. La ligne `phone_verifications` et son job pg-boss sont écrits dans la même transaction (outbox, comme l'ADR 0010).
- **Code maison, 6 chiffres, 10 minutes, 5 tentatives.** Il naît dans le worker (`crypto.randomInt`) ; la base n'en garde que `sha256(<id de la demande>:<code>)`, le job ne transporte que l'identifiant. Seule la demande la plus récente d'un compte est acceptée.
- **Tentatives comptées avant la comparaison**, dans le même `UPDATE … WHERE attempts < 5 … RETURNING` que le contrôle : deux requêtes parallèles se sérialisent sur le verrou de ligne, jamais plus de 5 comparaisons par code. Un code accepté est consommé (`code_hash` à `NULL`) dans la transaction qui enregistre le numéro : le même code envoyé deux fois donne un 200 et un 400.
- **Une seule erreur** `400 PHONE_CODE_INVALID` pour toutes les causes (code faux, expiré, remplacé, tentatives épuisées) ; la cause précise ne va que dans les logs.
- **Numéro déjà vérifié sur un autre compte : transfert.** La demande de code répond pareil (on ne révèle pas qu'un numéro est inscrit) ; la saisie du bon code retire le numéro de l'ancien compte et le donne au nouveau, sous un verrou consultatif sur le numéro. Avoir le téléphone en main est la meilleure preuve disponible, et cela couvre les numéros réattribués par l'opérateur. Log `user.phone_transferred` (identifiants seulement).
- **Plafonds** : 3 demandes par compte et par heure, 5 par numéro sur 24 h (tous comptes confondus), sous verrous consultatifs (compte puis numéro : plafonds exacts en rafale) ; au-delà, `429` avec le même message dans les deux cas. Par IP, `PHONE_CODE_RATE_LIMIT_PER_HOUR` (10) sur la demande, et la limite `credentials` sur la saisie.
- **Les demandes ne sont jamais supprimées** à la vérification ni au retrait du numéro, seulement invalidées : sinon « demander, retirer, redemander » remettrait les plafonds à zéro. Le ménage les supprime 24 h après leur expiration.
- **Envoi** : un délai dépassé n'est pas repris (Twilio a peut-être envoyé le SMS, et sans clé d'idempotence la reprise le doublerait) ; un 429 ou un 5xx l'est, 3 fois, avec un nouveau code qui remplace le précédent ; puis file morte et log `error`.
- **SMS de développement dans Mailpit** : sans Twilio mais avec `MAILPIT_URL`, codes et rappels arrivent dans Mailpit sous forme d'email (`<numéro>@sms.mailpit.local`). Le parcours se déroule en local sans compte Twilio ; `MAILPIT_URL` est déjà refusée en production.

## Conséquences

- Les numéros enregistrés avant la migration `0010` sont effacés : ils n'avaient jamais été prouvés et pouvaient être en double (aucune production à cette date).
- Le plafond de 5 SMS de rappel par jour, compté par compte, vaut maintenant par numéro.
- Changer de numéro garde l'ancien actif jusqu'à la vérification du nouveau : pas de période sans rappel.
- L'ancien titulaire d'un numéro transféré n'est pas prévenu (il garde ses rappels par email) ; un email « votre numéro a été retiré » est à envisager.
- **Risque résiduel** : en cas de fuite de la base, un hash de code se casse hors ligne (10⁶ possibilités). Acceptable : le code expire en 10 minutes et ne sert qu'à prouver un numéro. Un HMAC avec une clé serveur l'éviterait, au prix d'un secret de plus.
- La demande d'un code pour le numéro d'un tiers lui envoie un SMS (« ne le communiquez à personne ») : c'est le prix de toute vérification par SMS, borné par le plafond de 5 par numéro et par jour et par les préfixes autorisés.
- L'état « code envoyé » n'est gardé que dans la page : la recharger revient à « pas de demande en cours » (on redemande un code).

## Alternatives écartées

- **Twilio Verify** (service géré) : gère codes, expiration et anti-fraude, mais facturé à la vérification, et une dépendance de plus à mocker ; la passerelle SMS existante suffit.
- **Colonne `phone_verified_at` sans unicité, numéro saisi puis « à vérifier »** : le worker de notifications devrait vérifier l'état à chaque envoi, et le même numéro pourrait rester sur plusieurs comptes.
- **Refuser (`409 PHONE_TAKEN`) un numéro déjà vérifié ailleurs** : un numéro réattribué par l'opérateur resterait bloqué tant que l'ancien titulaire ne l'a pas retiré.
- **Envoyer le SMS pendant la requête** : la réponse dépendrait de Twilio, et une panne perdrait le message (ADR 0010).
