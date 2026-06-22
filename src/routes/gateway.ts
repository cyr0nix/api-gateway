import { Router } from "express";
import { createServiceProxy } from "../services/proxy.js";
import { authenticate, authorize } from "../middleware/auth.js";
import { rateLimiter } from "../middleware/rateLimiter.js";
import { cache } from "../middleware/cache.js";

const router = Router();

// public routes - no auth needed, cached and generously rate limited
router.use(
  "/api/products",
  rateLimiter({ max: 200, keyPrefix: "rl:products" }),
  cache({ ttl: 60 }),
  createServiceProxy("products")
);

// protected routes
router.use(
  "/api/users",
  rateLimiter({ max: 100, keyPrefix: "rl:users" }),
  authenticate,
  createServiceProxy("users")
);

router.use(
  "/api/orders",
  rateLimiter({ max: 50, keyPrefix: "rl:orders" }),
  authenticate,
  createServiceProxy("orders")
);

// admin only routes
router.use(
  "/api/admin",
  rateLimiter({ max: 30, keyPrefix: "rl:admin" }),
  authenticate,
  authorize("admin"),
  (req, res) => {
    res.json({ message: "Admin area", user: req.user });
  }
);

export default router;
