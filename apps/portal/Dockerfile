# Stage 1: Build static assets from the complete pnpm workspace.
# The portal app imports workspace packages, so copying only apps/portal
# (as the original Dockerfile did) makes pnpm fail with WORKSPACE_PKG_NOT_FOUND.
FROM node:20-alpine AS builder
RUN corepack enable && corepack prepare pnpm@9 --activate
WORKDIR /app

COPY . .
RUN pnpm install --frozen-lockfile --ignore-scripts
RUN pnpm --filter @loyaltyos/portal build

# Stage 2: Serve with nginx + brotli
FROM fholzer/nginx-brotli:latest AS runtime
RUN rm -rf /usr/share/nginx/html/*

COPY --from=builder /app/apps/portal/dist /usr/share/nginx/html
COPY apps/portal/nginx.conf /etc/nginx/conf.d/default.conf

# curl needed for HEALTHCHECK
RUN apk add --no-cache curl

RUN addgroup -S app && adduser -S app -G app && \
    chown -R app:app /usr/share/nginx/html && \
    chown -R app:app /var/cache/nginx && \
    chown -R app:app /var/log/nginx && \
    touch /var/run/nginx.pid && \
    chown -R app:app /var/run/nginx.pid

USER app

LABEL org.opencontainers.image.source="https://github.com/jvillatox/loyaltyos"
LABEL org.opencontainers.image.description="LoyaltyOS Customer Portal — React PWA (Vite + i18n)"
LABEL org.opencontainers.image.licenses="MIT"
LABEL org.opencontainers.image.version="0.5.0-dev"

EXPOSE 80

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:80/ || exit 1
