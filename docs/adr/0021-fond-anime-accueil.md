# ADR 0021 — Animation de l'accueil : globe cobe ou grille CSS, tirés au sort, dans une bande sous la recherche

- Statut : accepté
- Date : 2026-10-22

## Contexte

Sous la recherche, l'accueil laissait un grand vide. On voulait un fond animé qui raconte le produit, sans ralentir la page, sans gêner la lecture et en restant accessible. Trois pistes ont été maquettées : une aurore (dégradé WebGL), un globe 3D et une grille de créneaux en perspective. La première raconte l'ambiance ; les deux autres racontent Creno, la recherche géographique d'un côté, la réservation de l'autre.

## Décision

**Globe et grille, tirés à 50/50 à chaque affichage de l'accueil.** Le tirage se fait dans le navigateur seulement : un composant chargé avec `next/dynamic(..., { ssr: false })` tire au sort dans l'initialiseur de son `useState`. Le serveur ne réserve que la place de la bande. Un tirage côté serveur donnerait un HTML différent de celui du navigateur (écart d'hydratation). `?fond=globe|grille` force un fond pour les captures.

**Le globe avec cobe** (MIT, aucune dépendance, 5,8 kB gzip), chargé seulement si le tirage tombe dessus.

- cobe v2 déplace le canvas dans un `div` à lui. Le canvas est donc créé dans l'effet, hors de React, et le conteneur est vidé au démontage.
- `destroy()` ne libère pas le contexte WebGL : on le perd volontairement (`WEBGL_lose_context`), sinon les allers-retours accueil ↔ recherche les accumulent.
- Le canvas couvre seulement la bande visible. Le globe y est agrandi et décalé (`scale`, `offset`), si bien que seule la calotte est calculée.
- Ses couleurs viennent des tokens `--globe-*`, lus en JS puis peints sur un canvas 2D d'un pixel pour obtenir du RVB. En production, le minifieur réécrit nos `oklch()` en hex ou en `lab()` : un analyseur d'`oklch()` n'aurait rien lu.
- Les couleurs sont relues quand la classe de `<html>` change, et non sur `resolvedTheme` : `next-themes` pose la classe dans son propre effet, qui passe après ceux de ses enfants.

**La grille en CSS**, sans dépendance. C'est un calendrier incliné en 3D, avec les tokens existants : deux semaines sur desktop, une seule sur mobile pour que les cases restent lisibles. Un fondu au loin et sur les côtés donne la profondeur ; les dates et les heures s'y devinent. Les créneaux libres s'allument dans le callback d'un intervalle, pas dans le corps d'un effet (règle `react-hooks/set-state-in-effect`).

**Accessibilité.** Une animation qui démarre seule, dure plus de 5 s et s'affiche à côté d'autre contenu doit pouvoir être arrêtée (WCAG 2.2.2). L'animation a donc un bouton pause, qui flotte en bas à droite de la bande. Le réglage système « réduire les animations » donne une image fixe. Le fond se met aussi en pause hors écran et onglet caché. Il est `aria-hidden` : c'est une décoration.

**Une bande de hauteur fixe sous la recherche.** Elle fait 384 px au moins sur desktop (et grandit jusqu'au pied de page sur un grand écran), 256 px sur mobile. Elle ne passe sous aucun élément. Sur un petit écran, on la découvre en faisant défiler.

## Conséquences

- Une dépendance de plus (`cobe`), petite et isolée dans le chunk du globe.
- L'animation apparaît après l'hydratation, en fondu, dans une place déjà réservée : rien ne bouge.
- Sur un petit écran (portable 1366 × 768, téléphone), la page s'allonge de la hauteur de la bande, qu'on voit en défilant. Sur mobile, son haut dépasse au bas du premier écran.
- Si le globe échoue (pas de WebGL, couleur illisible), rien n'est dessiné et l'accueil reste celui d'avant.

## Alternatives écartées

- **three.js / react-three-fiber** : plus de 100 kB gzip pour un globe décoratif.
- **L'aurore** (shader maison) : la plus spectaculaire, mais la plus coûteuse pour le GPU (plein écran) et la seule à sortir de la palette sobre du site. Elle est gardée hors du dépôt pour plus tard.
- **Alternance garantie entre les deux fonds** : il faudrait mémoriser le dernier fond (stockage du navigateur, cas d'échec), pour un bénéfice cosmétique.
- **Tirage côté serveur** : écart d'hydratation, ou page sans pré-rendu.
- **Animation à droite de la recherche** (deux colonnes sur desktop) : entièrement visible sans défiler sur tout écran desktop, mais la recherche se rétrécit, le titre passe sur deux lignes et la grille tombe à une semaine. Comparée en vrai, la bande en dessous a été préférée.
- **Animation comme fond sous le contenu, ou dans le seul espace libre** : soit elle passait sous la recherche et les suggestions, soit elle disparaissait faute de place sur les écrans courants (142 px libres sur un écran 1080p à 125 %).
- **Bande en haut de page sur mobile** : visible dès l'arrivée, mais elle repoussait la recherche de 120 px et la grille y était coupée.
