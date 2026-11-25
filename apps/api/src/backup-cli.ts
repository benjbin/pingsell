// Sauvegardes à la main.
//   npm run backup                         → fait une sauvegarde chiffrée maintenant (même réglages que le worker)
//   npm run backup -- restore <f.pgbk> <sortie.db>  → déchiffre une sauvegarde vers une base SQLite
// La clé vient de BACKUP_ENCRYPTION_KEY (jamais en argument, pour qu'elle ne finisse pas dans l'historique du shell).
// La sauvegarde lit la base de l'API sur une connexion à part, en lecture seule : ni migration ni réglage
// modifié, et l'API qui tourne à côté n'est pas gênée.
import { existsSync } from 'node:fs';
import { config } from './config.js';
import { decryptFile, runBackup } from './services/backup.js';

const [cmd, src, dest] = process.argv.slice(2);
const key = config.backup.key;
if (!key) {
  console.error('BACKUP_ENCRYPTION_KEY manquante.');
  process.exit(1);
}

if (cmd === 'restore') {
  if (!src || !dest) {
    console.error('Usage : npm run backup -- restore <fichier.pgbk> <sortie.db>');
    process.exit(1);
  }
  if (existsSync(dest)) {
    console.error(`${dest} existe déjà : choisissez un autre fichier de sortie.`);
    process.exit(1);
  }
  await decryptFile(src, dest, key);
  console.log(`Base restaurée dans ${dest}. Arrêtez l'API, remplacez DATABASE_PATH par ce fichier, puis redémarrez.`);
} else if (!cmd) {
  if (config.databasePath === ':memory:' || !existsSync(config.databasePath)) {
    console.error(`Base introuvable : ${config.databasePath}`);
    process.exit(1);
  }
  const file = await runBackup(config.databasePath, { ...config.backup, key });
  console.log(`Sauvegarde chiffrée : ${file}${config.backup.s3 ? ' (copiée sur S3)' : ''}`);
} else {
  console.error('Usage : npm run backup  |  npm run backup -- restore <fichier.pgbk> <sortie.db>');
  process.exit(1);
}
