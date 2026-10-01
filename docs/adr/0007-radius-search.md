# ADR 0007 — Recherche par cercle (centre + rayon), plafonnée à 50 résultats

- Statut : accepté
- Date : 2026-10-02

## Contexte

Un visiteur cherche des prestataires près d'un lieu : une ville, une adresse, sa position, ou le point qu'il regarde sur la carte. La position est portée par le prestataire (`providers.location`, ADR 0003) ; une ressource hérite de celle de son prestataire.

Il faut choisir la forme de la zone de recherche (cercle ou rectangle de la carte), l'unité de résultat, et la façon de borner la réponse d'une route publique.

## Décision

- **Résultat = le prestataire**, s'il a au moins une ressource active, avec son prix « à partir de » et le nombre de ses ressources actives.
- **Zone = un cercle** : `GET /v1/search/providers?lat=&lng=&radiusKm=` (1 à 50 km, 10 par défaut). `ST_DWithin` filtre en mètres avec l'index GiST `providers_location_gix`, `ST_Distance` donne la distance affichée et l'ordre de tri (puis `id`, pour un ordre stable).
- **Sans centre**, la route liste tous les prestataires par nom, sans distance : c'est l'écran d'arrivée de `/search`.
- **Une seule requête** : sous-requête `LATERAL` pour le prix minimum, `count(*) OVER ()` pour le total avant `LIMIT`.
- **Plafond de 50 résultats**, sans pagination : la réponse porte `total`, et l'écran invite à réduire le rayon ou à filtrer.
- **La carte ne relance pas la recherche toute seule** : après un déplacement fait par le visiteur, un bouton « Rechercher dans cette zone » prend le centre de la carte comme nouveau centre et garde le rayon choisi.
- **Position du visiteur** : arrondie à 3 décimales (≈ 100 m) par le schéma Zod partagé, jamais enregistrée, absente des logs (la query string de ces routes est retirée des logs d'accès).

## Conséquences

- Les filtres vivent dans l'URL de `/search` : la recherche est partageable, le bouton retour fonctionne, et la recherche en langage naturel (étape 7) n'aura qu'à produire ces mêmes filtres.
- Avec un centre, la requête reste rapide quand la table grossit : sur 50 000 prestataires répartis sur la France, un rayon de 10 km lit 27 lignes par l'index et répond en moins de 10 ms (`EXPLAIN ANALYZE`, voir [docs/schema.md](../schema.md)).
- **Limite connue** : sans centre, la requête parcourt tous les prestataires pour les trier et les compter (environ 0,8 s sur 50 000). Sans importance à l'échelle du MVP ; au-delà, il faudra exiger un lieu ou stocker le prix minimum sur le prestataire.
- Pas de clustering des marqueurs : 50 au plus sur la carte.
- Le cercle n'épouse pas la forme de l'écran : un prestataire visible dans un coin de la carte peut être hors du rayon. Le compteur (« 12 prestataires dans un rayon de 10 km autour de Lyon ») dit ce qui est cherché.

## Alternatives écartées

- **Rectangle de la carte (bbox)**, comme Airbnb : colle à ce que l'écran montre, mais demande un second mode de recherche (et un index sur `location::geometry` pour être exact), et « à moins de 5 km » reste le besoin le plus naturel pour un coiffeur ou un terrain.
- **Relance automatique à chaque déplacement de la carte** : la carte se recadre sur les résultats, ce qui déclenche lui-même un déplacement ; il faut alors distinguer les deux partout, et chaque glissement coûte une requête.
- **Pagination** : sur une carte, une « page 2 » n'a pas de sens ; réduire la zone est plus lisible.
- **Filtre « disponible tel jour »** : demande de calculer les créneaux de plusieurs ressources par lot. Reporté à l'étape de la recherche en langage naturel.
