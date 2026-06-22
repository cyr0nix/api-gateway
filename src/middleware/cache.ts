import { Request, Response, NextFunction } from "express";
import { Cluster } from "ioredis";
import { getRedis } from "../services/redis.js";
import { config } from "../config/index.js";
import { logger } from "../observability/logger.js";
import { cacheEvents } from "../observability/metrics.js";
import { sleep } from "../utils/helpers.js";

interface CacheOptions {
  ttl?: number;
  keyPrefix?: string;
}

// don't buffer responses bigger than this for caching - 1mb
const MAX_CACHEABLE_BYTES = 1024 * 1024;
// how long a single-flight lock is held while one request fills the cache
const LOCK_TTL_MS = 5000;

interface CachedPayload {
  ct: string; // content-type
  body: string;
}

export const cache = (options: CacheOptions = {}) => {
  const ttl = options.ttl || config.cache.ttl;
  const prefix = options.keyPrefix || "cache";

  return async (req: Request, res: Response, next: NextFunction) => {
    // only GETs are cacheable
    if (req.method !== "GET") return next();

    const redis = getRedis();
    const key = `${prefix}:${req.originalUrl}`;
    const lockKey = `${prefix}:lock:${req.originalUrl}`;

    try {
      const cached = await redis.get(key);
      if (cached) return serveHit(res, cached);

      // single-flight: only the lock holder hits the upstream, everyone else
      // waits briefly for the cache to be filled instead of stampeding it
      const gotLock = await redis.set(lockKey, "1", "PX", LOCK_TTL_MS, "NX");
      if (!gotLock) {
        const filled = await waitForKey(redis, key);
        if (filled) return serveHit(res, filled);
        // waited long enough - fall through and fetch it ourselves
      }

      cacheEvents.inc({ result: "miss" });
      res.setHeader("X-Cache", "MISS");
      interceptAndCache(res, redis, key, lockKey, ttl);
      next();
    } catch (err) {
      logger.error({ err }, "[Cache] error, bypassing");
      next();
    }
  };
};

const serveHit = (res: Response, raw: string): void => {
  const payload = JSON.parse(raw) as CachedPayload;
  cacheEvents.inc({ result: "hit" });
  res.setHeader("X-Cache", "HIT");
  res.setHeader("Content-Type", payload.ct);
  res.send(payload.body);
};

// buffer the outgoing body (works for both proxied streams and res.json) and
// store it on finish, but only for successful json responses under the limit
const interceptAndCache = (
  res: Response,
  redis: ReturnType<typeof getRedis>,
  key: string,
  lockKey: string,
  ttl: number
): void => {
  const chunks: Buffer[] = [];
  let tooBig = false;
  let size = 0;

  const origWrite = res.write.bind(res);
  const origEnd = res.end.bind(res);

  const capture = (chunk: unknown) => {
    if (!chunk || tooBig) return;
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    size += buf.length;
    if (size > MAX_CACHEABLE_BYTES) {
      tooBig = true;
      chunks.length = 0;
      return;
    }
    chunks.push(buf);
  };

  res.write = ((chunk: unknown, ...args: unknown[]) => {
    capture(chunk);
    return (origWrite as (...a: unknown[]) => boolean)(chunk, ...args);
  }) as typeof res.write;

  res.end = ((chunk: unknown, ...args: unknown[]) => {
    if (chunk && typeof chunk !== "function") capture(chunk);
    return (origEnd as (...a: unknown[]) => Response)(chunk, ...args);
  }) as typeof res.end;

  res.on("finish", () => {
    // always release the single-flight lock
    redis.del(lockKey).catch(() => {});

    const ct = String(res.getHeader("Content-Type") || "");
    const cacheable =
      res.statusCode >= 200 &&
      res.statusCode < 300 &&
      !tooBig &&
      ct.includes("application/json");

    if (!cacheable) return;

    const payload: CachedPayload = { ct, body: Buffer.concat(chunks).toString("utf8") };
    redis.setex(key, ttl, JSON.stringify(payload)).catch(() => {});
  });
};

// poll for a key a few times so single-flight waiters can pick up the result
const waitForKey = async (
  redis: ReturnType<typeof getRedis>,
  key: string,
  tries = 10,
  delayMs = 50
): Promise<string | null> => {
  for (let i = 0; i < tries; i++) {
    await sleep(delayMs);
    const v = await redis.get(key);
    if (v) return v;
  }
  return null;
};

export const invalidateCache = async (pattern: string): Promise<void> => {
  const redis = getRedis();
  // scan instead of KEYS so we don't block redis on large keyspaces. on a
  // cluster we have to scan every master node, on standalone there's just one.
  const nodes = redis instanceof Cluster ? redis.nodes("master") : [redis];

  for (const node of nodes) {
    const stream = node.scanStream({ match: `cache:${pattern}`, count: 100 });
    for await (const keys of stream as AsyncIterable<string[]>) {
      if (keys.length > 0) await node.del(...keys);
    }
  }
};
