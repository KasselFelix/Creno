# ADR 0018 — Réveil à froid : garder la mise en veille, réveiller tôt, expliquer l'attente

- Statut : accepté
- Date : 2026-10-20

## Contexte

En démo, l'API descend à zéro réplica sans trafic (ADR 0016) : c'est ce qui la garde dans l'offre gratuite d'Azure. La première recherche d'un visiteur attendait alors près de 30 s, sans autre retour qu'un bouton qui tourne, de quoi faire partir un visiteur.

Mesuré le 2026-10-20 dans les journaux système de `ca-creno-api` (0,25 vCPU / 0,5 GiB) : **28 s** de réveil, contre 0,07 s une fois réveillée.

| Phase                                                                  | Durée |
| ---------------------------------------------------------------------- | ----- |
| Activation KEDA et placement du réplica                                | ~4 s  |
| Téléchargement de l'image (102 Mo compressés, dont 62 Mo de base Node) | 6 s   |
| Création du conteneur                                                  | 8 s   |
| Démarrage de Node + Nest                                               | 8 s   |
| Sonde de démarrage et routage                                          | ~2 s  |

18 s dépendent de la plateforme. L'API se rendort environ 6 min après sa dernière requête (`cooldownPeriod` de 300 s, plus le délai de KEDA). Aucune requête n'échoue pendant le réveil : le relais Vercel attend 120 s, les rendus serveur 45 s (`API_TIMEOUT_MS`).

## Décision

**Garder la mise en veille.** Un réplica allumé en permanence (`minReplicas: 1`) coûterait 4,2 $/mois au tarif « idle » et jusqu'à 14 $/mois au tarif actif (pg-boss interroge la base en continu), au-delà du budget du projet.

**Réveiller l'API pendant que le visiteur lit, et la garder éveillée tant qu'il est actif** (`apps/web/lib/api/wake.ts`, `features/health/api-wake-up.tsx`) :

- chaque page appelle `GET /api/health` au chargement ;
- puis à chaque activité (pointeur, clavier, défilement, retour sur l'onglet) si l'API n'a pas répondu depuis 4 min ;
- au plus un ping toutes les 30 s, et aucun quand l'onglet est caché.

Le temps passé à lire et à taper couvre une partie du réveil, et l'API ne se rendort pas sous les yeux d'un visiteur qui lit une fiche.

**Montrer un chargement, pas une explication.** Le client API note la dernière réponse de l'API (les 502/503/504 du relais ne comptent pas) et suit ses requêtes. Pendant un réveil (aucune réponse depuis 4 min), aucun texte : le visiteur voit un chargement d'app ordinaire.

- **Écran de chargement Creno** (`components/creno-loader.tsx`) pour les changements de page : recherche de l'accueil jusqu'à `/search`, `/search` ou fiche ouverts par un lien. Il s'ouvre après 1,5 s d'attente. Le calendrier du logo tourne ses pages jour après jour à partir d'aujourd'hui (rotation 3D autour des anneaux, 1,2 s par jour). Quand l'API répond : dernière page vierge, la coche s'y dessine, « Creno » se met en place, puis l'écran s'efface sur la page déjà chargée (≈ 4,4 s, rythme choisi sur un prototype réglable). Monté dans le layout racine, il survit au changement de route.
- **Barre fine en haut de l'écran** pour les autres attentes (connexion, réservation, filtres, autocomplétion) : elle ne couvre jamais une page pendant qu'on tape. Elle part du début du réveil, pas du clic.

Une API éveillée répond en moins d'1 s : une recherche lente parce que Mistral l'est n'affiche que « Recherche en cours… ». Une fiche ouverte par un lien direct (rendu serveur) déclenche l'écran depuis son `loading.tsx`.

**Démarrer plus vite, gratuitement.** `import … from 'date-fns'` chargeait les ~300 fichiers du paquet. Les imports ciblés (`date-fns/addMinutes`) font passer le chargement des modules de l'API de 3,1 à 2,3 s en local (−25 %). Une règle ESLint empêche d'y revenir côté API ; le front n'est pas concerné, son bundler ne garde que les fonctions utilisées.

## Conséquences

- **Coût** : inchangé par minute de visite. Au rythme mesuré (18 réveils et au plus 7,3 h d'activité en 4,9 jours, tests compris), l'API consomme environ 23 % de l'offre gratuite (180 000 vCPU-s par mois).
- **Pas de règle de débit Vercel sur `/api/health`.** Garder l'API éveillée exige une requête toutes les 5 min, très en dessous de toute limite. Les rafales sont couvertes par la protection DDoS de Vercel, et les routes coûteuses par les limites par IP de l'API. Le déclencheur, c'est l'alerte de budget (voir `docs/deploy.md`).
- **Limite connue** : un visiteur connecté sur une API endormie attend sans écran de chargement. `proxy.ts` renouvelle sa session avant d'envoyer la page, et un rendu de proxy ne peut pas afficher d'état d'attente. Couper l'appel plus tôt ferait perdre la session, puisque le refresh token tourne à chaque appel. Le ping au retour sur l'onglet raccourcit l'attente.
- **Robots** : ceux qui exécutent le JS réveillent l'API une fois par page, comme ils le faisaient déjà en ouvrant `/search`.

## Alternatives écartées

- **`minReplicas: 1`, allumage par plage horaire** : 4 à 14 $/mois.
- **0,5 vCPU / 1 GiB** : environ 2,5 s de mieux par réveil, mais l'offre gratuite se consomme deux fois plus vite. Si quelqu'un gardait l'API éveillée 24 h/24, ça coûterait 34 $/mois au lieu de 14 $. Levier gardé pour plus tard.
- **Alléger l'image** : `@nestjs/swagger` tire `typescript`, `es-toolkit` et `swagger-ui-dist` (51 Mo décompressés), mais seulement ~5 Mo compressés sur 102, soit moins d'1 s de gagnée.
- **Cache de compilation de Node (`NODE_COMPILE_CACHE`)** : −11 % au démarrage pour 19 Mo de plus dans l'image.
- **Charger le SDK Mistral au premier usage** (0,6 s) : le coût serait déplacé sur la première recherche, qui est justement l'action de l'accueil.
- **Écran de chargement au lancement du site** : les pages Vercel sont prêtes tout de suite, bloquer le visiteur n'ajouterait que de l'attente. L'écran n'apparaît que lorsqu'une page attend vraiment l'API.
- **Un toast qui explique la veille** (première version) : trop de détails pour le visiteur, qui n'a pas à connaître l'hébergement, et envahissant en haut de page.
