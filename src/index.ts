import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { config } from "./config/index.js";
import { getRedis, closeRedis } from "./services/redis.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import gatewayRoutes from "./routes/gateway.js";
import { generateRequestId } from "./utils/helpers.js";

const app = express();

// request id for tracing
app.use((req, res, next) => {
  req.headers["x-request-id"] = req.headers["x-request-id"] || generateRequestId();
  res.setHeader("X-Request-Id", req.headers["x-request-id"]);
  next();
});

// security & parsing
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// logging
if (config.nodeEnv !== "test") {
  app.use(morgan("short"));
}

// routes
app.use(gatewayRoutes);

// error handling
app.use(notFoundHandler);
app.use(errorHandler);

// startup
const server = app.listen(config.port, () => {
  console.log(`[Gateway] Running on port ${config.port}`);
  console.log(`[Gateway] Environment: ${config.nodeEnv}`);

  // warm up redis connection
  getRedis();
});

// graceful shutdown
const shutdown = async (signal: string) => {
  console.log(`\n[Gateway] ${signal} received, shutting down...`);

  server.close(async () => {
    await closeRedis();
    console.log("[Gateway] Closed");
    process.exit(0);
  });

  setTimeout(() => {
    console.error("[Gateway] Forced shutdown");
    process.exit(1);
  }, 10000);
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

export default app;
