# ADR 0020 — Remboursement par paliers à l'annulation par le client

- Statut : accepté
- Date : 2026-10-21

## Contexte

Jusqu'ici, le client annulait une réservation payée avec un remboursement total jusqu'à 24 h avant le début (ADR 0009), au moins 24 h après un déplacement par le prestataire (ADR 0015). Sous 24 h, il ne pouvait plus annuler du tout. Il devait contacter le prestataire, et le créneau restait bloqué même quand il savait qu'il ne viendrait pas.

Un remboursement intégral coûte à la plateforme : Stripe ne rend pas ses frais sur un remboursement, et Creno perd sa commission (ADR 0009). Une annulation tardive coûte aussi au prestataire, qui ne revend pas toujours le créneau. Il fallait une règle qui laisse annuler jusqu'au début, partage ce coût, et soit connue du client avant qu'il paie.

## Décision

**Trois paliers, les mêmes pour tous les prestataires** (`packages/shared`, `customerRefundSteps`) :

| Annulation par le client            | Remboursement |
| ----------------------------------- | ------------- |
| plus de 48 h avant le début         | 100 %         |
| entre 48 h et 24 h avant            | 50 %          |
| moins de 24 h avant, jusqu'au début | 0 %           |

- Le montant est arrondi au centime inférieur et calculé sur le montant encaissé.
- Le délai de décision de l'ADR 0015 est conservé : après un déplacement, le client garde au moins 24 h de remboursement intégral, sans dépasser le début (`min(début, max(début − 48 h, déplacement + 24 h))`). Le palier à 50 % est absorbé s'il tombe dans ce délai.
- Le prestataire qui annule rembourse toujours tout.
- Un paiement arrivé trop tard est rendu en entier (ADR 0009).

Annuler jusqu'au début est maintenant permis au client. L'ADR 0015 l'avait écarté parce qu'il remboursait tout jusqu'au début. Ici, une annulation de dernière minute ne rend rien : elle libère le créneau sans rien coûter au prestataire.

**La même règle sert au serveur, au front et aux emails.** Ce sont des fonctions pures du paquet partagé : `customerRefundSteps`, `refundStepAt`, `refundCentsFor`. Une seule phrase, `refundPolicyText`, décrit les paliers à venir, et seul le format des dates change selon l'endroit :

- la fiche, sous « Réserver et payer » ;
- la page Stripe, au-dessus du bouton de paiement (`custom_text.submit.message`) ;
- l'email de confirmation ;
- « Mes réservations » (palier en cours).

Un créneau réservé tard affiche directement le palier où il commence.

**Le montant est recalculé par le serveur, et vérifié avec ce que le client a vu.** La fenêtre d'annulation envoie `expectedRefundCents`. Si le palier a changé depuis son ouverture, l'API répond `409 REFUND_AMOUNT_CHANGED` avec le nouveau montant, et rien n'est fait. Ce champ ne sert qu'à cette comparaison, jamais de montant. Le client ne confirme donc jamais un « remboursement intégral » qui deviendrait 50 %.

**Montant dû stocké, montant remboursé venu du webhook.** `bookings.refund_due_cents` garde ce que l'annulation doit au client, tel que Stripe l'a accepté ; `NULL` signifie qu'il n'y a pas eu de paiement. `payments.refunded_cents` reste écrit par le seul webhook `charge.refunded`. Tant qu'il est inférieur au montant dû, le remboursement est « en cours ». Un remboursement partiel garde le paiement `succeeded`, sans nouvelle valeur d'enum.

**Jamais deux remboursements pour un paiement.** La clé d'idempotence de Stripe ne couvre que 10 min ; jusqu'ici, un rejeu au-delà était sans danger, car Stripe refuse de rembourser deux fois un paiement déjà remboursé en entier (`charge_already_refunded`). Avec 50 %, ce rejeu en créerait un second. Deux protections :

- **Un verrou sur la réservation pendant toute l'annulation** (`SELECT … FOR UPDATE`, puis palier, appel à Stripe, `UPDATE`, outbox, dans une transaction). Deux annulations simultanées (double clic, client et prestataire, ou deux requêtes calées de part et d'autre d'une fenêtre d'idempotence) passent l'une après l'autre : la seconde voit la réservation annulée et reçoit 409. C'est une exception à « aucun verrou pendant un appel réseau » (ADR 0009), limitée à une ligne et bornée par le timeout de 10 s du client Stripe. Une requête qui attend ce verrou n'attend que 3 s (`SET LOCAL lock_timeout`), puis reçoit 409 « annulation déjà en cours » : elle n'immobilise pas une connexion du pool pendant un Stripe lent.
- **La passerelle part de l'état chez Stripe** (`refunds.list`) et ne crée que le complément jusqu'au montant visé : rien si un remboursement couvre déjà ce montant, `montant − déjà remboursé` sinon (par exemple, une annulation par le prestataire après un essai à 50 % accepté par Stripe mais pas enregistré ici). Elle renvoie le total remboursé chez Stripe, et c'est lui qui est enregistré (log `payment.refund_already_exists` s'il diffère du palier). Elle est appelée même à 0 %.

**Commission et virement repris au prorata.** Le remboursement partiel garde `reverse_transfer` et `refund_application_fee`. Sur 45 € annulés à 50 %, le client récupère 22,50 €. Le prestataire garde 22,50 € moins la commission sur cette part, et Creno garde la moitié de sa commission, moins les frais Stripe qui ne sont pas rendus.

## Alternatives écartées

- **Politique propre à chaque prestataire** (souple, modérée, stricte) : il faudrait la stocker, la choisir dans le dashboard et la figer sur chaque réservation au paiement. C'est utile un jour, mais pas pour une règle unique de démonstration.
- **Deux paliers (100 % puis 0 % à 24 h)** : plus simple, mais l'écart entre « tout » et « rien » est brutal, et le remboursement partiel Stripe n'est pas démontré.
- **Montant figé au premier essai** : il faudrait écrire la décision avant l'appel à Stripe, sur une réservation encore confirmée, puis l'annuler si le client abandonne. La vérification `expectedRefundCents` et la lecture des remboursements existants suffisent.
- **Laisser le serveur trancher sans vérification** : plus simple, mais le client peut confirmer un montant et en recevoir un autre.

## Conséquences

- Le client peut libérer un créneau jusqu'au début, et le prestataire est payé en partie ou en totalité quand l'annulation est tardive.
- Le chiffre d'affaires du dashboard reste la valeur des réservations confirmées : la part conservée sur une annulation tardive n'y entre pas (reporté).
- Un remboursement qui échoue après coup chez Stripe (`charge.refund.updated` en `failed`) n'est pas suivi : `refunded_cents` ne redescend pas (lacune existante, reportée).
- La réservation payée du seed n'a pas de paiement réel chez Stripe : son annulation échoue (503), comme avant au-delà de 24 h.
