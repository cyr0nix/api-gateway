import { Redis, Cluster } from "ioredis";
import { config } from "../config/index.js";
import { logger } from "../observability/logger.js";

export type RedisClient = Redis | Cluster;

let redis: RedisClient | null = null;

// build a client based on the configured topology:
// standalone -> single node, sentinel -> HA via sentinels, cluster -> sharded
const build = (): RedisClient => {
  const common = {
    password: config.redis.password,
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    retryStrategy(times: number) {
      // back off up to 2s, then keep trying at 2s - we don't want to give up
      return Math.min(times * 200, 2000);
    },
  };

  if (config.redis.mode === "cluster") {
    return new Cluster(config.redis.nodes, {
      redisOptions: { password: config.redis.password },
    });
  }

  if (config.redis.mode === "sentinel") {
    return new Redis({
      sentinels: config.redis.nodes,
      name: config.redis.sentinelName,
      ...common,
    });
  }

  return new Redis({ host: config.redis.host, port: config.redis.port, ...common });
};

export const getRedis = (): RedisClient => {
  if (!redis) {
    redis = build();
    redis.on("connect", () => logger.info(`[Redis] connecting (${config.redis.mode})`));
    redis.on("ready", () => logger.info("[Redis] ready"));
    redis.on("error", (err: Error) => logger.error({ err: err.message }, "[Redis] error"));
    redis.on("close", () => logger.warn("[Redis] connection closed"));
  }
  return redis;
};

// used by the readiness probe - is redis actually answering?
export const isRedisHealthy = async (): Promise<boolean> => {
  try {
    const pong = await getRedis().ping();
    return pong === "PONG";
  } catch {
    return false;
  }
};

export const closeRedis = async (): Promise<void> => {
  if (redis) {
    await redis.quit();
    redis = null;
  }
};
