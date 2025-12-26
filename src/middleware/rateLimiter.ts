import { Request, Response, NextFunction } from "express";
import { getRedis } from "../services/redis.js";
import { config } from "../config/index.js";

interface RateLimitOptions {
  windowMs?: number;
  max?: number;
  keyPrefix?: string;
}

export const rateLimiter = (options: RateLimitOptions = {}) => {
  const windowMs = options.windowMs || config.rateLimit.windowMs;
  const max = options.max || config.rateLimit.max;
  const prefix = options.keyPrefix || "rl";

  return async (req: Request, res: Response, next: NextFunction) => {
    const redis = getRedis();
    const ip = req.ip || req.socket.remoteAddress || "unknown";
    const key = `${prefix}:${ip}`;

    try {
      const current = await redis.incr(key);

      if (current === 1) {
        await redis.pexpire(key, windowMs);
      }

      const ttl = await redis.pttl(key);
      const remaining = Math.max(0, max - current);

      res.setHeader("X-RateLimit-Limit", max);
      res.setHeader("X-RateLimit-Remaining", remaining);
      res.setHeader("X-RateLimit-Reset", Date.now() + ttl);

      if (current > max) {
        return res.status(429).json({
          error: "Too many requests",
          retryAfter: Math.ceil(ttl / 1000),
        });
      }

      next();
    } catch (err) {
      // if redis fails, let the request through
      console.error("[RateLimiter] Redis error, bypassing:", err);
      next();
    }
  };
};
