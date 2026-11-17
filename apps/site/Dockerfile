# syntax=docker/dockerfile:1.7
# Pingsell marketing site — Vite SPA served by nginx.

FROM node:24-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
# Baked into the bundle at build time: set them as *build* variables in Coolify.
ARG VITE_APP_URL
ARG VITE_API_URL
ENV VITE_APP_URL=$VITE_APP_URL \
    VITE_API_URL=$VITE_API_URL
RUN npm run build

FROM nginx:1.27-alpine AS runner
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1/healthz >/dev/null || exit 1
