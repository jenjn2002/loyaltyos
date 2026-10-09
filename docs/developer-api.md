# Developer API integration

The admin **Document → Developer** tab contains the detailed Vietnamese and English integration guide, code samples, and current route catalog. Its guide content lives in `apps/admin/src/content/developer-api-guide.ts`. The guide describes the implemented routes, not a separate API specification or a new permission model.

## Environment and base URL

Use an API base URL ending in `/api/v1`, without a trailing slash:

| Deployment | Admin API base |
| --- | --- |
| Production | `https://adminloyalty.trunglocxoay.store/api/v1` |
| Sandbox | `https://adminloyalty-sandbox.trunglocxoay.store/api/v1` |
| Custom deployment | `https://<your-domain>/api/v1` |
| Isolated HTTP test | `http://<host>:<published-admin-or-customer-port>/api/v1` |

The matching customer domains also proxy `/api/v1`. Sandbox has its own database and uses `NODE_ENV=production`; a public development seed credential cannot authenticate there. Treat sandbox writes as real sandbox records. Keep credentials and resource IDs separate between environments.

For local development, check the actual API process configuration: the admin Vite proxy targets port 3002, while `.env.example` sets `PORT_API=3000`. The Docker API listens on port 3002 internally; the production Compose file does not publish that port directly.

`/healthz`, `/readyz`, `/metrics`, and `/docs` are backend-root paths, not `/api/v1` paths. The supplied frontend proxy exposes `/api/` and `/healthz`; Swagger requires backend access or an explicitly configured proxy, plus valid authentication, including for `/docs/json`. Many route schemas are parsed in handlers with Zod and are not fully represented in generated OpenAPI.

## Authentication and permissions

| Client | Authentication | Identity and limitations |
| --- | --- | --- |
| Trusted server | `X-API-Key` | Program and scope come from the key. Optional `X-Program-Id` must match exactly. |
| Administrator | `POST /admin/login` with `{email, password}` | HttpOnly `loyaltyos_admin_session` cookie; configured role capabilities apply. `GET /admin/me` returns the program and capabilities. |
| Member | `POST /auth/login` with `{username, password}` and program selection | HttpOnly `loyaltyos_session` cookie and `data.sessionId`; `Authorization: Bearer <sessionId>` is an opaque session credential, not a JWT. |

Valid member Bearer authentication takes precedence over cookies, followed by admin cookie, member cookie, and API key. Avoid mixed authentication contexts. Admin sessions are configured for 8 hours, member sessions for 30 days; logout or invalidation can end them earlier.

`SERVER` keys bypass admin capability checks and belong only in trusted services. `CLIENT` keys do not create a member identity. A key cannot call `/members/me` resources by adding a program header. Some routes also require an actual administrator identity: issuance proposals and approval decisions cannot use a server key. Conversely, `POST /events` requires a `SERVER` key with an `API_KEY` actor and rejects an admin cookie.

## Provisioning API keys

Open **Admin → Settings → API access** to copy the current Program ID and API base URL, view key metadata, create a key, or confirm revocation. Program ID is the existing tenant identifier, read-only and not regenerated. `API_KEY_SALT` is internal configuration, not an API credential.

Context requires `settings.view`; metadata requires `api_key.view` or `api_key.manage`; creation and revocation require `api_key.manage`. Key permissions default to Owner only, and can be explicitly delegated in Roles & permissions. The UI defaults to `CLIENT` and 90 days; `SERVER` keys bypass administrator capabilities and must only be used in trusted backend services. Expiry accepts 1–3650 days or explicit no expiry. Copy the newly generated secret once into a secret manager; it is cleared when dismissed or when leaving Settings. Existing secrets cannot be retrieved.

All REST key management requires an actual admin session cookie, not a `SERVER` API key:

| Method | Path (relative to `/api/v1`) | Result |
| --- | --- | --- |
| GET | `/admin/settings/api-access` | Current `programId`, `environment`, `apiBasePath` under `data` |
| GET | `/admin/settings/api-keys` | Metadata only under `data.keys` |
| POST | `/admin/settings/api-keys` | `{name, scope, expiresInDays}` → `data.key` metadata and one-time `data.secret` |
| DELETE | `/admin/settings/api-keys/:id` | Soft-revoke the exact program-scoped record and return metadata |

POST defaults `expiresInDays` to 90; `null` explicitly disables expiry. Key management responses use `Cache-Control: no-store`, creation is limited to 10 requests per minute per client IP, and creation/revocation write an atomic CONFIG_CHANGE audit record without the secret or digest. Program context can also be read with a permitted `SERVER` key, but list/create/revoke cannot.

As a deployment-owner fallback, explicitly run `apps/api/prisma/manage-api-key.mjs` using the existing Prisma client and the intended deployment's database environment. The script is not a startup hook and does not execute when this documentation is viewed.

Run from the repository directory, with `DEPLOY_ENV_FILE`, `DEPLOY_COMPOSE_FILE`, and `PROGRAM_ID` set to the intended deployment's values:

```bash
docker compose --env-file "$DEPLOY_ENV_FILE" -f "$DEPLOY_COMPOSE_FILE" \
  exec api node apps/api/prisma/manage-api-key.mjs --help

docker compose --env-file "$DEPLOY_ENV_FILE" -f "$DEPLOY_COMPOSE_FILE" \
  exec api node apps/api/prisma/manage-api-key.mjs list \
  --environment sandbox --program-id "$PROGRAM_ID"

# This creates a real key only when explicitly executed by the owner.
docker compose --env-file "$DEPLOY_ENV_FILE" -f "$DEPLOY_COMPOSE_FILE" \
  exec api node apps/api/prisma/manage-api-key.mjs create \
  --environment sandbox --program-id "$PROGRAM_ID" \
  --name external-integration --scope SERVER --days 90
```

