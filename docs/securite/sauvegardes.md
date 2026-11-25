# Sauvegardes et restauration

## Ce que fait l'API

Une fois par jour, le worker de l'API :

1. prend une copie cohérente de la base (`VACUUM INTO`), sans arrêter l'app ;
2. la compresse et la chiffre en AES-256-GCM avec `BACKUP_ENCRYPTION_KEY` (clé dérivée par scrypt) ;
3. l'écrit dans `/data/backups/pingsell-<date>.pgbk` et garde les 14 plus récentes (`BACKUP_KEEP`) ;
4. l'envoie sur un stockage S3 si `BACKUP_S3_*` est réglé (copie hors du serveur).

La copie en clair n'est jamais laissée sur le disque. Sans `BACKUP_ENCRYPTION_KEY`, rien n'est sauvegardé et l'API l'écrit dans ses journaux.

## Mise en place (une fois)

1. **Clé** : sur Coolify, `BACKUP_ENCRYPTION_KEY` est générée au premier déploiement (onglet *Environment Variables* du projet). **Copiez-la dans votre gestionnaire de mots de passe** : sans elle, les sauvegardes sont illisibles.
2. **Stockage hors serveur** (OVH Object Storage, Scaleway, AWS…) : créez un bucket privé et un utilisateur S3 limité à ce bucket, puis réglez :

| Variable | Exemple (OVH, Gravelines) |
|---|---|
| `BACKUP_S3_ENDPOINT` | `https://s3.gra.io.cloud.ovh.net` |
| `BACKUP_S3_REGION` | `gra` |
| `BACKUP_S3_BUCKET` | `pingsell-backups` |
| `BACKUP_S3_ACCESS_KEY_ID` / `BACKUP_S3_SECRET_ACCESS_KEY` | clés de l'utilisateur S3 |

Ajoutez sur le bucket une règle de cycle de vie qui supprime les objets après 30 jours (rétention).

3. Redéployez, puis vérifiez dans les journaux de l'API la ligne `sauvegarde chiffrée : …`.

Sauvegarde immédiate : dans le terminal du conteneur `api` sur Coolify, `npm run backup`.

## Restaurer

1. Récupérez le fichier `.pgbk` (dans `/data/backups` ou sur le bucket).
2. Dans le terminal du conteneur `api` : `npm run backup -- restore /data/backups/pingsell-<date>.pgbk /data/restauree.db`
3. Arrêtez l'API, remplacez `/data/pingsell.db` par `/data/restauree.db` (supprimez aussi `pingsell.db-wal` et `pingsell.db-shm`), redémarrez.

Testez une restauration au moins une fois par trimestre, sur une copie (sans remplacer la base de production).

## Prévention de la perte de données

- Copies quotidiennes, 14 jours d'historique, une copie hors du serveur.
- Volume de données chiffré ([chiffrement-volume.md](chiffrement-volume.md)) et accès serveur limité au fondateur.
- Suppressions de contacts tracées dans le journal des accès ; une erreur se corrige depuis la sauvegarde de la veille.
