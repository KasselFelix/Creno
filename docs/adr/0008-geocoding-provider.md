# ADR 0008 — Géocodage par l'API Adresse de l'État, derrière une interface

- Statut : accepté
- Date : 2026-10-02

## Contexte

Deux écrans ont besoin de transformer un texte en coordonnées (géocodage) : le champ « Ville ou adresse » de la recherche, et le formulaire du prestataire, qui ne doit plus saisir de latitude ni de longitude. Dans le second cas, les coordonnées obtenues sont **enregistrées** en base.

## Décision

- Géocodeur : **l'API Adresse de l'État** (Base Adresse Nationale, servie par la Géoplateforme de l'IGN, `https://data.geopf.fr/geocodage/search`). Gratuite, sans clé, licence ouverte : les résultats peuvent être stockés.
- Il est **derrière une interface** (`Geocoder`, jeton `GEOCODER`, adapter `BanGeocoder`) et exposé par notre API : `GET /v1/geocoding/search?q=`. Le navigateur n'appelle jamais le service tiers.
- Appel avec un **timeout de 3 s et sans retry** : c'est de l'autocomplétion, la frappe suivante relance. La réponse est validée par Zod.
- Échec (délai, 5xx, réponse inattendue) → `503 GEOCODING_UNAVAILABLE` et un log `warn` `geocoding.failed` (raison, durée, longueur du texte ; jamais le texte lui-même). Ce n'est pas un `error` : le reste de l'écran fonctionne.
- Le formulaire du prestataire garde un repli : « Saisir les coordonnées à la main ». L'API continue de recevoir `latitude` / `longitude` ; elle ne géocode pas à l'écriture.

## Conséquences

- **France uniquement** : une adresse étrangère ne donne aucune suggestion. Changer de géocodeur revient à écrire un autre adapter.
- La route est publique et appelle un tiers : elle passe par la limite de débit `public`, et le front attend 300 ms après la dernière frappe et 3 caractères au moins.
- Aucune clé à gérer, donc rien à configurer sur un clone frais (`GEOCODER_URL` a une valeur par défaut).
- En test, l'adapter est remplacé par un faux (`overrideProvider(GEOCODER)`) ; son analyse de la réponse est testée à part avec un `fetch` simulé.

## Alternatives écartées

- **Mapbox Geocoding** : couvre le monde et le compte existe déjà pour la carte, mais ses conditions interdisent de conserver le résultat d'un géocodage standard ; il faudrait l'offre « permanente », payante, pour le formulaire du prestataire.
- **Appel direct depuis le navigateur** : plus simple, mais pas de limite de débit, pas de log, pas de faux en test, et l'adresse saisie part chez un tiers sans passer par nous.
- **Nominatim (OpenStreetMap)** : usage public limité à une requête par seconde et autocomplétion interdite.
