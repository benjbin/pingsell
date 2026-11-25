#!/usr/bin/env bash
# Chiffre au repos le volume Docker de Pingsell (base SQLite + images) avec LUKS2 (AES-256-XTS).
#
# À lancer UNE fois, en root, sur le serveur Coolify :
#   sudo bash encrypt-volume.sh <nom-du-volume-docker> <taille-en-Go>
#   ex. : sudo bash encrypt-volume.sh abc123_pingsell-data 20
#
# Ce que fait le script :
#   1. crée un conteneur chiffré /var/lib/pingsell-crypt/<volume>.luks de la taille demandée ;
#   2. génère une clé aléatoire /root/.pingsell-crypt/<volume>.key (lisible par root seulement) ;
#   3. arrête les conteneurs qui utilisent le volume, copie les données dans le conteneur chiffré,
#      monte le conteneur chiffré à la place du dossier du volume, puis relance les conteneurs ;
#   4. ajoute /etc/crypttab et /etc/fstab pour que tout se remonte au redémarrage du serveur.
# L'ancien contenu en clair est gardé dans <dossier>.plain-backup jusqu'à ce que vous le supprimiez
# (voir la dernière ligne affichée) : vérifiez d'abord que l'app marche.
set -euo pipefail

VOL="${1:-}"; SIZE_GB="${2:-}"
if [[ -z "$VOL" || -z "$SIZE_GB" ]]; then echo "Usage : sudo bash $0 <volume-docker> <taille-Go>"; exit 1; fi
[[ $EUID -eq 0 ]] || { echo "À lancer en root (sudo)."; exit 1; }
command -v cryptsetup >/dev/null || { apt-get update -qq && apt-get install -y -qq cryptsetup; }

DATA="$(docker volume inspect -f '{{ .Mountpoint }}' "$VOL")"
NAME="pingsell-$(echo "$VOL" | tr -c 'a-zA-Z0-9-' '-' | cut -c1-40)"
STORE=/var/lib/pingsell-crypt; KEYDIR=/root/.pingsell-crypt
FILE="$STORE/$VOL.luks"; KEY="$KEYDIR/$VOL.key"
[[ -e "$FILE" ]] && { echo "$FILE existe déjà : le volume est sans doute déjà chiffré."; exit 1; }
USED_MB=$(du -sm "$DATA" | cut -f1)
(( SIZE_GB * 1024 > USED_MB * 2 )) || { echo "Taille trop petite : le volume occupe déjà ${USED_MB} Mo."; exit 1; }

echo "→ Volume $VOL ($DATA, ${USED_MB} Mo) vers un conteneur chiffré de ${SIZE_GB} Go"
mkdir -p "$STORE" "$KEYDIR"; chmod 700 "$STORE" "$KEYDIR"
head -c 64 /dev/urandom > "$KEY"; chmod 400 "$KEY"
fallocate -l "${SIZE_GB}G" "$FILE"; chmod 600 "$FILE"
cryptsetup luksFormat --type luks2 --cipher aes-xts-plain64 --key-size 512 --batch-mode "$FILE" "$KEY"
cryptsetup open --key-file "$KEY" "$FILE" "$NAME"
mkfs.ext4 -q "/dev/mapper/$NAME"

CONTAINERS=$(docker ps -q --filter "volume=$VOL")
[[ -n "$CONTAINERS" ]] && { echo "→ Arrêt des conteneurs : $CONTAINERS"; docker stop $CONTAINERS >/dev/null; }

TMP=$(mktemp -d); mount "/dev/mapper/$NAME" "$TMP"
cp -a "$DATA/." "$TMP/"; sync; umount "$TMP"; rmdir "$TMP"
mv "$DATA" "$DATA.plain-backup"; mkdir "$DATA"
mount "/dev/mapper/$NAME" "$DATA"
chown --reference="$DATA.plain-backup" "$DATA"; chmod --reference="$DATA.plain-backup" "$DATA"

grep -q "^$NAME " /etc/crypttab 2>/dev/null || echo "$NAME $FILE $KEY luks" >> /etc/crypttab
grep -q " $DATA " /etc/fstab || echo "/dev/mapper/$NAME $DATA ext4 defaults,nofail,x-systemd.before=docker.service 0 2" >> /etc/fstab
systemctl daemon-reload || true

[[ -n "$CONTAINERS" ]] && docker start $CONTAINERS >/dev/null
echo
echo "✓ Volume chiffré et monté : $(findmnt -no SOURCE "$DATA") sur $DATA"
cryptsetup status "$NAME" | grep -E 'type|cipher|keysize'
echo
echo "Vérifiez l'app, puis supprimez la copie en clair :  rm -rf '$DATA.plain-backup'"
echo "Gardez une copie de la clé hors du serveur (gestionnaire de mots de passe) : base64 $KEY"
