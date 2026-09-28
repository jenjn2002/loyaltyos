# LoyaltyOS Docker deployment runbook

This runbook covers the current Docker Compose deployments for production and
the production-data sandbox. Production and sandbox use separate Compose
projects, databases, Redis instances, and named volumes. Both frontends are
published through the standalone Traefik stack in `infra/traefik`; PostgreSQL,
Redis, and the API are not published directly to the Internet.

The Compose labels in this repository currently serve these hostnames:

| Environment | Customer | Admin |
| --- | --- | --- |
| Production | `https://loyalty.trunglocxoay.store` | `https://adminloyalty.trunglocxoay.store` |
| Sandbox | `https://loyalty-sandbox.trunglocxoay.store` | `https://adminloyalty-sandbox.trunglocxoay.store` |

If you change a hostname, update the matching router rules in both Compose
files, the sandbox `PORTAL_URL`/`ADMIN_URL` in
`docker-compose.staging.yml`, the production URLs in `.env.production`, and
the frontend switch URLs in the Dockerfiles/Compose build args as applicable.

## 1. Prepare the server and DNS

On the Linux server:

1. Install Git, Docker Engine, and the Docker Compose plugin using the official
   [Docker Engine instructions](https://docs.docker.com/engine/install/) for
   your Linux distribution and the [Compose plugin instructions](https://docs.docker.com/compose/install/linux/).
   Confirm `git --version`,
   `docker --version`, and `docker compose version` work for the account that
   will deploy the app. If that account needs `sudo docker`, prefix Docker
   commands below with `sudo`; membership in the `docker` group grants
   root-equivalent access.
2. Get the repository source. On a new server:

   ```bash
   git clone https://github.com/jenjn2002/loyaltyos.git
   cd loyaltyos
   ```

   If the repository is already present, instead `cd` to that checkout; do not
   create a second checkout with a different Compose project context.

3. Point the four hostnames in the table above to this server's public IPv4
   address with DNS `A` records. Add `AAAA` records only if the server's IPv6
   address is reachable from the Internet. Check propagation with, for example:

   ```bash
   for host in loyalty.trunglocxoay.store adminloyalty.trunglocxoay.store \
     loyalty-sandbox.trunglocxoay.store adminloyalty-sandbox.trunglocxoay.store; do
     printf '%s: ' "$host"
     getent ahostsv4 "$host" | awk 'NR == 1 { print $1 }'
   done
   ```

   Each hostname should resolve to this server. If using a DNS proxy/CDN, it
   must pass HTTP-01 challenge requests through to this server.
4. Allow inbound TCP ports `80` and `443` in the cloud firewall/security group.
   Port 80 is required by Traefik's Let's Encrypt HTTP-01 challenge and is
   redirected to HTTPS. Ensure no other process is already listening on these
   ports. Docker-published ports can bypass UFW rules; do not rely on UFW alone
   to restrict published containers. See Docker's [packet filtering and
   firewalls guidance](https://docs.docker.com/engine/network/packet-filtering-firewalls/).
5. Keep PostgreSQL and Redis ports private. Production Compose binds optional
   diagnostic ports to `127.0.0.1`; the sandbox does not publish either port.
   If a localhost port is already occupied, set different `PORT_POSTGRES` or
   `PORT_REDIS` values in `.env.production`.

Run the commands below from the repository root unless the command says
otherwise. Create the shared Traefik network and certificate volume if this is
the first LoyaltyOS/Traefik deployment on the host:

```bash
docker network inspect traefik-hrm >/dev/null 2>&1 || docker network create traefik-hrm
docker volume inspect docker_traefik_letsencrypt >/dev/null 2>&1 || \
  docker volume create docker_traefik_letsencrypt
```

Do not delete `docker_traefik_letsencrypt`; it stores issued certificates.

## 2. Configure production

Create the private production environment file and restrict its permissions:

```bash
cp infra/docker/.env.production.example infra/docker/.env.production
chmod 600 infra/docker/.env.production
```

Edit `infra/docker/.env.production`. The checked-in example is configured for
the production hostnames above. Set a real `LETSENCRYPT_EMAIL`, strong initial
admin credentials, and unique random values for all core secrets. At minimum,
review:

- `POSTGRES_PASSWORD`
- `ADMIN_DEFAULT_EMAIL`, `ADMIN_DEFAULT_NAME`, `ADMIN_DEFAULT_PASSWORD`
- `JWT_SECRET`, `API_KEY_SALT`, `KMS_MASTER_KEY`, `GIFTCARD_HMAC_SECRET`
- `ENV_HANDOFF_SECRET`
- `LETSENCRYPT_EMAIL`, `PORTAL_URL`, `ADMIN_URL`, `COOKIE_SECURE`

Generate values locally and paste them into the private env file; never commit
or share that file:

```bash
openssl rand -hex 32
openssl rand -hex 64
```

`ENV_HANDOFF_SECRET` is also needed by sandbox. When creating sandbox, copy this
exact value from production into `.env.staging`; do not rotate the production
value merely to set up sandbox. Generate separate values for the other
sandbox secrets.

## 3. Start Traefik and production

Validate the Compose configuration before starting it. `--quiet` avoids
printing resolved environment values to the terminal:

```bash
docker compose -f infra/traefik/docker-compose.yml \
  --env-file infra/docker/.env.production config --quiet
docker compose -f infra/docker/docker-compose.prod.yml \
  --env-file infra/docker/.env.production config --quiet
```

Start Traefik first, then the production application:

```bash
docker compose -p loyaltyos-traefik \
  -f infra/traefik/docker-compose.yml \
  --env-file infra/docker/.env.production up -d

docker compose -f infra/docker/docker-compose.prod.yml \
  --env-file infra/docker/.env.production up -d --build
```

Check the services, API health through the customer hostname, and Traefik logs:

```bash
docker compose -f infra/docker/docker-compose.prod.yml \
  --env-file infra/docker/.env.production ps
curl -f https://loyalty.trunglocxoay.store/healthz
docker compose -p loyaltyos-traefik \
  -f infra/traefik/docker-compose.yml \
  --env-file infra/docker/.env.production logs --tail=100 traefik
```

Open the customer/admin URLs from the table above and sign in with the initial
admin credentials. The API applies Prisma migrations at startup and creates
one minimal Program and one `SUPER_ADMIN` only when the database has no admin.
It does not run the development seed or overwrite existing admins/data.

For Microsoft 365 sign-in, use the callback URI shown on Admin Settings when
registering the application. The callback is based on the configured portal
origin; with this deployment it is `https://loyalty.trunglocxoay.store/api/v1/auth/microsoft/callback`.

SMTP and external integrations are optional for the core app. Configure the
`SMTP_*` values in `.env.production` only if production should send email; the
other optional integration variables are documented in
`.env.production.example`. Sandbox always routes email to its private MailHog
container and disables copied external credentials during sanitization.

## 4. Configure and start the production-data sandbox

### Security and prerequisites

The sandbox is intentionally a copy of production. It includes real member and
admin personal data, passwords, roles, program settings, and point history.
Treat it as production-sensitive data and only give the sandbox link to
authorized testers. Sandbox uses separate hostnames and sessions, so each user
signs in separately with the copied account credentials.

Before the first restore, production must be running and reachable from the
same Docker host. The sandbox uses its own `loyaltyos_staging` database,
`loyaltyos_staging_pgdata` and `loyaltyos_staging_redisdata` volumes, and
`loyaltyos-staging-backend` network. Its API network is internal; only the
admin/customer frontends join `traefik-hrm`. Sandbox email is captured by
MailHog. The migration job has temporary egress for Prisma engine download;
the runtime API does not.

Create the sandbox file from the template and lock it down:

```bash
cp infra/docker/.env.staging.example infra/docker/.env.staging
chmod 600 infra/docker/.env.staging
```

Set unique random values for `POSTGRES_PASSWORD`, `JWT_SECRET`, `API_KEY_SALT`,
`KMS_MASTER_KEY`, and `GIFTCARD_HMAC_SECRET`. Set `ENV_HANDOFF_SECRET` to the
exact same value as production. `ADMIN_DEFAULT_*` are only bootstrap values
for an empty sandbox database; after restoring production they do not replace
the copied admin accounts. Do not reuse production secrets other than the
required shared handoff secret.

Keep `POSTGRES_USER=loyaltyos` and `POSTGRES_DB=loyaltyos_staging` unless you
also update the commands below. Sandbox hostnames are currently fixed in
`docker-compose.staging.yml`; changing them requires editing that file and
updating DNS/TLS accordingly.

### Initial production copy or sandbox refresh

The following procedure is used both for the first copy and each later
refresh. It replaces the sandbox database contents. It does not modify
production. For a later refresh, stop the sandbox app containers first; skip
this `stop` command on the very first setup, when they do not exist yet:

```bash
docker compose -p loyaltyos-staging \
  -f infra/docker/docker-compose.staging.yml \
  --env-file infra/docker/.env.staging stop api admin portal
```

Then start only its isolated data services (run this on both first setup and
refresh):

```bash
docker compose -p loyaltyos-staging \
  -f infra/docker/docker-compose.staging.yml \
  --env-file infra/docker/.env.staging up -d postgres redis mailhog
```

Get the running production PostgreSQL container from Compose rather than
guessing its generated container name, recreate only the sandbox database, and
stream a custom-format dump directly into it (no dump file is left on disk):

```bash
set -euo pipefail
PROD_POSTGRES_ID="$(docker compose \
  -f infra/docker/docker-compose.prod.yml \
  --env-file infra/docker/.env.production ps -q postgres)"
test -n "$PROD_POSTGRES_ID" || {
  echo "Production postgres container was not found; check the production Compose project." >&2
  exit 1
}

docker compose -p loyaltyos-staging \
  -f infra/docker/docker-compose.staging.yml \
  --env-file infra/docker/.env.staging exec -T postgres sh -lc \
  'dropdb --if-exists --maintenance-db=postgres -U "$POSTGRES_USER" "$POSTGRES_DB" && createdb --maintenance-db=postgres -U "$POSTGRES_USER" "$POSTGRES_DB"'

docker exec "$PROD_POSTGRES_ID" sh -lc \
  'pg_dump -Fc --no-owner --no-acl -U "$POSTGRES_USER" "$POSTGRES_DB"' \
  | docker compose -p loyaltyos-staging \
      -f infra/docker/docker-compose.staging.yml \
      --env-file infra/docker/.env.staging exec -T postgres sh -lc \
      'pg_restore --exit-on-error --no-owner --no-acl -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
```

Sanitize after every restore. Build the API/admin/customer images first, then
start the migration job and app services. The one-shot `migration` service
uses the API image but does not declare its own `build`; building first avoids
Compose trying to pull that local image tag before the API image exists:

```bash
docker compose -p loyaltyos-staging \
  -f infra/docker/docker-compose.staging.yml \
  --env-file infra/docker/.env.staging exec -T postgres sh -lc \
  'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  < infra/docker/staging-sanitize.sql

docker compose -p loyaltyos-staging \
  -f infra/docker/docker-compose.staging.yml \
  --env-file infra/docker/.env.staging build api admin portal
docker compose -p loyaltyos-staging \
  -f infra/docker/docker-compose.staging.yml \
  --env-file infra/docker/.env.staging up -d migration api admin portal
```

Check startup and both routes:

```bash
docker compose -p loyaltyos-staging \
  -f infra/docker/docker-compose.staging.yml \
  --env-file infra/docker/.env.staging ps
curl -f https://loyalty-sandbox.trunglocxoay.store/healthz
curl -I https://adminloyalty-sandbox.trunglocxoay.store/
```

`staging-sanitize.sql` removes copied sessions/tokens and disables copied API
keys, Microsoft sign-in, webhooks, and coalition credentials. Review this SQL
before changing the refresh procedure. It does not anonymize members; the
sandbox still contains personal data.

### Sandbox refresh cautions

- This procedure drops/recreates only the database configured in the sandbox
  PostgreSQL container. Verify every `-p loyaltyos-staging` and
  `docker-compose.staging.yml` argument before running it.
- Never point the staging Compose file at production credentials, hostnames,
  or volumes. Never mount the production data volume into sandbox.
- Run the sanitize SQL after every restore and before starting the sandbox
  API. Do not skip this step.
- Refresh overwrites sandbox-only changes and accounts created there. Export
  anything needed before refreshing.
- Do not use `docker compose down -v` as a routine restart/upgrade command; it
  deletes the named data volumes for the selected Compose project.

## 5. Upgrades and routine operations

Back up the relevant database before upgrading. Keep Compose project names,
environment files, and named volumes unchanged. From the repository root:

For an existing production install, keep using the same repository checkout,
working directory, Compose file, and environment file that created its
volumes. Do not add/change `-p` for production during an upgrade: a different
Compose project name can point Compose at a new set of empty volumes.

```bash
git pull --ff-only

# Production
docker compose -f infra/docker/docker-compose.prod.yml \
  --env-file infra/docker/.env.production up -d --build

# Sandbox (if it is deployed)
docker compose -p loyaltyos-staging \
  -f infra/docker/docker-compose.staging.yml \
  --env-file infra/docker/.env.staging build api admin portal
docker compose -p loyaltyos-staging \
  -f infra/docker/docker-compose.staging.yml \
  --env-file infra/docker/.env.staging up -d migration api admin portal
```

For a database backup, stream the production custom-format dump to a protected
backup location with your normal encrypted backup procedure. Do not place
database dumps in the Git checkout or serve them from a web directory.

For a local, permission-restricted backup file, use a dedicated directory
outside the checkout and verify the file exists before an upgrade:

```bash
set -euo pipefail
LOYALTYOS_BACKUP_DIR=/var/backups/loyaltyos
sudo install -d -m 700 -o "$(id -un)" -g "$(id -gn)" "$LOYALTYOS_BACKUP_DIR"
umask 077
PROD_POSTGRES_ID="$(docker compose \
  -f infra/docker/docker-compose.prod.yml \
  --env-file infra/docker/.env.production ps -q postgres)"
test -n "$PROD_POSTGRES_ID" || {
  echo "Production postgres container was not found." >&2
  exit 1
}
docker exec "$PROD_POSTGRES_ID" sh -lc \
  'pg_dump -Fc --no-owner --no-acl -U "$POSTGRES_USER" "$POSTGRES_DB"' \
  > "$LOYALTYOS_BACKUP_DIR/production-$(date -u +%Y%m%dT%H%M%SZ).dump"
```

Move backups off-host using your encrypted backup process. This command does
not prune or overwrite previous backup files.

Useful diagnostics:

```bash
docker compose -f infra/docker/docker-compose.prod.yml \
  --env-file infra/docker/.env.production logs --tail=200 api
docker compose -p loyaltyos-staging \
  -f infra/docker/docker-compose.staging.yml \
  --env-file infra/docker/.env.staging logs --tail=200 api migration
docker compose -p loyaltyos-traefik \
  -f infra/traefik/docker-compose.yml \
  --env-file infra/docker/.env.production logs --tail=200 traefik
```

If TLS is not issued, check that DNS points to this host, TCP/80 is reachable,
the shared `traefik-hrm` network exists, and Traefik logs show no ACME errors.
If a route returns 404, check its hostname against the Compose router label. If
it returns 502, check the frontend/API health and that the frontend is attached
to the expected Docker networks.

## 6. Service and volume reference

| Service | Port | Purpose |
| --- | ---: | --- |
| `postgres` | 5432 internal | PostgreSQL 15; production diagnostic binding is localhost-only |
| `redis` | 6379 internal | BullMQ queues and cache |
| `api` | 3002 internal | Fastify API and workers |
| `admin` | 80 internal | Admin SPA and same-origin API proxy |
| `portal` | 80 internal | Customer SPA and same-origin API proxy |
| `traefik` | 80/443 public | HTTP redirect and HTTPS/TLS termination |

Production data lives in the production Compose PostgreSQL/Redis volumes.
Sandbox data lives in `loyaltyos_staging_pgdata` and
`loyaltyos_staging_redisdata`; Traefik certificates live in
`docker_traefik_letsencrypt`.
