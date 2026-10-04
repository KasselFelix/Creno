# ADR 0013 — Recherche en langage naturel : Mistral Small, sortie validée par Zod, repli par mots-clés

- Statut : accepté
- Date : 2026-10-04

## Contexte

Sur `/search`, un visiteur peut taper une phrase (« un terrain de foot à Bordeaux samedi pour moins de 40 € ») au lieu de remplir les filtres. Il faut en tirer des filtres : catégorie, lieu, rayon, prix maximum, jour. C'est une extraction courte, appelée à chaque recherche, sur une route publique.

Contraintes :

- projet portfolio, sans budget : le coût par recherche compte, une offre gratuite encore plus ;
- les visiteurs sont en France : la phrase est une donnée personnelle, elle doit rester dans l'UE ;
- `docker compose up` doit marcher sur un clone frais, sans clé ;
- un modèle peut être lent, en panne, saturé ou répondre n'importe quoi : la recherche doit marcher quand même.

## Décision

**Fournisseur et modèle.** Mistral AI, **Mistral Small 4** en version datée (`AI_MODEL=mistral-small-2603`), et non l'alias `mistral-small-latest` : le prix et le comportement ne changent pas sans nous. SDK officiel `@mistralai/mistralai`. L'offre gratuite « Experiment » (sans carte bancaire, environ 1 requête par seconde) suffit pour le développement et la démo ; une carte bancaire la fait passer en offre payante, sans toucher au code.

**Le modèle ne produit que des filtres, jamais de SQL.**

- Sortie structurée : le JSON Schema envoyé au modèle est généré (`z.toJSONSchema`) depuis le schéma Zod partagé `aiSearchExtractionSchema`. La réponse est revalidée par ce même schéma : une catégorie inconnue ou un prix négatif donnent `invalid_output`, puis le repli.
- `temperature: 0`, et `reasoning_effort: 'none'` pour les seuls modèles qui raisonnent (Mistral Small 4) : un modèle qui ne raisonne pas refuse ce paramètre (400), il ne lui est donc pas envoyé. Le prompt donne la date du jour (heure de Paris) et le calendrier des 14 prochains jours, pour que le modèle lise « samedi » au lieu de calculer la date. La phrase est placée entre balises, et `<` et `>` y sont neutralisés.
- Le lieu sort en texte (« Bordeaux ») ; c'est le géocodeur (ADR 0008) qui en fait une position. Le modèle ne produit jamais de coordonnées.

**Derrière une interface.** `FilterExtractor` (jeton `AI_FILTER_EXTRACTOR`), adapter `MistralFilterExtractor`, et `UnconfiguredFilterExtractor` quand `MISTRAL_API_KEY` est vide. Changer de fournisseur, c'est écrire un autre adapter. En test, l'adapter est remplacé par un faux ; son analyse des réponses est testée à part avec un `fetch` simulé.

**Résilience** (`apps/api/src/ai-search/ai-search.service.ts`), dans cet ordre :

1. clé absente (ou `AI_DAILY_REQUEST_CAP=0`) → mots-clés directement ;
2. **circuit breaker** ouvert → mots-clés. Il s'ouvre après 5 interprétations d'affilée en échec (timeout, réseau, 429, 5xx, clé refusée), pendant 30 s. Ensuite, une seule requête teste le fournisseur : réussie, le circuit se referme. Le circuit vit en mémoire : un par réplica ;
3. **plafond journalier** atteint → mots-clés. C'est la somme des tentatives enregistrées dans `ai_requests` depuis minuit UTC. Si la base est illisible, l'API n'appelle pas le modèle, pour ne pas dépenser sans pouvoir compter ;
4. sinon, l'appel :
   - **timeout** `AI_TIMEOUT_MS` (3 s) par tentative, dans un budget de 5 s ;
   - **une seule reprise**, si elle tient dans le budget : après 250 à 500 ms sur un timeout, une erreur réseau ou un 5xx, et après max(1 s, `retry-after`) sur un 429 ;
   - pas de reprise sur 400, 401, 403 ni sur une sortie invalide ;
   - les reprises du SDK restent désactivées, pour les compter et les journaliser nous-mêmes.

Tout échec du modèle, y compris une exception inattendue de l'adapter, donne `200` et `source: 'keywords'`, jamais une erreur 5xx. L'**analyse par mots-clés** (`keyword-parser.ts`, fonction pure) reconnaît les synonymes de catégorie, les prix, les rayons, les jours, « près de moi » et le lieu après une préposition. Elle écarte les faux lieux (« à domicile », « à 30 € »).

