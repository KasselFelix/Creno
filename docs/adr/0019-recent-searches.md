# ADR 0019 — Recherches récentes : dans le navigateur, phrase seule, jamais dans un attribut

- Statut : accepté
- Date : 2026-10-21

## Contexte

Sous la barre de recherche en langage naturel (accueil et `/search`), trois exemples fixes montraient la recherche par phrase. Un visiteur qui revient doit pouvoir relancer en un clic ses dernières recherches. Il faut décider où les garder, lesquelles garder, et quoi garder.

La phrase est une donnée personnelle (ADR 0013) : elle peut contenir une adresse. L'API ne la journalise ni ne l'enregistre.

## Décision

**Dans le navigateur (`localStorage`), pas en base.** La clé `creno.recent-searches.v1` garde au plus 3 phrases, la plus récente d'abord.

- La plupart des visiteurs cherchent sans être connectés : un historique en base ne servirait qu'aux comptes.
- La phrase ne quitte pas l'appareil : elle ne repart que si le visiteur la relance.
- Il n'y a ni API, ni migration, ni durée de conservation à tenir côté serveur.
- La lecture est validée par Zod. Un contenu illisible, modifié à la main ou un stockage bloqué (navigation privée, quota) donne une liste vide : on retombe sur les exemples.

**Seulement une phrase qui tient toute seule.** Elle est gardée si la réponse cite une catégorie, un lieu, « près de moi », un prix maximum ou un jour.

- Un rayon seul ne compte pas : il dépend du lieu déjà choisi sur la page, et rejoué ailleurs il ne donne rien.
- Une phrase sans filtre compris (« aucun filtre ») n'est jamais reproposée.
- La règle ne lit que la réponse de l'API. La barre de recherche l'applique elle-même, et c'est le seul point d'enregistrement.

**La phrase, pas les filtres.** Un clic renvoie la phrase au modèle, comme un exemple. Ainsi « samedi » reste le samedi à venir, et les coordonnées de « près de moi » ne sont jamais stockées. Les limites de l'IA s'appliquent comme pour toute phrase (ADR 0013).

**Jamais la phrase dans un attribut.** Pour décrire un clic dans son fil d'Ariane, Sentry recopie l'`aria-label`, le `title`, le `name` et l'`alt` de l'élément et de ses parents. Une phrase placée dans `aria-label` partirait donc à Sentry avec la prochaine erreur. Elle reste dans le texte des boutons, que Sentry ne recopie pas, avec un préfixe masqué pour les lecteurs d'écran (« Recherche récente : … », « Retirer « … » de l'historique »).

**Une croix par recherche récente** la retire de l'historique. Le focus passe à la croix voisine, sinon au champ, pour qu'on puisse en retirer plusieurs au clavier.

## Conséquences

- Pas de synchronisation entre appareils. Si les comptes en ont besoin un jour, la même liste pourra être envoyée à l'API pour un utilisateur connecté.
- Le serveur ne connaît pas l'historique. Pendant le rendu serveur et l'hydratation, la rangée de propositions reste donc invisible (sa place est gardée), puis elle apparaît. On évite des exemples remplacés sous le doigt par l'historique.
- La politique de confidentialité mentionne le stockage local du thème et des recherches récentes.

## Alternatives écartées

- **Historique en base pour tous** (via un identifiant anonyme) : il faudrait garder une donnée personnelle côté serveur pour un simple confort, avec durée de conservation, droit d'accès et purge.
- **Garder les filtres interprétés** : on éviterait un appel au modèle, mais « samedi » resterait figé sur une date passée et l'on stockerait des coordonnées.
- **Un seul bouton « Effacer l'historique »** : plus étroit, mais moins clair qu'une croix sur chaque phrase.
