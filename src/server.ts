import type { Server } from "node:http";
import { createApp } from "./app.js";
import { config } from "./config/index.js";
import { logger } from "./observability/logger.js";
import { getRedis, closeRedis } from "./services/redis.js";
import { closeProxyAgents } from "./services/proxy.js";
import { resetBreakers } from "./services/circuitBreaker.js";
import { beginShutdown, isShuttingDown } from "./lifecycle.js";
import { sleep } from "./utils/helpers.js";

export const startServer = (): Server => {
  const app = createApp();

  const server = app.listen(config.port, () => {
    logger.info(`[Gateway] listening on :${config.port} (${config.nodeEnv})`);
    // warm the redis connection so the first request doesn't pay for it
    getRedis();
  });

  // keep-alive must outlive the LB's idle timeout to avoid races where the LB
  // reuses a socket the gateway just closed (the classic 502 behind ALB/nginx)
  server.keepAliveTimeout = 65000;
  server.headersTimeout = 66000;

  const shutdown = async (signal: string) => {
    if (isShuttingDown()) return;
    logger.info(`[Gateway] ${signal} received, draining...`);

    // 1. fail readiness so the LB pulls us out of rotation
    beginShutdown();

    // 2. give the LB a moment to notice before we stop accepting connections
    await sleep(config.isProd ? 5000 : 0);

    // 3. hard deadline so a stuck connection can't block the rollout forever
    const force = setTimeout(() => {
      logger.error("[Gateway] drain timed out, forcing exit");
      process.exit(1);
    }, config.shutdownTimeout);
    force.unref();

    // 4. stop accepting new connections, finish in-flight ones, clean up
    server.close(async () => {
      clearTimeout(force);
      resetBreakers();
      closeProxyAgents();
      await closeRedis();
      logger.info("[Gateway] closed cleanly");
      process.exit(0);
    });
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  // last-resort crash safety - log loudly, exit on truly unrecoverable errors
  process.on("unhandledRejection", (reason) => {
    logger.error({ reason }, "[Gateway] unhandledRejection");
  });
  process.on("uncaughtException", (err) => {
    logger.fatal({ err }, "[Gateway] uncaughtException - exiting");
    process.exit(1);
  });

  return server;
};
