import { Request, Response, NextFunction } from "express";
import { config } from "../config/index.js";

export class AppError extends Error {
  statusCode: number;
  isOperational: boolean;

  constructor(message: string, statusCode: number = 500) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

export const errorHandler = (
  err: Error | AppError,
  req: Request,
  res: Response,
  _next: NextFunction
) => {
  const statusCode = err instanceof AppError ? err.statusCode : 500;
  const message = err.message || "Internal server error";

  console.error(`[Error] ${req.method} ${req.path} - ${message}`);

  if (config.nodeEnv === "development") {
    console.error(err.stack);
  }

  res.status(statusCode).json({
    error: message,
    ...(config.nodeEnv === "development" && { stack: err.stack }),
  });
};

export const notFoundHandler = (req: Request, res: Response) => {
  res.status(404).json({
    error: "Route not found",
    path: req.originalUrl,
  });
};
