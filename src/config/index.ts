import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

// helpers to parse env strings into the shapes we want
const csv = (val?: string): string[] =>
  (val || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

const num = (def: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === "" ? def : Number(v)))
    .pipe(z.number().int().positive());

// schema - validated once at startup, fail fast on bad config
const envSchema = z.object({
  PORT: num(3000),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),

  // comma separated origins, or "*" for all (dev only)
  CORS_ORIGINS: z.string().default("*"),

  // redis: standalone | sentinel | cluster
  REDIS_MODE: z.enum(["standalone", "sentinel", "cluster"]).default("standalone"),
  REDIS_HOST: z.string().default("127.0.0.1"),
  REDIS_PORT: num(6379),
  REDIS_PASSWORD: z.string().optional(),
  // for sentinel/cluster: host:port,host:port
  REDIS_NODES: z.string().optional(),
  REDIS_SENTINEL_NAME: z.string().default("mymaster"),

  JWT_SECRET: z.string().optional(),
  JWT_EXPIRES_IN: z.string().default("7d"),

  RATE_LIMIT_WINDOW: num(60),
  RATE_LIMIT_MAX: num(100),
  // when redis is down: "open" lets traffic through, "closed" blocks it
  RATE_LIMIT_FAIL_MODE: z.enum(["open", "closed"]).default("open"),

  CACHE_TTL: num(300),

  // proxy resilience
  PROXY_TIMEOUT: num(30000),
  PROXY_RETRIES: z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === "" ? 1 : Number(v)))
    .pipe(z.number().int().min(0).max(5)),

  // circuit breaker
  CB_ERROR_THRESHOLD: num(50), // % failures before opening
  CB_RESET_TIMEOUT: num(15000), // ms before trying half-open

  // upstream services - each can list multiple replicas, comma separated
  USER_SERVICE_URL: z.string().default("http://localhost:4001"),
  ORDER_SERVICE_URL: z.string().default("http://localhost:4002"),
  PRODUCT_SERVICE_URL: z.string().default("http://localhost:4003"),

  // how long to keep accepting requests draining on shutdown
  SHUTDOWN_TIMEOUT: num(10000),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("[Config] Invalid environment:");
  console.error(z.prettifyError(parsed.error));
  process.exit(1);
}

const env = parsed.data;

// in production a real secret is mandatory - never ship the default
const jwtSecret = env.JWT_SECRET;
if (env.NODE_ENV === "production") {
  if (!jwtSecret || jwtSecret.length < 32) {
    console.error("[Config] JWT_SECRET must be set and at least 32 chars in production");
    process.exit(1);
  }
  if (env.CORS_ORIGINS === "*") {
    console.error("[Config] CORS_ORIGINS cannot be '*' in production");
    process.exit(1);
  }
}

export const config = {
  port: env.PORT,
  nodeEnv: env.NODE_ENV,
  isProd: env.NODE_ENV === "production",

  cors: {
    // "*" means reflect any origin (dev convenience only)
    origins: env.CORS_ORIGINS === "*" ? "*" : csv(env.CORS_ORIGINS),
  },

  redis: {
    mode: env.REDIS_MODE,
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    password: env.REDIS_PASSWORD,
    nodes: csv(env.REDIS_NODES).map((n) => {
      const [host, port] = n.split(":");
      return { host, port: parseInt(port || "6379") };
    }),
    sentinelName: env.REDIS_SENTINEL_NAME,
  },

  jwt: {
    secret: jwtSecret || "change-this-secret",
    expiresIn: env.JWT_EXPIRES_IN,
  },

  rateLimit: {
    windowMs: env.RATE_LIMIT_WINDOW * 1000,
    max: env.RATE_LIMIT_MAX,
    failMode: env.RATE_LIMIT_FAIL_MODE,
  },

  cache: {
    ttl: env.CACHE_TTL,
  },

  proxy: {
    timeout: env.PROXY_TIMEOUT,
    retries: env.PROXY_RETRIES,
  },

  circuitBreaker: {
    errorThreshold: env.CB_ERROR_THRESHOLD,
    resetTimeout: env.CB_RESET_TIMEOUT,
    timeout: env.PROXY_TIMEOUT,
  },

  // each service holds a list of upstream replicas to load balance across
  services: {
    users: csv(env.USER_SERVICE_URL),
    orders: csv(env.ORDER_SERVICE_URL),
    products: csv(env.PRODUCT_SERVICE_URL),
  },

  shutdownTimeout: env.SHUTDOWN_TIMEOUT,
};

export type ServiceName = keyof typeof config.services;
