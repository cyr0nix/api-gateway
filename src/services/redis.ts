import Redis from "ioredis";
import { config } from "../config/index.js";

let redis: Redis | null = null;

export const getRedis = (): Redis => {
  if (!redis) {
    redis = new Redis({
      host: config.redis.host,
      port: config.redis.port,
      password: config.redis.password,
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        if (times > 3) return null;
        return Math.min(times * 200, 2000);
      },
    });

    redis.on("connect", () => console.log("[Redis] Connected"));
    redis.on("error", (err) => console.error("[Redis] Error:", err.message));
  }
  return redis;
};

export const closeRedis = async (): Promise<void> => {
  if (redis) {
    await redis.quit();
    redis = null;
  }
};
