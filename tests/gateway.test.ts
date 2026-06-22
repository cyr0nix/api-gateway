import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../src/app.js";
import { generateToken } from "../src/middleware/auth.js";
import { getRedis, closeRedis } from "../src/services/redis.js";
import { closeProxyAgents } from "../src/services/proxy.js";
import { resetBreakers } from "../src/services/circuitBreaker.js";

let app: Express;
const upstreams: http.Server[] = [];

// a tiny fake upstream that echoes back what it received - lets us assert the
// gateway rewrote the path and actually forwarded the request body.
const startUpstream = (port: number, name: string): Promise<http.Server> =>
  new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify({
            service: name,
            path: req.url,
            method: req.method,
            userId: req.headers["x-user-id"] || null,
            body: body || null,
          })
        );
      });
    });
    server.listen(port, () => resolve(server));
  });

beforeAll(async () => {
  app = createApp();
  // products = 4101, users = 4102 (matches tests/setup.ts). orders (4103) is
  // intentionally left down to exercise the unavailable-service path.
  upstreams.push(await startUpstream(4101, "products"));
  upstreams.push(await startUpstream(4102, "users"));
  await getRedis().del("cache:/api/products/widget-1");
});

afterAll(async () => {
  resetBreakers();
  closeProxyAgents();
  await Promise.all(upstreams.map((s) => new Promise((r) => s.close(r))));
  await closeRedis();
});

describe("proxy", () => {
  it("forwards GET to the upstream and rewrites the path", async () => {
    const res = await request(app).get("/api/products/widget-1");
    expect(res.status).toBe(200);
    expect(res.body.service).toBe("products");
    // /api/products/widget-1 -> /widget-1
    expect(res.body.path).toBe("/widget-1");
  });

  it("forwards the request body on POST (regression for the json-parse bug)", async () => {
    const token = generateToken({ userId: "u-42", role: "user" });
    const payload = { hello: "world", n: 7 };

    const res = await request(app)
      .post("/api/users/create")
      .set("Authorization", `Bearer ${token}`)
      .set("Content-Type", "application/json")
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body.method).toBe("POST");
    // the upstream must have actually received the body
    expect(JSON.parse(res.body.body)).toEqual(payload);
    // and the authenticated user context was forwarded
    expect(res.body.userId).toBe("u-42");
  });

  it("returns 503 when the upstream service is down", async () => {
    const token = generateToken({ userId: "u-1", role: "user" });
    const res = await request(app)
      .get("/api/orders/123")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(503);
    expect(res.body.error).toBe("Service unavailable");
    expect(res.body.service).toBe("orders");
  });

  it("opens the circuit breaker after repeated upstream failures", async () => {
    const token = generateToken({ userId: "u-1", role: "user" });
    const hit = () =>
      request(app).get("/api/orders/x").set("Authorization", `Bearer ${token}`);

    // hammer the down service past the breaker volume threshold
    const results = await Promise.all(Array.from({ length: 15 }, hit));

    // every call fails fast with 503 - once open, the breaker rejects without
    // even touching the (still down) upstream
    expect(results.every((r) => r.status === 503)).toBe(true);
  });
});
