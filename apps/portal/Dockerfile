# syntax=docker/dockerfile:1.7

FROM node:20-alpine AS toolchain
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
RUN --mount=type=cache,id=loyaltyos-pnpm-store,target=/pnpm/store \
    pnpm add --global turbo@2.0.6 --store-dir=/pnpm/store

# Keep only the portal and the workspace packages it actually imports.
FROM toolchain AS pruner
WORKDIR /app
COPY . .
RUN turbo prune @loyaltyos/portal --docker

# Stage 1: Build static assets. Dependency manifests are copied before source,
# so normal source changes reuse the expensive pnpm install layer.
FROM toolchain AS builder
WORKDIR /app
COPY --from=pruner /app/out/json/ .
COPY --from=pruner /app/out/pnpm-lock.yaml ./pnpm-lock.yaml
RUN --mount=type=cache,id=loyaltyos-pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts --store-dir=/pnpm/store

COPY --from=pruner /app/out/full/ .
COPY --from=pruner /app/tsconfig.base.json ./tsconfig.base.json
ARG VITE_BASE_PATH=/customer/
ENV VITE_BASE_PATH=${VITE_BASE_PATH}
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
