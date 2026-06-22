import { Request, Response, NextFunction } from "express";
import { generateRequestId } from "../utils/helpers.js";

// stamp every request with an id (respecting an upstream one if present) so a
// single call can be traced across the gateway, the logs and the upstream.
export const requestId = (req: Request, res: Response, next: NextFunction) => {
  const id = (req.headers["x-request-id"] as string) || generateRequestId();
  req.headers["x-request-id"] = id;
  res.setHeader("X-Request-Id", id);
  next();
};
