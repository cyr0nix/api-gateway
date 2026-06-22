# API Gateway

![status](https://img.shields.io/badge/status-production--ready-brightgreen)
![node](https://img.shields.io/badge/node-%3E%3D20-339933)
![tests](https://img.shields.io/badge/tests-24%20passing-brightgreen)
![coverage](https://img.shields.io/badge/coverage-~85%25-brightgreen)
![license](https://img.shields.io/badge/license-MIT-blue)

Scalable API Gateway for microservices architecture. Built to take high request
volume in front of a fleet of upstream services, with the resilience and
observability needed to run it in production on Kubernetes.

> **Status:** hardened from a basic proxy into a production-grade gateway -
> circuit breakers, connection pooling, atomic rate limiting, stampede-safe
> caching, Prometheus metrics and zero-downtime Kubernetes deploys. See
> [What's New](#whats-new) for the full breakdown.

## Features

- **Resilience** - per-upstream circuit breakers, timeouts and bounded retries so
  one sick service can't take the whole gateway down
- **Load balancing** - round-robin across multiple replicas of each upstream
- **Keep-alive pooling** - reuses upstream TCP connections for high throughput
- **Rate Limiting** - atomic Redis-backed limiting per IP (configurable fail mode)
- **Caching** - single-flight response caching that protects upstreams from
  cache-stampede, only caching successful responses
- **Auth** - JWT validation, role-based authorization, user context forwarding
- **Observability** - Prometheus metrics, structured JSON logs, request-id tracing
- **Health probes** - separate liveness / readiness endpoints for Kubernetes
- **Graceful shutdown** - drains in-flight requests on SIGTERM for zero-downtime
  rolling deploys

## Quick Start

```bash
# install dependencies
npm install

# copy env file (set a real JWT_SECRET)
cp .env.example .env

# start development server (hot reload)
npm run dev

# production
npm run build && npm start
```

Redis must be reachable (see `REDIS_*` in `.env`).

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Dev server with hot reload (tsx) |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run compiled build |
| `npm run typecheck` | Type-check without emitting |
| `npm test` | Run the test suite (needs Redis) |
| `npm run test:coverage` | Tests with coverage (80% threshold) |

## Configuration

All settings come from the environment (validated at startup - the process exits
on invalid config). See `.env.example` for the full list. Highlights:

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | 3000 |
| `CORS_ORIGINS` | Allowed origins, comma separated (no `*` in prod) | `*` |
| `REDIS_MODE` | `standalone` / `sentinel` / `cluster` | standalone |
| `JWT_SECRET` | JWT signing secret (32+ chars, required in prod) | - |
| `RATE_LIMIT_MAX` | Max requests per window | 100 |
| `RATE_LIMIT_FAIL_MODE` | `open` or `closed` on Redis outage | open |
| `CACHE_TTL` | Cache TTL (seconds) | 300 |
| `PROXY_TIMEOUT` | Upstream timeout (ms) | 30000 |
| `PROXY_RETRIES` | Retries for idempotent calls | 1 |
| `CB_ERROR_THRESHOLD` | % failures before the breaker opens | 50 |

Each upstream URL can list multiple replicas, comma separated, and the gateway
round-robins across them:

```
USER_SERVICE_URL=http://users-1:4001,http://users-2:4001
```

## API Routes

| Route | Auth | Description |
|-------|------|-------------|
| `GET /health/live` | No | Liveness probe |
| `GET /health/ready` | No | Readiness probe (checks Redis) |
| `GET /metrics` | No | Prometheus metrics |
| `/api/products/*` | No | Product service (cached) |
| `/api/users/*` | Yes | User service |
| `/api/orders/*` | Yes | Order service |
| `/api/admin/*` | Admin | Admin endpoints |

## Architecture

```
                         +-- circuit breaker --> upstream replica 1
Client -> API Gateway ---+-- (round-robin LB) --> upstream replica 2
            |            +---------------------- > upstream replica N
            v
          Redis (rate limit + response cache)
```

Each request flows through: request-id -> security headers -> gzip -> logging ->
metrics -> rate limit -> (cache) -> auth -> circuit breaker -> proxy.

The gateway is stateless (all shared state lives in Redis), so it scales
horizontally - run more replicas behind a load balancer.

## Deployment (Kubernetes)

```bash
# build the image
docker build -t api-gateway:latest .

# set a real JWT_SECRET in k8s/gateway.yaml first, then:
kubectl apply -f k8s/gateway.yaml
```

The manifests include readiness/liveness probes, an HPA (CPU based, 3-20 pods),
a PodDisruptionBudget, resource limits, a non-root read-only container and a
preStop drain hook for zero-downtime rollouts.

## Adding New Services

1. Add the service URL(s) to `.env` and `src/config/index.ts` under `services`.
2. Add a route in `src/routes/gateway.ts`:

```typescript
router.use(
  "/api/payments",
  rateLimiter({ max: 100, keyPrefix: "rl:payments" }),
  authenticate,
  createServiceProxy("payments")
);
```

## What's New

This release turns the original single-process proxy into a gateway you can
actually run under load.

### Bug fixes

- **Proxied request bodies are no longer dropped.** A global `express.json()`
  consumed the request stream, so POST/PUT bodies never reached upstreams. Body
  parsing is no longer applied on proxy paths (covered by a regression test).
- **Atomic rate limiting.** The old `incr` + `pexpire` pair could race and leave
  keys without a TTL (permanently blocking an IP). Now a single atomic operation.
- **Cache correctness.** Error responses (4xx/5xx) are no longer cached, and
  proxied responses are actually cacheable now (the old `res.json` hook never
  fired for streamed proxy responses).
- **Path rewrite double-strip.** Express already strips the mount prefix, so the
  extra rewrite that turned `/api/users/123` into `/` was removed.

### Added

| Area | What |
|------|------|
| Resilience | Per-upstream circuit breakers (opossum), timeouts, bounded retries |
| Throughput | Keep-alive connection pooling, round-robin load balancing across replicas |
| Rate limiting | Atomic Redis limiter with `open`/`closed` fail modes |
| Caching | Single-flight (stampede-safe), success-only, proxy-aware |
| Observability | Prometheus `/metrics`, structured pino logs, request-id tracing |
| Health | Separate `/health/live` and `/health/ready` probes |
| Lifecycle | Graceful SIGTERM drain for zero-downtime rolling deploys |
| Config | zod-validated, fail-fast, prod-enforced JWT secret & CORS allowlist |
| HA | Redis standalone / sentinel / cluster support |
| Deploy | Multi-stage non-root Dockerfile + full Kubernetes manifests (HPA, PDB, probes) |
| Tests | Vitest + supertest suite, ~85% coverage |

## License

MIT
