# syntax=docker/dockerfile:1.7
# Pingsell API — Fastify 5 + node:sqlite (Node >= 22.5), run with tsx.

# ---- deps: production dependencies only, from the lockfile ----
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# ---- runner ----
FROM node:24-alpine AS runner
# tini : un vrai PID 1 même sans `init: true` (sinon le SIGKILL du chien de garde serait ignoré par node en PID 1).
RUN apk add --no-cache su-exec wget tini
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4000 \
    DATABASE_PATH=/data/pingsell.db \
    UPLOAD_DIR=/data/uploads
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY src ./src
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh && mkdir -p /data && chown -R node:node /data /app

VOLUME ["/data"]
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=600s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/health" >/dev/null || exit 1

# -s : tini reste sous-reaper quand Docker met déjà son propre init en PID 1 (compose `init: true`).
ENTRYPOINT ["/sbin/tini", "-s", "--", "docker-entrypoint.sh"]
CMD ["node", "--import", "tsx", "src/server.ts"]
