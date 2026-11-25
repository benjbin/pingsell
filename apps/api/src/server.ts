import { config } from './config.js';
import { openDatabase } from './db.js';
import { buildApp } from './app.js';
import { createProvider } from './services/mailer.js';
import { cleanBackupLeftovers } from './services/backup.js';
import { dbThreadsRunning, stopDbThreads } from './services/dbThread.js';
import { startWatchdog, type Watchdog } from './lib/watchdog.js';
import { SendingWorker } from './worker.js';

/**
 * Sort tout de suite. process.exit() attend la fin des threads SQLite (un VACUUM INTO de sauvegarde peut durer
 * des minutes) : s'il en reste, SIGKILL. SQLite en WAL ne craint pas un arrêt brutal, et la copie en clair
 * laissée par la sauvegarde est effacée au démarrage suivant.
 */
function exitNow(code: number): never {
  if (dbThreadsRunning() > 0) process.kill(process.pid, 'SIGKILL');
  process.exit(code); // PID 1 sans init ignore son propre SIGKILL
}

// Filet de sécurité : une erreur que personne n'attrape laisse le processus dans un état inconnu.
// On l'écrit et on sort ; Docker (restart: unless-stopped) relance une API propre.
let crashing = false;
const crash = (kind: string) => (err: unknown) => {
  if (crashing) return;
  crashing = true;
  console.error(`[fatal] ${kind} : ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
  exitNow(1);
};
process.on('uncaughtException', crash('uncaughtException'));
process.on('unhandledRejection', crash('unhandledRejection'));

// Arrêt propre : le worker termine son lot en cours (stopAndWait), puis le HTTP et la base se ferment.
// Au-delà, on sort quand même, avant le SIGKILL de Docker (stop_grace_period: 30s).
const SHUTDOWN_WORKER_TIMEOUT_MS = 20_000;
const SHUTDOWN_HARD_TIMEOUT_MS = 27_000;
// 0 désactive le chien de garde (débogage pas à pas).
const WATCHDOG_TIMEOUT_MS = Number(process.env.WATCHDOG_TIMEOUT_MS ?? 60_000);

/** Ce que server.ts attend du worker ; stopAndWait est optionnel (arrêt immédiat sinon). */
type StoppableWorker = { stop(): void; stopAndWait?: (timeoutMs: number) => Promise<unknown> };

async function main() {
  // Une copie en clair laissée par une sauvegarde interrompue (arrêt brutal) est une fuite : on l'efface avant tout.
  const leftovers = cleanBackupLeftovers(config.backup.dir);
  if (leftovers) console.info(`[backup] ${leftovers} fichier(s) temporaire(s) de sauvegarde interrompue supprimé(s)`);

  const db = openDatabase(config.databasePath);
  // Après les migrations (synchrones, avant le HTTP) : à partir d'ici, la boucle ne doit plus jamais bloquer.
  const watchdog: Watchdog = startWatchdog(WATCHDOG_TIMEOUT_MS);
  const provider = createProvider(config, db);
  const worker = new SendingWorker(db, config, provider);
  const app = await buildApp({ db, config, provider, kickWorker: () => worker.kick(), logger: true });

  await app.listen({ port: config.port, host: config.host });
  worker.start();
  app.log.info(
    `Pingsell API prête sur http://localhost:${config.port} · base ${config.databasePath} · email=${provider.name}`,
  );

  let closing = false;
  const shutdown = async (signal: string) => {
    if (closing) return;
    closing = true;
    app.log.info(`${signal} reçu, arrêt en cours…`);
    setTimeout(() => {
      console.error('[shutdown] arrêt trop long : sortie forcée');
      exitNow(1);
    }, SHUTDOWN_HARD_TIMEOUT_MS).unref();
    const w = worker as unknown as StoppableWorker;
    try {
      if (typeof w.stopAndWait === 'function') await w.stopAndWait(SHUTDOWN_WORKER_TIMEOUT_MS);
      else w.stop();
    } catch (err) {
      app.log.error(`[shutdown] worker : ${err instanceof Error ? err.message : String(err)}`);
      w.stop();
    }
    try {
      await app.close();
    } catch (err) {
      app.log.error(`[shutdown] http : ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      stopDbThreads(); // sauvegarde / checkpoint en cours : refaits plus tard
      for (let i = 0; i < 20 && dbThreadsRunning() > 0; i++) await new Promise((r) => setTimeout(r, 100));
      await watchdog.stop();
      db.close();
      if (dbThreadsRunning() === 0) cleanBackupLeftovers(config.backup.dir); // sinon : au prochain démarrage
      exitNow(0);
    }
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
