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
- `JWT_SECRET`, `API_KEY_SALT`, `KMS_MASTER_KEY`, `GIFTCARD_HMAC_SECRET`
- `PORTAL_URL` to the server's reachable customer URL, without a trailing slash

Generate random secrets without putting them in Git:

```bash
openssl rand -hex 64   # JWT_SECRET
openssl rand -hex 32   # API_KEY_SALT, KMS_MASTER_KEY, GIFTCARD_HMAC_SECRET
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

## Services and volumes

| Service    | Default internal port | Purpose                         |
| ---------- | --------------------: | ------------------------------- |
| `postgres` |                  5432 | PostgreSQL 15 database          |
| `redis`    |                  6379 | BullMQ queues and cache         |
| `api`      |                  3002 | Fastify API and workers         |
| `admin`    |          8081 → 80 | Admin React SPA and API proxy    |
| `portal`   |          8080 → 80 | Customer React SPA and API proxy |

Persistent data is stored only in the `pgdata` and `redisdata` Docker volumes.
Observability services are not part of the default production compose file.
