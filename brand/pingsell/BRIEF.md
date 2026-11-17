# Brief logo — Pingsell

## Produit
SaaS pour e-commerçants (Shopify et autres) : email marketing + notifications push mobiles + automatisations (panier abandonné, expédition, bienvenue, reconquête) + statistiques du revenu rapporté par chaque message. Né en France, vendu à l'international (US/UK d'abord).

## Nom
**Pingsell** = « ping » (la notif qui arrive) + « sell » (la vente). Tagline : « Every ping, a sale. » / « Chaque notif, une vente. »

## Exigence du fondateur (non négociable)
« Le logo doit parler » et il doit obtenir **50/50** auprès d'un directeur artistique indépendant et sévère, 10/10 sur chacun de ces axes :
1. **Parle en 2 secondes** sans texte : on comprend « notification / message » ET « vente / argent / commerce ».
2. **Distinctif, appropriable** : ne doit ressembler à aucune icône stock (cloche Material, badge iOS, sac Shopify, bulle de chat, Wi-Fi/RSS, OneSignal, Klaviyo, Attentive, Postscript). Une vraie signature.
3. **Exécution** au niveau Stripe / Linear / Qonto / Pentagram : courbes propres, graisses cohérentes, jonctions compensées, équilibre optique, système de rayons limité (2 valeurs max), formes pleines (aucun stroke dans les fichiers livrés).
4. **Lisible à 16 px** : master 16 px dessiné au pixel (1 px = 4u sur la grille 64, cotes multiples de 4), master 32 px (1 px = 2u). Exporter favicon-16.png et favicon-32.png dessinés au pixel (python PIL), pas le SVG réduit.
5. **Cohérence clair/sombre** : un seul dessin maître ; contraste WCAG ≥ 3:1 de chaque élément de la marque contre son fond, dans les deux modes et sur la tuile d'app ; test en niveaux de gris : écart de luminance ≥ 0,25 entre les deux couleurs de la marque.

## Palette
Bleu électrique #145cff, marine #0b214a, bleu clair #4d82ff, pâle #dce6ff, blanc. Un seul accent chaud autorisé si l'histoire l'exige (ex. corail #e9542f sur clair / #f8603a sur marine) — attention : corail sur #145cff = 1,7:1, interdit sans séparation.

## Wordmark
« pingsell » (ou « Pingsell », à justifier) dessiné à la main en formes pleines, géométrique gras (esprit Outfit/Futura mais géométrie propre — aucune police commerciale vectorisée). Compensations optiques : jonctions fût/panse amincies (~80 %), dépassement des ronds 1u haut et bas, courbes ~103 % des fûts. Approches : droit–droit 9, droit–rond 7, rond–rond 5 (unités lockup), à ajuster à l'œil. Un détail signature relie le mot au symbole (ex. le point du i, les deux l). Lockup : symbole aligné sur ligne de base et hauteur des ascendantes, pas centré.

## Livrables (dans ton dossier uniquement)
icon.svg (64×64, transparent), icon-dark.svg (pour fond marine), app-icon.svg (1024, tuile r≈225, marque ~60 %), favicon.svg (32×32), favicon-16.png, favicon-32.png, logo.svg (fond clair, transparent), logo-dark.svg (fond marine, transparent), concepts.svg (≥ 5 pistes étiquetées), NOTES.md (français, ≤ 25 lignes : concept, histoire, construction, couleurs, contrastes mesurés, tailles minimales).

## Boucle qualité (obligatoire)
Rendu avec Chrome headless si disponible (`"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless --screenshot=... --window-size=...` sur une petite page HTML) sinon `qlmanage -t -s 512`. Vérifier : 512 px, tuile, lockups sur blanc / marine / #111, favicons en vrais pixels agrandis au plus proche voisin, niveaux de gris, contrastes calculés. Itérer jusqu'à croire honnêtement à 10/10 sur chaque axe. Fichiers temporaires dans `_work/` de ton dossier, supprimés à la fin.
