# build stage - compile typescript to dist/
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# deps stage - production node_modules only
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

# runtime stage - slim, non-root
FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

# run as an unprivileged user
RUN addgroup -S app && adduser -S app -G app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./

USER app
EXPOSE 3000

# node as PID 1 receives SIGTERM directly so graceful shutdown works
CMD ["node", "dist/index.js"]
