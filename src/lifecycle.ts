// tiny shared state for the readiness probe. when we get SIGTERM we flip this
// to false so kubernetes stops routing new traffic to us *before* we actually
// close the server - that's what makes rolling deploys drop zero requests.
let shuttingDown = false;

export const isShuttingDown = (): boolean => shuttingDown;

export const beginShutdown = (): void => {
  shuttingDown = true;
};
