import { describe, it, expect, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import { rateLimiter } from "../src/middleware/rateLimiter.js";
import { cache, invalidateCache } from "../src/middleware/cache.js";
import { errorHandler, AppError } from "../src/middleware/errorHandler.js";
import { getRedis, closeRedis } from "../src/services/redis.js";

afterAll(async () => {
  await closeRedis();
});

describe("rateLimiter", () => {
  it("blocks once the limit is exceeded", async () => {
    const app = express();
    app.set("trust proxy", true);
    app.use(rateLimiter({ max: 2, keyPrefix: "test-rl-block" }));
    app.get("/", (_req, res) => res.json({ ok: true }));

    const ip = "10.1.1.1";
    const hit = () => request(app).get("/").set("X-Forwarded-For", ip);

    const r1 = await hit();
    const r2 = await hit();
    const r3 = await hit();

    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(r3.status).toBe(429);
    expect(r3.body.error).toBe("Too many requests");
    expect(r3.headers["retry-after"]).toBeDefined();
    expect(r1.headers["x-ratelimit-limit"]).toBe("2");
  });

  it("tracks limits per ip independently", async () => {
    const app = express();
    app.set("trust proxy", true);
    app.use(rateLimiter({ max: 1, keyPrefix: "test-rl-peripip" }));
    app.get("/", (_req, res) => res.json({ ok: true }));

    const a = await request(app).get("/").set("X-Forwarded-For", "10.2.2.2");
    const b = await request(app).get("/").set("X-Forwarded-For", "10.3.3.3");
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
  });
});

describe("cache", () => {
  it("serves the second GET from cache without re-running the handler", async () => {
    const prefix = "test-cache-hit";
    await getRedis().del(`${prefix}:/data`);

    let calls = 0;
    const app = express();
    app.get("/data", cache({ ttl: 60, keyPrefix: prefix }), (_req, res) => {
      calls++;
      res.json({ n: calls });
    });

    const first = await request(app).get("/data");
    const second = await request(app).get("/data");

    expect(first.headers["x-cache"]).toBe("MISS");
    expect(first.body).toEqual({ n: 1 });
    expect(second.headers["x-cache"]).toBe("HIT");
    // handler ran only once - second response came from redis
    expect(second.body).toEqual({ n: 1 });
    expect(calls).toBe(1);

    await getRedis().del(`${prefix}:/data`);
  });

  it("does not cache non-GET requests", async () => {
    const app = express();
    app.use(express.json());
    app.post("/data", cache({ keyPrefix: "test-cache-post" }), (_req, res) =>
      res.json({ ok: true })
    );

    const res = await request(app).post("/data").send({ a: 1 });
    expect(res.status).toBe(200);
    expect(res.headers["x-cache"]).toBeUndefined();
  });

  it("invalidates cached keys by pattern", async () => {
    const redis = getRedis();
    await redis.set("cache:/inv/1", JSON.stringify({ ct: "application/json", body: "{}" }));
    await redis.set("cache:/inv/2", JSON.stringify({ ct: "application/json", body: "{}" }));

    await invalidateCache("/inv/*");

    expect(await redis.get("cache:/inv/1")).toBeNull();
    expect(await redis.get("cache:/inv/2")).toBeNull();
  });
});

describe("errorHandler", () => {
  it("maps AppError to its status code", async () => {
    const app = express();
    app.get("/boom", () => {
      throw new AppError("teapot", 418);
    });
    app.use(errorHandler);

    const res = await request(app).get("/boom");
    expect(res.status).toBe(418);
    expect(res.body.error).toBe("teapot");
  });

  it("falls back to 500 for unknown errors", async () => {
    const app = express();
    app.get("/crash", () => {
      throw new Error("kaboom");
    });
    app.use(errorHandler);

    const res = await request(app).get("/crash");
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("kaboom");
  });
});
