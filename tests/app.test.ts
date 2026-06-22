import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../src/app.js";
import { generateToken } from "../src/middleware/auth.js";
import { closeRedis } from "../src/services/redis.js";
import { closeProxyAgents } from "../src/services/proxy.js";
import { resetBreakers } from "../src/services/circuitBreaker.js";

let app: Express;

beforeAll(() => {
  app = createApp();
});

afterAll(async () => {
  resetBreakers();
  closeProxyAgents();
  await closeRedis();
});

describe("health probes", () => {
  it("liveness is always ok", async () => {
    const res = await request(app).get("/health/live");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("alive");
  });

  it("readiness reports ready when redis is up", async () => {
    const res = await request(app).get("/health/ready");
    expect(res.status).toBe(200);
    expect(res.body.redis).toBe(true);
  });

  it("exposes prometheus metrics", async () => {
    const res = await request(app).get("/metrics");
    expect(res.status).toBe(200);
    expect(res.text).toContain("http_request_duration_seconds");
  });

  it("stamps a request id header", async () => {
    const res = await request(app).get("/health/live");
    expect(res.headers["x-request-id"]).toBeDefined();
  });
});

describe("auth", () => {
  it("rejects requests without a token", async () => {
    const res = await request(app).get("/api/admin");
    expect(res.status).toBe(401);
  });

  it("rejects a non-admin token with 403", async () => {
    const token = generateToken({ userId: "u1", role: "user" });
    const res = await request(app).get("/api/admin").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it("allows an admin token", async () => {
    const token = generateToken({ userId: "admin1", role: "admin" });
    const res = await request(app).get("/api/admin").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.message).toBe("Admin area");
    expect(res.body.user.userId).toBe("admin1");
  });

  it("rejects a malformed token", async () => {
    const res = await request(app).get("/api/admin").set("Authorization", "Bearer not-a-jwt");
    expect(res.status).toBe(401);
  });
});

describe("not found", () => {
  it("returns 404 for unknown routes", async () => {
    const res = await request(app).get("/nope");
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Route not found");
  });
});
