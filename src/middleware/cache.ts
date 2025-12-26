import { Request, Response, NextFunction } from "express";
import { getRedis } from "../services/redis.js";
import { config } from "../config/index.js";

interface CacheOptions {
  ttl?: number;
  keyPrefix?: string;
}

export const cache = (options: CacheOptions = {}) => {
  const ttl = options.ttl || config.cache.ttl;
  const prefix = options.keyPrefix || "cache";

  return async (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== "GET") {
      return next();
    }

    const redis = getRedis();
    const key = `${prefix}:${req.originalUrl}`;

    try {
      const cached = await redis.get(key);

      if (cached) {
        res.setHeader("X-Cache", "HIT");
        return res.json(JSON.parse(cached));
      }

      res.setHeader("X-Cache", "MISS");

      // intercept the response to cache it
      const originalJson = res.json.bind(res);
      res.json = (body: unknown) => {
        redis.setex(key, ttl, JSON.stringify(body)).catch(() => {});
        return originalJson(body);
      };

      next();
    } catch (err) {
      console.error("[Cache] Error:", err);
      next();
    }
  };
};

export const invalidateCache = async (pattern: string): Promise<void> => {
  const redis = getRedis();
  const keys = await redis.keys(`cache:${pattern}`);

  if (keys.length > 0) {
    await redis.del(...keys);
  }
};
