import express, { Express } from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import { pinoHttp } from "pino-http";
import { config } from "./config/index.js";
import { logger } from "./observability/logger.js";
import { requestId } from "./middleware/requestId.js";
import { metricsMiddleware } from "./middleware/metrics.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import healthRoutes from "./routes/health.js";
import gatewayRoutes from "./routes/gateway.js";

// builds the express app without binding a port, so tests can drive it directly
// with supertest and the server file owns the lifecycle separately.
export const createApp = (): Express => {
  const app = express();

  // sit behind a load balancer / ingress - trust it for req.ip and proto
  app.set("trust proxy", true);
  app.disable("x-powered-by");

  app.use(requestId);

  // security headers + gzip
  app.use(helmet());
  app.use(
    cors(
      config.cors.origins === "*"
        ? { origin: true }
        : { origin: config.cors.origins as string[] }
    )
  );
  app.use(compression());

  // structured request logging, correlated by request id
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => req.headers["x-request-id"] as string,
      autoLogging: config.nodeEnv !== "test",
    })
  );

  app.use(metricsMiddleware);

  // health + metrics first so probes/scrapes never hit auth or rate limiting
  app.use(healthRoutes);

  // NOTE: we intentionally do NOT add express.json() globally - it would consume
  // the request stream and break proxied POST/PUT bodies. local routes that need
  // a parsed body should add express.json() on themselves.
  app.use(gatewayRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};
