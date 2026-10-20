# ADR 0017 — Filtre par plage horaire : heure de début murale, périodes = bornes

- Statut : accepté
- Date : 2026-10-16

## Contexte

En ligne, « un coiffeur sur paris pour lundi après midi » trouvait les coiffeurs de Paris disponibles lundi, mais « après midi » était ignoré. La recherche filtrait le jour (ADR 0014), pas l'heure. Il faut qu'une phrase (« lundi après-midi », « samedi après 18 h ») ou un choix manuel (« Soir ») ne garde que les prestataires qui ont un créneau libre dans la plage, sans réécrire le calcul des créneaux.

## Décision

**Une plage, ce sont deux bornes sur l'heure de début des créneaux, à l'heure murale de leur ressource** : `timeFrom` (inclus) et `timeTo` (exclu, `24:00` permis), au format `HH:mm`, chacune optionnelle. `GET /v1/search/providers` les accepte avec `date` (sans `date`, elles sont ignorées, comme le rayon sans centre). `freeSlotsOn` (ADR 0014) ne compte que les créneaux libres dont l'heure de début, `format(new TZDate(début, fuseau), 'HH:mm')`, est dans la plage : aucune requête de plus, le filtre s'applique aux créneaux déjà calculés.

**Les périodes ne sont que des préréglages de bornes** (`TIME_OF_DAY_RANGES`, `packages/shared`) : matin = avant 12 h, après-midi = 12 h – 18 h, soir = à partir de 18 h. L'URL et l'API ne connaissent que les bornes ; le front reconnaît une période pour l'afficher. Les bornes neutres (`00:00`, `24:00`) sont retirées, pour qu'une plage n'ait qu'une écriture dans l'URL.

**Le modèle ne calcule pas la plage.** Il renvoie une période (`timeOfDay`) et les heures citées (`startAfter`, `startBefore`), plus fiables pour un petit modèle ; le parseur de mots-clés produit la même forme. Une fonction pure, `resolveTimeRange`, les combine pour les deux sources : bornes de la période resserrées par les heures citées ; si elles ne se recoupent pas (« le matin après 14 h »), les heures citées l'emportent ; des heures inversées sont ignorées sans faire perdre le reste de l'interprétation.

**Une plage a toujours un jour** : celui de la phrase, même si le modèle l'a manqué (la date des mots-clés le rattrape), sinon aujourd'hui (heure de Paris), ou demain si la plage est déjà finie (« le matin » tapé à 15 h). Un jour cité hors de l'horizon de réservation fait tomber la plage avec lui.

## Conséquences

- **Une règle simple et la même pour tous les `slotMinutes`.** Un créneau de 17 h à 19 h ne compte pas pour « après 18 h » : il commence avant. C'est dit dans le README.
- **Changements d'heure.** L'heure murale se lit par ressource ; le jour de passage à l'heure d'hiver, les deux créneaux de 2 h comptent tous les deux dans « avant 6 h » (7 créneaux d'une heure de 0 h à 6 h), et le jour de passage à l'heure d'été, 2 h n'existe pas (5). Un test compare la recherche et `getSlots` ces deux jours.
- **Le parseur ne devine pas.** Seule une heure introduite par un mot (« après », « dès », « avant », « jusqu'à », « à », « vers », « entre … et … ») fait une plage. Une heure seule (« samedi 18h ») ou une durée (« pendant 2h ») reste signalée comme ignorée. Le lieu s'arrête où commence l'expression horaire (« à Lyon l'après-midi »).
- **La fiche ne filtre pas.** Le lien d'un résultat ouvre le bon jour et la bonne ressource, mais la grille montre toute la journée. Mise à jour du 2026-10-20 : le lien porte aussi la plage, et la fiche la met en évidence (« Votre plage », puis « Autres horaires ») sans rien masquer.

## Alternatives écartées

- **Une période en paramètre** (`time=afternoon`) : URL plus lisible, mais deux écritures pour « après 18 h » (période ou heure) et un enum à faire évoluer côté API. Les bornes couvrent tout.
- **Créneau entièrement dans la plage** (début et fin) : plus juste pour une longue séance, mais un créneau de 90 min qui commence à 17 h 30 disparaîtrait de « l'après-midi » ; la règle sur le début est plus prévisible.
- **Plage calculée par le modèle** : une sortie de moins, mais des bornes arithmétiques (« vers 10 h » → 9 h – 11 h) confiées à Ministral 8B, et une logique différente entre le modèle et les mots-clés.
- **Heure sans jour ignorée** : plus simple, mais « coiffeur après 18 h » veut presque toujours dire ce soir.
