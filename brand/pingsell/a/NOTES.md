# Pingsell — piste A « Ping-Tag », V5 (V4 archivée dans _v4/)

**Concept.** Une étiquette de prix dont l'œillet porte un badge de notification (pastille corail détourée), et dont la pointe vibre comme un téléphone qui sonne. Couleurs = rôles : étiquette = vente (marine), écho = ping (bleu), pastille = notif (corail).

**Construction (grille 64u, relative au centre C de la pastille).** Sommets entiers (16,−16), (16,8), (−9,33), (−33,9), (−8,−16) ; congé unique 6u (pointe et dos).
Système concentrique : pastille r6 / œillet percé r10 (anneau 4u) ; pointe r6 / écho r10→16 (jour 4u, épaisseur 6u). Écho = contour de la pointe décalé, bras de 14u le long des deux pans, bouts coupés à 45°, parallèles à l'axe.
Icône 64 : bbox 56,5u, recentrée puis décalée de 2u vers le haut/droite (barycentre optique), C(36,26 ; 27,74). Même calage pour la tuile.
icon-animated.svg : rebond de la pastille (0,85→1, 160 ms) puis l'écho part du contour (4u vers l'extérieur, opacité 0→1, 280 ms ease-out) ; rien si prefers-reduced-motion. icon-mono.svg : une couleur, l'anneau devient le fond.

**Wordmark.** x 40, asc. 56, desc. −16, fûts 10u, courbes 10,3u, dépassements 1u. p, n, g : sommet plat qui file en courbe vers la panse (plus de bec) ; jonction panse/fût de p et g amincie à 8u (80 %). Contour intérieur du n tangent au fût (plus de coupe). s élargi de 8 %, colonne 9,6–9,9u (≥ 95 % du fût) ; faces des terminaisons s/e/g à 30°.
**Lockup.** Symbole ×0,991 : bas du dos sur la ligne de base, haut de l'écho sur l'ascendante 56u ; wordmark à x = 68 ; largeur ≈ 352u. Point du i en couleur du mot (Ø12, centre 51,8) : une seule pastille corail. Versions sombres : formes blanches rentrées de 0,3u.

**Pixels (tuile marine, couleurs du mode sombre, marge ≥ 1 px).** 16 px : pastille 4×4 (lignes et colonnes 6–9), angles à 75 % (#bd503e), anneau 1 px, écho 2 px, jour 1 px, bouts en escalier à 45°. 32 px : pastille Ø6, anneau 2 px, écho 3 px. favicon.svg = le dessin 32 px exact.

**Couleurs par surface.** Fond clair : marine, écho #145cff, pastille #e9542f. Fond marine/#111/tuile : blanc, écho #4d82ff, pastille #f8603a. Jamais #e9542f sur marine ; jamais de tuile #145cff sur marine (3,01:1), sinon ajouter un filet #4d82ff de 1 px.
**Contrastes WCAG.** Clair : marine 15,8 · bleu 5,24 · corail 3,64. Marine : blanc 15,8 · #4d82ff 4,47 · corail 5,05. #111 : blanc 18,9 · #4d82ff 5,35 · corail 6,05. Onglet sombre #202124 : tuile marine 1,02 (invisible, l'étiquette blanche porte le signe à 16,1:1).
**Écart N&B (ΔY).** Marine/corail 0,222 (sous 0,25) · blanc/corail 0,71 · marine/bleu 0,13 · bleu/corail 0,09 · #4d82ff/corail 0,04. Les éléments ne se touchent pas (anneau et jour), mais en gris, écho et pastille ont le même ton.

**Tailles minimales.** Lockup 28 px de haut ; en dessous, symbole seul (16 px, master pixel).
