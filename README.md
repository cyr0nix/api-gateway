# API Gateway

Scalable API Gateway for microservices architecture with rate limiting, caching, and JWT authentication.

## Features

- **Rate Limiting** - Redis-based rate limiting per IP
- **Caching** - Response caching with configurable TTL
- **Authentication** - JWT token validation and user context forwarding
- **Authorization** - Role-based access control
- **Proxy** - Request forwarding to upstream services
- **Health Check** - `/health` endpoint for monitoring

## Quick Start

```bash
# install dependencies
npm install

# copy env file
cp .env.example .env

# start development server
npm run dev

# or production
npm start
```

## Configuration

All settings are in `.env`:

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | 3000 |
| `REDIS_HOST` | Redis host | 127.0.0.1 |
| `REDIS_PORT` | Redis port | 6379 |
| `JWT_SECRET` | JWT signing secret | - |
| `RATE_LIMIT_WINDOW` | Rate limit window (seconds) | 60 |
| `RATE_LIMIT_MAX` | Max requests per window | 100 |
| `CACHE_TTL` | Cache TTL (seconds) | 300 |

## API Routes

| Route | Auth | Description |
|-------|------|-------------|
| `GET /health` | No | Health check |
| `/api/products/*` | No | Product service (cached) |
| `/api/users/*` | Yes | User service |
| `/api/orders/*` | Yes | Order service |
| `/api/admin/*` | Admin | Admin endpoints |

## Architecture

```
Client -> API Gateway -> Upstream Services
              |
              v
            Redis (rate limit + cache)
```

## Adding New Services

1. Add service URL to `.env`:
```
PAYMENT_SERVICE_URL=http://localhost:4004
```

2. Update config in `src/config/index.ts`

3. Add route in `src/routes/gateway.ts`:
```typescript
router.use("/api/payments", authenticate, createServiceProxy("payments"));
```

## License

MIT
