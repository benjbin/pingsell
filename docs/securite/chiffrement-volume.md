# Chiffrer le volume de données (chiffrement au repos)

La base SQLite, les images et les sauvegardes locales sont dans le volume Docker `pingsell-data`. Le script [`scripts/server/encrypt-volume.sh`](../../scripts/server/encrypt-volume.sh) le place dans un conteneur chiffré LUKS2 (AES-256-XTS), remonté automatiquement au démarrage du serveur.

Il protège les données si un disque, un instantané ou une sauvegarde du serveur sort de chez l'hébergeur. La clé reste sur le serveur (lisible par root seulement) : protéger l'accès root reste indispensable.

## Une seule fois, sur le serveur (≈ 2 min de coupure)

1. Connectez-vous au serveur en SSH, puis trouvez le nom du volume :
   ```bash
   docker volume ls | grep pingsell-data
   ```
2. Copiez le script sur le serveur et lancez-le avec ce nom et une taille (en Go, au moins le double de l'espace utilisé) :
   ```bash
   sudo bash encrypt-volume.sh <nom-du-volume> 20
   ```
3. Vérifiez que l'app répond (`https://app…/health`), puis supprimez la copie en clair (la commande exacte est affichée à la fin).
4. Copiez la clé du volume dans votre gestionnaire de mots de passe (commande affichée à la fin).

Docker ne démarre que si le volume chiffré est monté : si le déverrouillage échoue au redémarrage, l'app reste arrêtée au lieu de tourner sur un dossier vide. Après chaque redémarrage du serveur, vérifiez `findmnt` sur le dossier du volume.

Vérifier à tout moment : `sudo cryptsetup status pingsell-<nom-du-volume>` doit afficher `type: LUKS2` et `cipher: aes-xts-plain64`.
