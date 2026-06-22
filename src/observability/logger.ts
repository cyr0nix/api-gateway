import pino from "pino";
import { config } from "../config/index.js";

// structured json logs in prod, pretty only in local dev
export const logger = pino({
  level: process.env.LOG_LEVEL || (config.isProd ? "info" : "debug"),
  // never leak these if they ever end up on a log object
  redact: {
    paths: ["req.headers.authorization", "req.headers.cookie", "*.password", "*.token"],
    censor: "***",
  },
  transport:
    config.nodeEnv === "development"
      ? {
          target: "pino-pretty",
          options: { colorize: true, translateTime: "HH:MM:ss", ignore: "pid,hostname" },
        }
      : undefined,
});
