# ADR 0009 — Paiement par Stripe Connect : destination charge, hold aligné sur Checkout, webhook comme seule source de vérité

- Statut : accepté
- Date : 2026-10-02

## Contexte

Un client paie un créneau à la réservation ; l'argent revient au prestataire, moins une commission pour Creno. Trois questions se posent : qui encaisse, combien de temps le créneau reste bloqué pendant le paiement, et qui décide qu'une réservation est payée.

## Décision

- **Comptes « destinataires » à tableau de bord Express + destination charge.** Chaque prestataire ouvre un compte Stripe Connect par un formulaire hébergé par Stripe (identité, IBAN) : Creno ne voit jamais ces données. Le compte est créé avec l'API **Accounts v2** (Stripe refuse l'ancienne API aux nouvelles plateformes) : configuration `recipient` avec la capacité `stripe_transfers`, tableau de bord `express`, frais et soldes négatifs à la charge de la plateforme. C'est l'équivalent d'un compte Express. Un prestataire est « actif » quand cette capacité de transfert l'est (`charges_enabled` reste faux : il n'encaisse pas lui-même). Le paiement est créé sur le compte de la plateforme, avec `transfer_data.destination` (le compte du prestataire) et `application_fee_amount` (la commission, `STRIPE_PLATFORM_FEE_BPS`). Les événements de paiement arrivent donc sur le webhook de la plateforme.
- **Stripe Checkout** (page de paiement hébergée) : aucune donnée de carte ne passe par nous, et aucune clé n'est exposée au navigateur.
- **Hold aligné sur la session.** Stripe impose une session d'au moins 30 min ; notre hold dure 15 min. Au lancement du paiement, le hold est prolongé **une seule fois** à 31 min (`bookings.checkout_started_at`) et la session expire au même instant. Le client a 15 min pour lancer le paiement, puis 31 min pour payer.
- **Le webhook est la seule source de vérité.** `POST /v1/payments/webhook` vérifie la signature sur le corps brut, puis, dans une transaction : insère l'événement dans `stripe_events` (`ON CONFLICT DO NOTHING` : un événement rejoué s'arrête là) et le traite. Si le traitement échoue, l'insertion est annulée avec lui, la réponse est une 500 et Stripe renvoie l'événement. La page de retour du navigateur ne confirme rien : elle interroge l'API.
- **Paiement arrivé trop tard.** Une réservation `expired` est remise à `confirmed` dans un savepoint : si la contrainte `bookings_no_overlap` refuse (`23P01`, le créneau a été repris), le paiement est remboursé. C'est encore la base qui tranche.
- **Annulation : rembourser d'abord, libérer ensuite.** Si Stripe échoue, rien ne change. Le paiement ne passe à `refunded` qu'à la réception de `charge.refunded`.
- **Clés d'idempotence** dérivées de nos identifiants (`account-<prestataire>-<minute>`, `checkout-<réservation>-<échéance>`, `refund-<réservation>-<fenêtre de 10 min>`) : deux appels simultanés ne créent ni second compte, ni seconde session, ni second remboursement. Elles sont bornées dans le temps parce que Stripe garde 24 h la réponse d'une clé, erreur comprise : avec une clé fixe, une erreur corrigée depuis serait rejouée pendant un jour (constaté à l'onboarding). Un double remboursement reste impossible côté Stripe, qui refuse de rembourser plus que le montant payé.
- **Stripe derrière une interface** (`PaymentsGateway`, jeton `PAYMENTS_GATEWAY`) : remplacée par un faux en test. La vérification de signature reste hors de l'interface (calcul local) : les tests signent de vrais événements.
- **Sans clé Stripe**, l'API démarre et les routes de paiement répondent `503 PAYMENT_PROVIDER_UNAVAILABLE` : `docker compose up` marche sur un clone frais.

## Conséquences

- Un créneau peut rester bloqué jusqu'à 46 min par un client qui ne paie pas (15 + 31). Freins : 5 holds actifs par client, 2 par ressource.
- Un prestataire dont le compte n'est pas actif (`stripe_charges_enabled = false`) n'est pas réservable pour ses ressources payantes ; les gratuites sont confirmées sans Stripe, dans la limite de 5 réservations gratuites à venir par client (elles n'ont pas le frein du paiement).
- Stripe refuse moins de 0,50 € par carte : un prix vaut 0 ou au moins 50 centimes.
- Le remboursement tardif est appelé **hors transaction** : la transaction qui découvre le créneau perdu est annulée, Stripe est appelé, puis une seconde transaction enregistre l'événement et le paiement. Si Stripe échoue, rien n'est enregistré et l'événement est renvoyé. Un `charge.refunded` reçu avant l'enregistrement du paiement est refusé (503) pour être renvoyé plus tard.
- En production, `account.updated` arrive sur un second endpoint (« Connect »), avec son propre secret : `STRIPE_CONNECT_WEBHOOK_SECRET`. Un événement venu d'un compte connecté n'est accepté que pour `account.updated` : un événement de paiement de cette origine est ignoré, quelles que soient ses métadonnées.
- Stripe ne rend pas ses frais de traitement lors d'un remboursement : une annulation remboursée coûte ces frais à la plateforme. Accepté à ce stade ; un plafond d'annulations par client est une piste.
- Pas de job : un hold expiré est libéré par la réservation suivante ou par `checkout.session.expired`. Le job de ménage arrive avec pg-boss (étape 6).

## Alternatives écartées

- **Direct charges** (paiement créé sur le compte du prestataire) : les événements arrivent sur un endpoint par compte connecté, et les litiges sont à la charge du prestataire. Trop pour un compte Express.
- **Separate charges and transfers** : utile pour répartir un paiement entre plusieurs prestataires, ce que nous ne faisons pas.
- **Garder un hold de 15 min strict** : un client qui paie entre la 15ᵉ et la 30ᵉ minute serait remboursé si le créneau a été repris.
- **Confirmer au retour du navigateur** (`success_url`) : le client peut fermer l'onglet, ou forger l'adresse.
- **Enregistrer l'événement puis le traiter hors transaction** : un traitement en échec laisserait un événement marqué « vu » que Stripe ne renverrait plus utilement.