**Mesure.** Chaque interprétation laisse une ligne dans `ai_requests` et un log `ai.request` : issue, modèle, tentatives, latence, tokens et **coût en micro-dollars au tarif payant**, enregistré même sur l'offre gratuite pour montrer ce que coûterait la production. Les autres événements sont `ai.retry`, `ai.circuit_opened` et `ai.circuit_closed`, `ai.budget_exceeded` et `ai.persist_failed`.

## Coût comparé

Tarifs relevés le 2026-10-04. Une recherche type consomme environ 500 tokens en entrée (consigne, calendrier, phrase) et 80 en sortie (le JSON des filtres).

| Modèle                                     | Entrée ($ / M tokens) | Sortie ($ / M tokens) | Une recherche | 1 000 recherches |
| ------------------------------------------ | --------------------- | --------------------- | ------------- | ---------------- |
| **Mistral Small 4** (`mistral-small-2603`) | 0,15                  | 0,60                  | ~0,00012 $    | ~0,12 $          |
| Claude Haiku 4.5                           | 1,00                  | 5,00                  | ~0,0009 $     | ~0,90 $          |
| Claude Sonnet 5.5                          | 2,00                  | 10,00                 | ~0,0018 $     | ~1,80 $          |

Les tokens ne se comptent pas pareil d'un fournisseur à l'autre (chacun découpe le texte à sa façon) : l'ordre de grandeur compte plus que le chiffre exact. Le cache de prompt n'aiderait pas ici : le préfixe commun (la consigne) est sous la taille minimale mise en cache. Un modèle plus capable n'apporterait rien à une extraction de cinq champs validée par un schéma.

## Conséquences

- **Offre gratuite : un usage d'évaluation, avec entraînement par défaut.** Mistral utilise les requêtes de l'offre gratuite pour entraîner ses modèles, sauf désactivation (tableau de bord → Settings → Privacy). Le README et `.env.example` demandent de la désactiver. La démo publique tranchera à l'étape 9 entre l'offre gratuite et l'offre payante.
- **Vie privée.**
  - La phrase n'est ni journalisée ni enregistrée : seulement sa longueur. `ai_requests` ne garde ni le lieu ni les coordonnées, seulement les filtres non localisants et `hasPlace`.
  - D'une erreur du SDK, les logs ne gardent que la raison et le statut : le message peut recopier l'entrée.
  - La route est en `POST`, donc la phrase n'apparaît pas dans les logs d'accès.
  - Un test fait passer la phrase par chaque chemin (succès, timeout, sortie invalide, erreur qui la recopie, géocodeur en panne) et vérifie les logs et la table.
  - Les lignes sont purgées après 90 jours. La phrase part chez Mistral (UE) : la politique de confidentialité devra le dire (étape 9).
- **Limites assumées.**
  - Le circuit est remis à zéro au démarrage, et le plafond est souple : des requêtes simultanées peuvent le dépasser d'autant.
  - Une tentative en timeout n'a pas de coût connu, elle n'est pas comptée.
  - La limite par IP (`AI_RATE_LIMIT_PER_MINUTE`) suppose une IP réelle derrière le proxy (`TRUST_PROXY`, étape 9).
- **Sans clé**, tout fonctionne en mots-clés ; un `warn` `ai.not_configured` le signale au démarrage en production.

## Alternatives écartées

- **Claude Haiku 4.5** : rapide et fiable, mais payant dès la première requête (~0,0009 $ par recherche), et sans offre gratuite pour un portfolio.
- **Gemini (offre gratuite)** : ses conditions excluent de servir des utilisateurs dans l'UE avec l'offre gratuite.
- **Groq** : gratuit et très rapide, mais hébergé aux États-Unis.
- **OpenRouter, modèles `:free`** : 50 requêtes par jour, trop peu.
- **Modèle local (Ollama)** : pas de GPU sur Azure Container Apps ; sur CPU, la latence dépasse le budget.
- **Mots-clés seuls** : gratuit et prévisible, mais rate les tournures libres (« pas trop cher », « en fin de semaine ») ; c'est le repli, pas la solution.
- **Le modèle génère la requête SQL** : interdit. Une phrase hostile deviendrait du code exécuté sur la base ; des filtres validés par un schéma ne peuvent que restreindre une requête écrite à l'avance.
