import { buildApp } from "./app";
import { ConfigError, loadConfig } from "./config";
import { createContainer } from "./container";
import { LogBuffer } from "./infrastructure/log-buffer";
import { createLogger } from "./logger";

async function main(): Promise<void> {
  const config = loadConfig();
  const logs = new LogBuffer();
  const logger = createLogger(config, { buffer: logs });
  const container = await createContainer(config, logger, { logs });
  await container.start();
  const app = await buildApp(container);

  let shuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "Shutting down");
    try {
      await app.close();
      await container.stop();
      process.exit(0);
    } catch (error) {
      logger.error({ err: error }, "Shutdown failed");
      process.exit(1);
    }
  };
  process.on("SIGTERM", (signal) => void shutdown(signal));
  process.on("SIGINT", (signal) => void shutdown(signal));

  await app.listen({ host: config.host, port: config.port });
}

main().catch((error: unknown) => {
  if (error instanceof ConfigError) {
    console.error(error.message);
  } else {
    console.error(error);
  }
  process.exit(1);
});
