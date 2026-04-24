# ---- Build stage ----
FROM node:20-slim AS builder

RUN apt-get update -y \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY . .
RUN npx prisma generate
RUN npm run build

# ---- Runtime stage ----
FROM node:20-slim

RUN apt-get update -y \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

COPY --from=builder /app/package.json /app/package-lock.json* ./
COPY --from=builder /app/prisma ./prisma
RUN npm ci --omit=dev && npm cache clean --force
RUN npx prisma generate

COPY --from=builder /app/build ./build
COPY --from=builder /app/public ./public

CMD ["npm", "run", "docker-start"]
