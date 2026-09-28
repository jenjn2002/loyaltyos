# LoyaltyOS fresh-server Docker installation

This profile works without a domain or TLS. After the first boot:

- Customer portal: `http://SERVER_IP:8080/customer/`
- Admin: `http://SERVER_IP:8081/admin/`
- Health: `http://SERVER_IP:8080/healthz`

The default stack has no Caddy, HTTPS, Grafana, Prometheus, or OpenTelemetry
Collector. Set `CUSTOMER_HTTP_PORT` and `ADMIN_HTTP_PORT` to change the two
public ports.

## Fresh install

Install Docker Engine and the Compose plugin, then run:

```bash
git clone https://github.com/jenjn2002/loyaltyos.git
cd loyaltyos
cp infra/docker/.env.production.example infra/docker/.env.production
```

Edit `infra/docker/.env.production` and replace every required placeholder.
At minimum, set:

- `POSTGRES_PASSWORD`
- `ADMIN_DEFAULT_EMAIL`, `ADMIN_DEFAULT_NAME`, `ADMIN_DEFAULT_PASSWORD`
- `JWT_SECRET`, `API_KEY_SALT`, `KMS_MASTER_KEY`, `GIFTCARD_HMAC_SECRET`, and `ENV_HANDOFF_SECRET`
- `PORTAL_URL` to the server's reachable customer URL, without a trailing slash

Generate random secrets without putting them in Git:

```bash
openssl rand -hex 64   # JWT_SECRET
openssl rand -hex 32   # API_KEY_SALT, KMS_MASTER_KEY, GIFTCARD_HMAC_SECRET, ENV_HANDOFF_SECRET
```

Start the stack:

```bash
docker compose \
  -f infra/docker/docker-compose.prod.yml \
  --env-file infra/docker/.env.production \
  up -d --build
```

Check containers and the health endpoint:

```bash
docker compose \
  -f infra/docker/docker-compose.prod.yml \
  --env-file infra/docker/.env.production \
  ps
curl -f http://SERVER_IP:8080/healthz
```

Open `http://SERVER_IP:8080/customer/` for members or
`http://SERVER_IP:8081/admin/` for administrators. Log in with the initial admin
credentials from the env file.

For Microsoft 365 sign-in, the Admin Settings page shows the exact callback URI.
With `PORTAL_URL=http://SERVER_IP:8080/customer`, add
`http://SERVER_IP:8080/api/v1/auth/microsoft/callback` as a Web redirect URI in
the Azure App Registration. The URI is derived from the configured portal
origin, not from request headers.

The API container runs `prisma migrate deploy` before starting the server,
then creates one minimal Program and one `SUPER_ADMIN` from the three
`ADMIN_DEFAULT_*` values only when no admin exists. It does not run
`apps/api/prisma/seed.ts`, create demo members, or overwrite existing admins.

## HTTP ports and external TLS

TLS is intentionally delegated to an external reverse proxy such as Traefik.
Terminate HTTPS there and route customer traffic to port 8080 and admin traffic
to port 8081. Then update the env file:

```dotenv
PORTAL_URL=https://loyalty.example.com/customer
COOKIE_SECURE=true
CORS_ORIGINS=https://loyalty.example.com
```

`COOKIE_SECURE=true` must only be used when the browser reaches the app through
HTTPS; keep it `false` for the default HTTP/IP deployment.

## Email and optional integrations

SMTP is optional for the core installation. To enable magic-link and other
email delivery, configure all of these values:

```dotenv
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=your-smtp-user
SMTP_PASS=your-smtp-password
SMTP_FROM=loyalty@example.com
```

Resend, Twilio, OneSignal, and Apprecio variables are also optional and are
listed in `.env.production.example`. Leave them blank unless the integration
is enabled. Never commit `infra/docker/.env.production` or paste its
contents into issue reports.

## Upgrade an existing installation

Back up PostgreSQL and keep the existing Docker volumes. Then pull the desired
version and recreate the images:

```bash
git pull --ff-only
docker compose \
  -f infra/docker/docker-compose.prod.yml \
  --env-file infra/docker/.env.production \
  up -d --build
```

