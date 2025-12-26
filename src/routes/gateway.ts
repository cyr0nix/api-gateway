import { Router } from "express";
import { createServiceProxy, serviceRegistry } from "../services/proxy.js";
import { authenticate, authorize } from "../middleware/auth.js";
import { rateLimiter } from "../middleware/rateLimiter.js";
import { cache } from "../middleware/cache.js";

const router = Router();

// health check
router.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// public routes - no auth needed
router.use(
  "/api/products",
  rateLimiter({ max: 200 }),
  cache({ ttl: 60 }),
  createServiceProxy("products")
);

// protected routes
router.use(
  "/api/users",
  rateLimiter({ max: 100 }),
  authenticate,
  createServiceProxy("users")
);

router.use(
  "/api/orders",
  rateLimiter({ max: 50 }),
  authenticate,
  createServiceProxy("orders")
);

// admin only routes
router.use(
  "/api/admin",
  authenticate,
  authorize("admin"),
  rateLimiter({ max: 30 }),
  (req, res) => {
    res.json({ message: "Admin area", user: req.user });
  }
);

export default router;
