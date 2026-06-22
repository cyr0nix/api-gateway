import { Request, Response, NextFunction } from "express";
import { RateLimiterRedis, RateLimiterRes } from "rate-limiter-flexible";
import { getRedis } from "../services/redis.js";
import { config } from "../config/index.js";
import { logger } from "../observability/logger.js";
import { rateLimitRejections } from "../observability/metrics.js";

interface RateLimitOptions {
  windowMs?: number;
  max?: number;
  keyPrefix?: string;
}

// rate-limiter-flexible does the increment + expiry atomically in a single
// redis round-trip (lua under the hood), which fixes the old incr/pexpire race
// and halves the redis traffic per request.
export const rateLimiter = (options: RateLimitOptions = {}) => {
  const windowMs = options.windowMs || config.rateLimit.windowMs;
  const max = options.max || config.rateLimit.max;
  const prefix = options.keyPrefix || "rl";

  const limiter = new RateLimiterRedis({
    storeClient: getRedis(),
    keyPrefix: prefix,
    points: max,
    duration: Math.ceil(windowMs / 1000),
  });

  return async (req: Request, res: Response, next: NextFunction) => {
    const key = req.ip || req.socket.remoteAddress || "unknown";

    try {
      const result = await limiter.consume(key, 1);
      setHeaders(res, max, result);
      next();
    } catch (err) {
      // a RateLimiterRes (not an Error) means the limit was hit
      if (err instanceof RateLimiterRes) {
        setHeaders(res, max, err);
        rateLimitRejections.inc({ route: req.baseUrl || req.path });
        res.setHeader("Retry-After", Math.ceil(err.msBeforeNext / 1000));
        return res.status(429).json({
          error: "Too many requests",
          retryAfter: Math.ceil(err.msBeforeNext / 1000),
        });
      }

      // a real error means redis is unreachable - honour the configured policy
      logger.error({ err }, "[RateLimiter] store error");
      if (config.rateLimit.failMode === "closed") {
        return res.status(503).json({ error: "Service temporarily unavailable" });
      }
      // fail-open: let the request through rather than block all traffic
      next();
    }
  };
};

const setHeaders = (res: Response, max: number, r: RateLimiterRes): void => {
  res.setHeader("X-RateLimit-Limit", max);
  res.setHeader("X-RateLimit-Remaining", Math.max(0, r.remainingPoints));
  res.setHeader("X-RateLimit-Reset", Date.now() + r.msBeforeNext);
};
