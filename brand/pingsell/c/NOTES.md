# Pingsell : la cloche-cabas (direction C, « objet de commerce + ping »)

**Concept.** Un sac de courses (anse en U) que sa silhouette évasée et son battant corail transforment en cloche de notification. On lit le commerce et l'alerte d'un seul regard.
**Histoire.** « Le panier qui vous rappelle » : le panier abandonné se met à sonner. Chaque ping, une vente.
**Pourquoi c'est notre signe.** Ni le sac Shopify (anse posée dessus, S), ni la cloche Material (dôme), ni un badge iOS. Ce qui le rend propre à Pingsell, c'est la fusion des deux objets, pas leur juxtaposition.

**Construction (grille 64, module 4u).** Corps trapézoïdal de 32u en haut à 48u au pied, sur 36u de haut (y 8→44). Anse en U découpée dans le corps : rayons 8 et 12u, trait 4u. Le battant est un demi-disque de rayon 8u, exactement le creux de l'anse, tombé sous le sac après une fente de 4u.
Deux congés seulement, 8u (épaules, anse, battant) et 4u (lèvre) ; le 12u est le décalage parallèle du 8u. Toutes les cotes sont des multiples de 4u (1 px = 4u à 16 px, 1 px = 2u à 32 px). Formes pleines, aucun contour.

**Wordmark.** « pingsell » en bas de casse, construit point par point, sans police vectorisée.
- Proportions : x 40, ascendante 58, descendante −16, fût 10u, courbes 10,3u (103 %), dépassement des ronds 1u.
- Compensations : contre-formes superelliptiques côté fût (jonctions amincies à ~80 % sur p, n, g) ; s tracé en ligne médiane à graisse variable.
- Approches 9 / 7 / 5 (droit–droit, droit–rond, rond–rond), avec −1 sur ng et el. Signature : le point du i est une pastille corail qui fait écho au battant.
- Lockup : le sac part de la hauteur des ascendantes, le battant se pose sur la ligne de base, puis 22u de blanc avant le mot.

**Couleurs.** Clair : marine #0b214a et corail #f45d37 (#e9542f éclairci pour passer le test des gris). Sombre et tuile : blanc et corail #f8603a sur marine. Le bleu électrique #145cff reste réservé à l'interface (corail interdit dessus).
**Contrastes (WCAG).**
- Sur blanc : marine 15,8:1, corail #f45d37 3,25:1.
- Sur marine : blanc 15,8:1, corail #f8603a 5,05:1.
- Sur #111 : blanc 18,9:1, corail 6,05:1.

**Niveaux de gris.** Marine contre corail : ΔY 0,257, ΔL* 0,46. Blanc contre #f8603a : ΔY 0,71, ΔL* 0,40.
**Tailles minimales.** Symbole 16 px (master pixel ; favicon-16 et favicon-32 sur tuile marine, lisibles sur onglet clair comme sombre). Lockup 24 px de haut à l'écran, 8 mm à l'impression. Zone de protection : la hauteur du battant (8u) tout autour.
