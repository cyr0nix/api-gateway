import client from "prom-client";

// single registry for the whole process
export const registry = new client.Registry();

// default process/runtime metrics (event loop lag, gc, memory, etc)
client.collectDefaultMetrics({ register: registry });

// request latency + count, labelled so we can slice by route/status
export const httpRequestDuration = new client.Histogram({
  name: "http_request_duration_seconds",
  help: "Duration of http requests in seconds",
  labelNames: ["method", "route", "status"],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry],
});

export const httpRequestsTotal = new client.Counter({
  name: "http_requests_total",
  help: "Total http requests",
  labelNames: ["method", "route", "status"],
  registers: [registry],
});

// upstream proxy outcomes, per target service
export const upstreamRequestsTotal = new client.Counter({
  name: "gateway_upstream_requests_total",
  help: "Total upstream proxy requests",
  labelNames: ["service", "outcome"], // outcome: success | error | timeout
  registers: [registry],
});

// circuit breaker state changes, per service
export const circuitBreakerEvents = new client.Counter({
  name: "gateway_circuit_breaker_events_total",
  help: "Circuit breaker state transitions",
  labelNames: ["service", "event"], // event: open | halfOpen | close | reject
  registers: [registry],
});

// rate limit rejections
export const rateLimitRejections = new client.Counter({
  name: "gateway_rate_limit_rejections_total",
  help: "Requests rejected by the rate limiter",
  labelNames: ["route"],
  registers: [registry],
});

// cache hit/miss
export const cacheEvents = new client.Counter({
  name: "gateway_cache_events_total",
  help: "Cache hits and misses",
  labelNames: ["result"], // hit | miss
  registers: [registry],
});
