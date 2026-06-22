import { Router } from "express";
import { isRedisHealthy } from "../services/redis.js";
import { registry } from "../observability/metrics.js";
import { isShuttingDown } from "../lifecycle.js";

const router = Router();

// liveness: is the process up and not deadlocked? k8s restarts the pod if this
// fails. it must NOT depend on redis/upstreams - a redis blip shouldn't cause
// a restart loop.
router.get("/health/live", (_req, res) => {
  res.json({ status: "alive", uptime: process.uptime() });
});

// readiness: should we receive traffic right now? checks dependencies and the
// shutdown flag. failing this just removes us from the load balancer.
router.get("/health/ready", async (_req, res) => {
  if (isShuttingDown()) {
    return res.status(503).json({ status: "shutting_down" });
  }

  const redisOk = await isRedisHealthy();
  if (!redisOk) {
    return res.status(503).json({ status: "not_ready", redis: false });
  }

  res.json({ status: "ready", redis: true });
});

// backwards-compatible shallow health check
router.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// prometheus scrape endpoint
router.get("/metrics", async (_req, res) => {
  res.setHeader("Content-Type", registry.contentType);
  res.send(await registry.metrics());
});

export default router;