Use `--environment production` for production and `development` for a local context. The script requires `DATABASE_URL`; it does not automatically read `.env`. The environment argument must match `LOYALTYOS_ENVIRONMENT`, or the `NODE_ENV` fallback outside a configured deployment. This checks configuration consistency; the owner must still verify which database the URL selects. A running image built before the helper was added must be updated before the container command can work.

Creation requires an existing active program, an explicit `SERVER` or `CLIENT` scope, and a name. The helper generates 32 cryptographically random bytes and defaults to a 90-day lifetime. `--days` accepts 1–3650; only explicit `--no-expiry` creates a key without expiry, and cannot be combined with `--days`.

The CLI returns the new secret once as `data.key` (the REST endpoint uses `data.secret`). Store it privately in a secret manager; do not record the terminal output in CI, tickets, shared shells, or screen recordings. Save `data.id` separately. List returns metadata only, never existing credentials. New keys store only a SHA-256 digest in `ApiKey.key`. Legacy plaintext keys remain compatible until rotated, so database and backup access must still be restricted. A stored digest is never accepted as a credential.

To rotate, create and test a replacement, switch the integration, then revoke the exact previous record ID:

```bash
docker compose --env-file "$DEPLOY_ENV_FILE" -f "$DEPLOY_COMPOSE_FILE" \
  exec api node apps/api/prisma/manage-api-key.mjs revoke \
  --environment sandbox --program-id "$PROGRAM_ID" --key-id "$KEY_RECORD_ID"
```

Revocation sets `isActive=false` for that exact ID and program. It preserves metadata and does not delete other keys. If a secret is lost, issue a replacement; the helper has no credential-retrieval operation.

## Concrete integration flow

1. Verify the selected program with an admin session (`GET /admin/me`) or owner-held program metadata. Test `GET /point-types` before a write.
2. Use an authorized `SERVER` key or administrator with `member.manage` to `POST /members`. Include valid required metadata fields if configured. Save the returned `data.id`; creating email-only members does not provision password login.
3. For trusted activity, `POST /events` with a stable `Idempotency-Key`, `type`, `memberId`, and `payload`. Purchase rules use `payload.amount` as their multiplier base. Nonpurchase events require an active matching event definition and must respect its automation and approval configuration.
4. Check `GET /members/:id/balance` and `/members/:id/transactions` with `wallet.view` or a server key. There is no generic `/earn` endpoint and no fixed award guarantee.
5. For a grant requiring human approval, an actual administrator posts `/admin/issuance-proposals` with `{memberId, pointTypeId, amount, reason}` and an idempotency key. A configured matching workflow is required. Assigned reviewers use their own admin sessions and the approval inbox/decision routes.
6. For the customer's own wallet and notifications, use the member's session with `/members/me/point-wallets`, `/members/me/transactions`, `/members/me/notifications`, and `/members/me/notifications/unread-count`. `PATCH /members/me/notifications/:id` accepts `{read: true}` or `{read: false}`.

Member creation schedules onboarding issuance asynchronously. Do not automatically submit a second registration event; first inspect the configured rules to avoid duplicate rewards. Direct adjustment routes are privileged ledger operations and do not replace approval proposals.

## Responses, retries, and limits

Successful JSON usually uses `{data: ...}`. Lists can be arrays or a paginated object, and 204 responses have no body. `GET /members` defaults to page 1 and page size 20, max 100; member notifications default to 20, max 50; configuration/approval arrays may have no pagination at all. Check the route rather than applying one universal contract.

Errors normally use `{error: {code, message, details?}}`. Handle status and code because messages can be translated or literal. Validation generally returns 400; credentials 401; denied scope/context/capabilities 403; missing resources 404; business/concurrency conflicts 409; some balance/business conditions 422; throttling 429. Honor `Retry-After` when available.

The default limit is 1000 requests/minute per `X-API-Key`, otherwise IP. Password logins are 5/min, events 60/min, credit giving 30/min, credit exchange 10/min, reward redemption 20/min, and coalition writes 30/min. Counters are process-local in the current configuration.

Idempotency is route-specific. Events enforce a stable program/key and matching type, member, and canonical payload; changed content returns 409, and a processing lease may return `EVENT_PROCESSING` for a delayed retry. An initial member-event response contains `data.event` and earning results, while a completed replay returns the event record directly in `data` with `idempotent: true`. Financial routes commonly require keys of at least 8 characters. Member creation and generic configuration creation do not become idempotent merely because a header is supplied. Approval decisions rely on workflow decision/status guards. Some adjustment handlers can repeat secondary audit/notification effects even when the ledger transaction is deduplicated.

Persist the business request ID and payload before a write. Reconcile uncertain outcomes and reuse the original ID only on endpoints with verified retry support. Use ISO datetime values such as UTC `Z` timestamps where accepted, respect schema-specific date rules and scheduled business timezones, and treat separate reads/writes as concurrent rather than reservations.

Never expose keys, cookies, session IDs, passwords, member personal data, webhook secrets, or provider credentials in URLs, browser bundles, frontend environment variables, screenshots, shared Postman exports, or logs.
