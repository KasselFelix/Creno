# ADR 0014 — Filtre « disponible le » : le moteur de créneaux sur les candidats de la recherche

- Statut : accepté
- Date : 2026-10-04

## Contexte

La recherche (ADR 0007) trouve les prestataires d'un rayon en SQL, avec PostGIS. Il manquait le filtre « disponible tel jour », reporté de l'étape 4 et demandé par la recherche en langage naturel (« samedi »). Un prestataire est disponible s'il a au moins un créneau libre ce jour-là, et ces créneaux sont déjà calculés par un moteur pur en TypeScript (ADR 0006), dont les changements d'heure sont testés.

Pour répondre, il faut combiner les deux : la liste vient du SQL, la disponibilité du moteur.

## Décision

Le filtre **réutilise le moteur** au lieu de réécrire le calcul en SQL (`AvailabilityService.freeSlotsOn`) :

1. Avec une date, la requête de recherche renvoie jusqu'à **200 candidats** (`SEARCH_DATE_CANDIDATES_MAX`) au lieu de 50. L'ordre ne change pas : distance, ou nom sans centre.
2. **Chargement par lot**, quel que soit le nombre de candidats :
   - une requête pour leurs ressources actives, au prix maximum ou moins si le prix est filtré ;
   - puis trois requêtes en parallèle : les règles du jour de la semaine, les fermetures et les réservations actives qui chevauchent la journée.

   Les identifiants passent en un seul paramètre tableau (`resource_id = ANY($1)`). La journée n'a pas les mêmes bornes dans tous les fuseaux : la fenêtre lue les couvre toutes, et le moteur ne garde que ce qui chevauche les créneaux de chaque ressource.

3. Le moteur calcule les créneaux du jour de chaque ressource, dans son fuseau, avec la même fonction que la fiche (`computeSlots`). Le prestataire est gardé s'il a au moins un créneau libre. Le résultat garde l'ordre de la recherche et est coupé à 50.

Chaque résultat porte :

- `availableSlots` : la somme des créneaux libres des ressources éligibles ;
- `availableResourceId` : la moins chère des ressources éligibles qui a un créneau libre (à prix égal, l'identifiant), qui sert au lien vers la fiche, ouverte sur ce jour et cette ressource.

La réponse porte aussi `totalIsCapped`, vrai quand plus de 200 prestataires correspondaient aux autres filtres.

La plage de dates (d'aujourd'hui à 90 jours) se contrôle **à l'heure de Paris** (`SEARCH_TIMEZONE`) : hors plage, `400 SEARCH_DATE_OUT_OF_RANGE`. La recherche reçoit `now` en paramètre, comme `getSlots`, pour que les tests fixent l'instant.

## Conséquences

- **Une seule source de vérité.** Une fiche et la recherche ne peuvent pas se contredire. Un test d'intégration avec `now` fixé compare `searchProviders` et `getSlots` un jour de passage à l'heure d'hiver (25 créneaux) et un jour de passage à l'heure d'été (23 créneaux).
- **Même règle pour les holds.** Le prédicat « réservation qui occupe un créneau » (`confirmed`, ou `pending` dont le hold n'a pas expiré) est une seule expression, partagée par la fiche et la recherche.
- **Coût borné.** Cinq requêtes par recherche datée. Au pire, 200 prestataires × 50 ressources (`MAX_RESOURCES_PER_PROVIDER`) passent par le moteur en mémoire, qui fusionne les intervalles et cherche par dichotomie (ADR 0006). Les index GiST `(resource_id, during)` de `bookings` et des fermetures servent les lectures.
- **Un total minimum.** Au-delà de 200 candidats, seuls les plus proches sont examinés : un prestataire libre mais plus loin n'apparaît pas, et `total` n'est qu'un minimum. L'écran dit alors « Au moins N prestataires disponibles » et invite à réduire le rayon.
- Sans date, rien ne change : `availableSlots` et `availableResourceId` valent `null`, et le total est exact.

## Alternatives écartées

- **Tout en SQL** (`generate_series` et `AT TIME ZONE` dans la requête de recherche) : une seule requête, mais le moteur existerait en deux exemplaires. La politique des heures inexistantes ou répétées y serait implicite, et ne se testerait qu'avec une base.
- **Créneaux matérialisés** en table : lecture triviale, mais il faut les régénérer à chaque changement d'horaire, de fermeture ou de réservation, et ils dérivent des règles.
- **Filtrer les 50 premiers seulement** : moins de travail, mais une liste vide dès que les 50 plus proches sont complets, alors que des prestataires libres existent juste après.
- **Trois requêtes par ressource** (le chargeur de la fiche, appelé en boucle) : jusqu'à 30 000 requêtes pour une seule recherche.
