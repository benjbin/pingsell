import { config } from './config.js';
import { openDatabase } from './db.js';
import { buildApp } from './app.js';
import { createProvider } from './services/mailer.js';
import { SendingWorker } from './worker.js';

async function main() {
  const db = openDatabase(config.databasePath);
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
    worker.stop();
    try {
      await app.close();
    } finally {
      db.close();
      process.exit(0);
    }
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
