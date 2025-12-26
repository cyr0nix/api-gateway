import { createProxyMiddleware, Options } from "http-proxy-middleware";
import { config } from "../config/index.js";

type ServiceName = keyof typeof config.services;

const proxyOptions = (target: string): Options => ({
  target,
  changeOrigin: true,
  pathRewrite: (path, req) => {
    // remove the service prefix from path
    // /api/users/123 -> /123
    const segments = path.split("/").slice(3);
    return "/" + segments.join("/");
  },
  on: {
    proxyReq: (proxyReq, req) => {
      // forward user info if authenticated
      if ((req as any).user) {
        proxyReq.setHeader("X-User-Id", (req as any).user.userId);
        proxyReq.setHeader("X-User-Role", (req as any).user.role);
      }
      proxyReq.setHeader("X-Forwarded-By", "api-gateway");
    },
    error: (err, req, res) => {
      console.error("[Proxy] Error:", err.message);
      (res as any).status(503).json({ error: "Service unavailable" });
    },
  },
});

export const createServiceProxy = (serviceName: ServiceName) => {
  const target = config.services[serviceName];

  if (!target) {
    throw new Error(`Unknown service: ${serviceName}`);
  }

  return createProxyMiddleware(proxyOptions(target));
};

export const serviceRegistry: Record<string, ServiceName> = {
  users: "users",
  orders: "orders",
  products: "products",
};
