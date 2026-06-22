import { Request, Response, NextFunction } from "express";
import { httpRequestDuration, httpRequestsTotal } from "../observability/metrics.js";

// times every request and records it against a low-cardinality route label.
// we deliberately use the mounted route (req.baseUrl) not the raw url, otherwise
// every /api/users/<id> would explode the label set and kill prometheus.
export const metricsMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const end = httpRequestDuration.startTimer();

  res.on("finish", () => {
    const route = req.baseUrl || req.path || "unknown";
    const labels = {
      method: req.method,
      route,
      status: String(res.statusCode),
    };
    end(labels);
    httpRequestsTotal.inc(labels);
  });

  next();
};
