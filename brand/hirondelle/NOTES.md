# Hirondelle — notes de marque

**Concept : l'enveloppe-hirondelle.** L'oiseau et le message sont un seul dessin : les ailes en faux de l'hirondelle forment le rabat ouvert, sa queue fourchue trace les plis de l'enveloppe et ses deux pointes viennent se poser dans les coins.
**Histoire :** le message part, porté par l'hirondelle, et il revient comme elle revient chaque printemps au même nid. Le U de l'enveloppe se lit aussi comme un nid ou une maison : le client rentre acheter.
**Le test des 2 s :** on voit une hirondelle (ailes pointues et balayées, queue très fourchue, vue de dessus), et une enveloppe, donc un message. Rien à voir avec l'oiseau de Twitter (vu de profil, tout rond) ni avec l'avion en papier de Telegram.

## Construction
- Grille 64. Oiseau symétrique, uniquement en courbes de Bézier cubiques : tête ronde, ailes dont la pointe déborde de 2 u de l'enveloppe, queue fourchue dont les brins s'effilent jusqu'aux coins intérieurs.
- Enveloppe : U de 48 × 27, trait de 3,8, extrémités rondes, rayon 4,4. Il n'y a pas de bord supérieur, ce sont les ailes qui le referment.
- Logotype « hirondelle » en minuscules géométriques grasses (esprit Futura/Outfit, tout en tracés vectoriels) : hauteur d'x 40, fût 9,6, o parfaits. On a choisi les minuscules parce qu'elles sont plus amicales et que les ascendantes h-d-l-l donnent un rythme d'envol. Le point du i, en bleu, reprend la tête ronde de l'oiseau, comme un point de notification.
- Lockup : l'icône est centrée optiquement sur la hauteur des ascendantes. L'espace entre l'icône et le mot vaut environ la moitié de la largeur de l'icône.

## Couleurs
- Fond clair : enveloppe et texte en marine #0b214a, oiseau et point du i en bleu électrique #145cff.
- Fond marine : enveloppe en #dce6ff, oiseau en #4d82ff, texte en blanc. L'app-icon met un oiseau blanc sur un fond #145cff.
- Pas d'accent chaud. On a testé un point #ff6a3d (œuf ou notification) : à 512 px il se lisait comme le nez ou la sonnette d'une maison, et en dessous de 32 px il disparaissait. Le duo bleu-marine reste plus net. Le #ff6a3d est gardé pour l'interface (badges, CTA).

## Tailles minimales
- Icône complète : 24 px. Favicon simplifié (grille 32, traits calés sur les pixels, mode sombre automatique) : 16 px.
- Logo horizontal : 96 px de large à l'écran, 25 mm à l'impression. Zone de protection : la hauteur de la tête de l'oiseau, tout autour.
