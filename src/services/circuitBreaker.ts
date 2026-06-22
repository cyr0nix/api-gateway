import CircuitBreaker from "opossum";
import { config, ServiceName } from "../config/index.js";
import { logger } from "../observability/logger.js";
import { circuitBreakerEvents } from "../observability/metrics.js";

// one breaker per service. when an upstream starts failing past the threshold
// the breaker "opens" and we fail fast (503) instead of piling requests onto a
// sick service - this is what stops one bad upstream taking down the gateway.
const breakers = new Map<string, CircuitBreaker>();

type ProxyAction = (...args: unknown[]) => Promise<unknown>;

export const getBreaker = (service: ServiceName, action: ProxyAction): CircuitBreaker => {
  const existing = breakers.get(service);
  if (existing) return existing;

  const breaker = new CircuitBreaker(action, {
    timeout: config.circuitBreaker.timeout,
    errorThresholdPercentage: config.circuitBreaker.errorThreshold,
    resetTimeout: config.circuitBreaker.resetTimeout,
    // need a minimum number of requests before stats are meaningful
    volumeThreshold: 10,
    name: service,
  });

  breaker.on("open", () => {
    logger.warn(`[CircuitBreaker] ${service} OPEN - failing fast`);
    circuitBreakerEvents.inc({ service, event: "open" });
  });
  breaker.on("halfOpen", () => {
    logger.info(`[CircuitBreaker] ${service} HALF-OPEN - probing`);
    circuitBreakerEvents.inc({ service, event: "halfOpen" });
  });
  breaker.on("close", () => {
    logger.info(`[CircuitBreaker] ${service} CLOSED - recovered`);
    circuitBreakerEvents.inc({ service, event: "close" });
  });
  breaker.on("reject", () => circuitBreakerEvents.inc({ service, event: "reject" }));

  breakers.set(service, breaker);
  return breaker;
};

// for tests / shutdown - clear cached breakers
export const resetBreakers = (): void => {
  for (const b of breakers.values()) b.shutdown();
  breakers.clear();
};
