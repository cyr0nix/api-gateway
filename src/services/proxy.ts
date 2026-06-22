import http from "node:http";
import https from "node:https";
import { Request, Response, RequestHandler } from "express";
import { createProxyMiddleware, Options } from "http-proxy-middleware";
import { config, ServiceName } from "../config/index.js";
import { logger } from "../observability/logger.js";
import { upstreamRequestsTotal } from "../observability/metrics.js";
import { nextTarget } from "./serviceRegistry.js";
import { getBreaker } from "./circuitBreaker.js";

// keep-alive agents so we reuse tcp connections to upstreams instead of paying
// for a fresh handshake on every request - this is the single biggest win for
// throughput when proxying at high rps.
const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 256, maxFreeSockets: 64 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 256, maxFreeSockets: 64 });

const idempotent = (method: string) => ["GET", "HEAD", "OPTIONS"].includes(method);

const buildProxy = (service: ServiceName) => {
  const options: Options = {
    changeOrigin: true,
    agent: httpAgent,
    // pick the upstream replica per request (round-robin load balancing)
    router: () => nextTarget(service),
    // upstream gets killed if it doesn't respond in time
    proxyTimeout: config.proxy.timeout,
    timeout: config.proxy.timeout,
    // express already strips the /api/<service> mount prefix from req.url, so
    // the upstream sees /123 not /api/users/123 - no extra rewrite needed.
    on: {
      proxyReq: (proxyReq, req) => {
        if (proxyReq.protocol === "https:") proxyReq.setHeader("X-Forwarded-Proto", "https");
        // forward authenticated user context downstream
        const user = (req as Request).user;
        if (user) {
          proxyReq.setHeader("X-User-Id", String(user.userId));
          proxyReq.setHeader("X-User-Role", String(user.role));
        }
        proxyReq.setHeader("X-Forwarded-By", "api-gateway");
        const rid = (req as Request).headers["x-request-id"];
        if (rid) proxyReq.setHeader("X-Request-Id", String(rid));
      },
      proxyRes: (proxyRes, _req, res) => {
        const status = proxyRes.statusCode || 502;
        const locals = (res as Response).locals;
        // treat upstream 5xx as a failure so the breaker can trip on a sick service
        if (status >= 500) locals.__cbReject?.(new Error(`upstream ${status}`));
        else locals.__cbResolve?.();
      },
      error: (err, _req, res) => {
        // don't write a response here - let the breaker fallback decide, so we
        // can still retry or send a single clean 503
        (res as Response).locals?.__cbReject?.(err);
      },
    },
  };

  return createProxyMiddleware(options);
};

export const createServiceProxy = (service: ServiceName): RequestHandler => {
  const targets = config.services[service];
  if (!targets || targets.length === 0) {
    throw new Error(`Unknown or unconfigured service: ${service}`);
  }

  const proxy = buildProxy(service);

  // a single attempt resolves when the upstream answers, rejects on error/5xx
  const fireOnce = (req: Request, res: Response): Promise<void> =>
    new Promise<void>((resolve, reject) => {
      res.locals.__cbResolve = resolve;
      res.locals.__cbReject = reject;
      proxy(req, res, (err?: unknown) => {
        if (err) reject(err instanceof Error ? err : new Error(String(err)));
      });
    });

  // the breaker wraps the proxy attempt + a bounded retry for idempotent calls
  const action = async (req: Request, res: Response): Promise<void> => {
    let attempt = 0;
    while (true) {
      try {
        await fireOnce(req, res);
        return;
      } catch (err) {
        const canRetry =
          attempt < config.proxy.retries && idempotent(req.method) && !res.headersSent;
        if (!canRetry) throw err;
        attempt++;
        logger.warn(`[Proxy] ${service} retry ${attempt} after error`);
      }
    }
  };

  const breaker = getBreaker(service, action as never);

  return (req: Request, res: Response) => {
    breaker
      .fire(req, res)
      .then(() => upstreamRequestsTotal.inc({ service, outcome: "success" }))
      .catch((err: Error) => {
        const open = err?.message?.includes("Breaker is open");
        const timeout = err?.message?.includes("Timed out");
        const outcome = open ? "rejected" : timeout ? "timeout" : "error";
        upstreamRequestsTotal.inc({ service, outcome });

        if (!res.headersSent) {
          res.status(503).json({ error: "Service unavailable", service, retryable: true });
        } else {
          // upstream died mid-stream - nothing we can do but cut the socket
          res.destroy();
        }
      });
  };
};

// expose for graceful shutdown
export const closeProxyAgents = (): void => {
  httpAgent.destroy();
  httpsAgent.destroy();
};
