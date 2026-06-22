import { config, ServiceName } from "../config/index.js";

// holds the upstream replicas per service and hands them out round-robin.
// this is the cheap in-process load balancer - one gateway instance spreads
// load across all replicas of a given service.
const cursors: Record<string, number> = {};

export const getTargets = (service: ServiceName): string[] => config.services[service];

// pick the next replica for a service, wrapping around the list
export const nextTarget = (service: ServiceName): string => {
  const targets = config.services[service];

  if (!targets || targets.length === 0) {
    throw new Error(`No upstream configured for service: ${service}`);
  }

  const i = cursors[service] ?? 0;
  cursors[service] = (i + 1) % targets.length;
  return targets[i];
};