Migrations are applied automatically at API startup. The bootstrap is
idempotent: existing admins and customer data are preserved. Do not use
`docker compose down -v` during an upgrade because it removes database and
Redis volumes.

Existing HTTPS installations created before `COOKIE_SECURE` was added infer
secure cookies from an `https://` `PORTAL_URL`. Still set `COOKIE_SECURE=true`
explicitly during the upgrade so the intended transport policy is clear.

## Production-data sandbox

The sandbox runs as a separate Compose project with its own PostgreSQL/Redis
services and named volumes. It is not a second connection to production. The
customer and admin entry points are:

- `https://loyalty-sandbox.trunglocxoay.store`
- `https://adminloyalty-sandbox.trunglocxoay.store`

Both names must resolve to this server, and Traefik must use the existing
`traefik-hrm` network and `le` certificate resolver. The sandbox API network
is internal; only its frontend containers join Traefik. Email is captured by
the private MailHog service, and copied API keys, sessions, Microsoft sign-in,
webhooks, and coalition credentials are disabled by
`staging-sanitize.sql`. Production member/admin records, passwords, roles,
program settings, and point history are copied, so this environment contains
real personal data and must be treated accordingly. Sandbox sessions are
host-only and separate from production; users sign in once on each hostname
with the copied account credentials.

Create a private `infra/docker/.env.staging` with new random values for
`POSTGRES_PASSWORD`, `JWT_SECRET`, `API_KEY_SALT`, `KMS_MASTER_KEY`,
`GIFTCARD_HMAC_SECRET`, `ENV_HANDOFF_SECRET`, and a strong fallback `ADMIN_DEFAULT_PASSWORD`. Use the same `ENV_HANDOFF_SECRET` in production and sandbox. Do not
reuse production secrets. First start only the isolated data services, restore
the production snapshot, and sanitize it before starting the application:

```bash
docker compose -p loyaltyos-staging \
  -f infra/docker/docker-compose.staging.yml \
  --env-file infra/docker/.env.staging up -d postgres redis mailhog

# Stream a database dump directly to staging; do not write it to a shared file.
docker exec <production-postgres-container> sh -lc \
  'pg_dump -Fc --no-owner --no-acl -U "$POSTGRES_USER" "$POSTGRES_DB"' \
  | docker compose -p loyaltyos-staging \
      -f infra/docker/docker-compose.staging.yml \
      --env-file infra/docker/.env.staging exec -T postgres \
      pg_restore --no-owner --no-acl -U loyaltyos -d loyaltyos_staging

docker compose -p loyaltyos-staging \
  -f infra/docker/docker-compose.staging.yml \
  --env-file infra/docker/.env.staging exec -T postgres \
  psql -v ON_ERROR_STOP=1 -U loyaltyos -d loyaltyos_staging \
  -f - < infra/docker/staging-sanitize.sql

docker compose -p loyaltyos-staging \
  -f infra/docker/docker-compose.staging.yml \
  --env-file infra/docker/.env.staging up -d --build migration api admin portal
```

The one-shot migration service alone joins a temporary egress-capable Docker
network because Prisma may need to download its schema engine. The API runtime
stays on the internal network and skips migrations after that job succeeds.

To refresh the sandbox from production, take a consistent `pg_dump` from the
production PostgreSQL service and restore it into the staging database; apply
`staging-sanitize.sql` after every restore. A refresh replaces sandbox data.
Never mount the production data volume into this Compose project.

## Services and volumes

| Service    | Default internal port | Purpose                          |
| ---------- | --------------------: | -------------------------------- |
| `postgres` |                  5432 | PostgreSQL 15 database           |
| `redis`    |                  6379 | BullMQ queues and cache          |
| `api`      |         internal 3002 | Fastify API and workers          |
| `admin`    |             8081 → 80 | Admin React SPA and API proxy    |
| `portal`   |             8080 → 80 | Customer React SPA and API proxy |

Persistent data is stored only in the `pgdata` and `redisdata` Docker volumes.
Observability services are not part of the default production compose file.
