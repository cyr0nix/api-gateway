import dotenv from "dotenv";
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || "3000"),
  nodeEnv: process.env.NODE_ENV || "development",

  redis: {
    host: process.env.REDIS_HOST || "127.0.0.1",
    port: parseInt(process.env.REDIS_PORT || "6379"),
    password: process.env.REDIS_PASSWORD || undefined,
  },

  jwt: {
    secret: process.env.JWT_SECRET || "change-this-secret",
    expiresIn: process.env.JWT_EXPIRES_IN || "7d",
  },

  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW || "60") * 1000,
    max: parseInt(process.env.RATE_LIMIT_MAX || "100"),
  },

  cache: {
    ttl: parseInt(process.env.CACHE_TTL || "300"),
  },

  services: {
    users: process.env.USER_SERVICE_URL || "http://localhost:4001",
    orders: process.env.ORDER_SERVICE_URL || "http://localhost:4002",
    products: process.env.PRODUCT_SERVICE_URL || "http://localhost:4003",
  },
};
