/** Integration instructions verified against the REST routes, auth plugin and Prisma model. */
export type ApiGuideLocale = "vi" | "en";

export interface ApiGuideCodeSample {
  title: string;
  language: string;
  code: string;
}

export interface ApiGuideSection {
  id: string;
  title: string;
  purpose: string;
  steps: string[];
  notes: string[];
  codeSamples: ApiGuideCodeSample[];
}

const snippets = {
  environment: {
    language: "bash",
    code: `# Select one environment; use that environment's IDs and credentials.
API_BASE_URL='{{API_BASE_URL}}'
export PROGRAM_ID='<PROGRAM_ID_FROM_THIS_ENVIRONMENT>'
# Load API_KEY securely from your secret manager before protected requests.
curl --fail-with-body "$API_BASE_URL/point-types" \\
  -H "X-API-Key: $API_KEY" \\
  -H "X-Program-Id: $PROGRAM_ID"`,
  },
  provision: {
    language: "bash",
    code: `# Deployment owner only. Run from the repository directory.
# Set DEPLOY_ENV_FILE and DEPLOY_COMPOSE_FILE to this deployment's files.
# Confirm the environment and program before running a write command.
docker compose --env-file "$DEPLOY_ENV_FILE" -f "$DEPLOY_COMPOSE_FILE" \\
  exec api node apps/api/prisma/manage-api-key.mjs --help

docker compose --env-file "$DEPLOY_ENV_FILE" -f "$DEPLOY_COMPOSE_FILE" \\
  exec api node apps/api/prisma/manage-api-key.mjs list \\
  --environment sandbox --program-id "$PROGRAM_ID"

# The following command creates a real key ONLY when you explicitly run it.
# The secret is printed once: store securely, then clear the terminal output.
docker compose --env-file "$DEPLOY_ENV_FILE" -f "$DEPLOY_COMPOSE_FILE" \\
  exec api node apps/api/prisma/manage-api-key.mjs create \\
  --environment sandbox --program-id "$PROGRAM_ID" \\
  --name 'external-integration' --scope SERVER --days 90`,
  },
  rotate: {
    language: "bash",
    code: `# After creating a replacement, test it and switch the integration first.
# KEY_RECORD_ID is the exact old metadata ID, never the secret value.
docker compose --env-file "$DEPLOY_ENV_FILE" -f "$DEPLOY_COMPOSE_FILE" \\
  exec api node apps/api/prisma/manage-api-key.mjs revoke \\
  --environment sandbox --program-id "$PROGRAM_ID" --key-id "$KEY_RECORD_ID"`,
  },
  adminLogin: {
    language: "bash",
    code: `# Requires curl and jq. Load ADMIN_EMAIL and ADMIN_PASSWORD securely.
API_BASE_URL='{{API_BASE_URL}}'
ADMIN_COOKIE_JAR="$(mktemp)"
jq -n --arg email "$ADMIN_EMAIL" --arg password "$ADMIN_PASSWORD" \\
  '{email: $email, password: $password}' | \\
  curl --fail-with-body -c "$ADMIN_COOKIE_JAR" \\
  -H 'Content-Type: application/json' \\
  --data-binary @- "$API_BASE_URL/admin/login"

curl --fail-with-body -b "$ADMIN_COOKIE_JAR" "$API_BASE_URL/admin/me"
# data.programId and data.capabilities describe this admin's context.
# Keep the cookie file only while working. When finished, run:
# curl --fail-with-body -b "$ADMIN_COOKIE_JAR" -c "$ADMIN_COOKIE_JAR" \\
#   -X POST "$API_BASE_URL/admin/logout"
# Then remove the temporary cookie file securely.`,
  },
  memberLogin: {
    language: "bash",
    code: `# Requires an existing active member with provisioned username/password.
API_BASE_URL='{{API_BASE_URL}}'
MEMBER_LOGIN_RESPONSE="$(
  jq -n --arg username "$MEMBER_USERNAME" --arg password "$MEMBER_PASSWORD" \\
    '{username: $username, password: $password}' | \\
    curl --fail-with-body -H 'Content-Type: application/json' \\
    -H "X-Program-Id: $PROGRAM_ID" \\
    --data-binary @- "$API_BASE_URL/auth/login"
)"
MEMBER_SESSION_ID="$(printf '%s' "$MEMBER_LOGIN_RESPONSE" | jq -r '.data.sessionId')"
curl --fail-with-body "$API_BASE_URL/members/me" \\
  -H "Authorization: Bearer $MEMBER_SESSION_ID"
# MEMBER_SESSION_ID is an opaque session credential, not a JWT.
# Do not print or persist MEMBER_LOGIN_RESPONSE in shared logs.`,
  },
  postman: {
    language: "json",
    code: `{
  "method": "POST",
  "url": "{{API_BASE_URL}}/events",
  "headers": {
    "X-API-Key": "{{API_KEY}}",
    "X-Program-Id": "{{PROGRAM_ID}}",
    "Content-Type": "application/json",
    "Idempotency-Key": "{{EVENT_REQUEST_ID}}"
  },
  "body": {
    "type": "purchase",
    "memberId": "{{MEMBER_ID}}",
    "payload": {
      "amount": 1,
      "orderId": "{{ORDER_ID}}"
    }
  }
}`,
  },
  createMember: {
    language: "bash",
    code: `API_BASE_URL='{{API_BASE_URL}}'
# MEMBER_EMAIL and EXTERNAL_MEMBER_ID must be valid, environment-specific values.
jq -n --arg email "$MEMBER_EMAIL" --arg externalId "$EXTERNAL_MEMBER_ID" \\
  '{email: $email, externalId: $externalId}' | \\
  curl --fail-with-body -X POST "$API_BASE_URL/members" \\
  -H "X-API-Key: $API_KEY" -H "X-Program-Id: $PROGRAM_ID" \\
  -H 'Content-Type: application/json' --data-binary @-

# Save the returned data.id as MEMBER_ID.
curl --fail-with-body "$API_BASE_URL/members?page=1&pageSize=20" \\
  -H "X-API-Key: $API_KEY" -H "X-Program-Id: $PROGRAM_ID"`,
  },
  event: {
    language: "bash",
    code: `API_BASE_URL='{{API_BASE_URL}}'
# Generate EVENT_REQUEST_ID once per business event; persist it before sending.
jq -n --arg memberId "$MEMBER_ID" --arg orderId "$ORDER_ID" \\
  '{type: "purchase", memberId: $memberId, payload: {amount: 1, orderId: $orderId}}' | \\
  curl --fail-with-body -X POST "$API_BASE_URL/events" \\
  -H "X-API-Key: $API_KEY" -H "X-Program-Id: $PROGRAM_ID" \\
  -H "Idempotency-Key: $EVENT_REQUEST_ID" \\
  -H 'Content-Type: application/json' --data-binary @-

# Inspect configured rules and the member wallet; do not assume a fixed award.
curl --fail-with-body "$API_BASE_URL/admin/issuance-rules" \\
  -H "X-API-Key: $API_KEY" -H "X-Program-Id: $PROGRAM_ID"
curl --fail-with-body "$API_BASE_URL/members/$MEMBER_ID/balance" \\
  -H "X-API-Key: $API_KEY" -H "X-Program-Id: $PROGRAM_ID"`,
  },
  proposal: {
    language: "bash",
    code: `API_BASE_URL='{{API_BASE_URL}}'
# Use the authenticated admin cookie jar; a server key cannot submit proposals.
jq -n --arg memberId "$MEMBER_ID" --arg pointTypeId "$POINT_TYPE_ID" \\
  --arg reason "$ISSUANCE_REASON" \\
  '{memberId: $memberId, pointTypeId: $pointTypeId, amount: 1, reason: $reason}' | \\
  curl --fail-with-body -X POST "$API_BASE_URL/admin/issuance-proposals" \\
  -b "$ADMIN_COOKIE_JAR" -H 'Content-Type: application/json' \\
  -H "Idempotency-Key: $PROPOSAL_REQUEST_ID" --data-binary @-

# An assigned approver uses THEIR OWN admin session, not the requester's cookie.
curl --fail-with-body -b "$APPROVER_COOKIE_JAR" \\
  "$API_BASE_URL/admin/approvals/inbox"
curl --fail-with-body -b "$APPROVER_COOKIE_JAR" \\
  "$API_BASE_URL/admin/approvals/$APPROVAL_REQUEST_ID"
# A human decision must follow the configured approval workflow.`,
  },
  wallet: {
    language: "bash",
    code: `API_BASE_URL='{{API_BASE_URL}}'
# Trusted server: explicitly select a member within the key's program.
curl --fail-with-body "$API_BASE_URL/members/$MEMBER_ID/balance" \\
  -H "X-API-Key: $API_KEY" -H "X-Program-Id: $PROGRAM_ID"
curl --fail-with-body "$API_BASE_URL/members/$MEMBER_ID/transactions?page=1&pageSize=20" \\
  -H "X-API-Key: $API_KEY" -H "X-Program-Id: $PROGRAM_ID"

# Customer: /me is derived from this member session.
curl --fail-with-body "$API_BASE_URL/members/me/point-wallets" \\
  -H "Authorization: Bearer $MEMBER_SESSION_ID"
curl --fail-with-body "$API_BASE_URL/members/me/notifications?page=1&pageSize=20" \\
  -H "Authorization: Bearer $MEMBER_SESSION_ID"
curl --fail-with-body "$API_BASE_URL/members/me/notifications/unread-count" \\
  -H "Authorization: Bearer $MEMBER_SESSION_ID"`,
  },
  readNotification: {
    language: "bash",
    code: `API_BASE_URL='{{API_BASE_URL}}'
curl --fail-with-body -X PATCH \\
  "$API_BASE_URL/members/me/notifications/$NOTIFICATION_ID" \\
  -H "Authorization: Bearer $MEMBER_SESSION_ID" \\
  -H 'Content-Type: application/json' --data '{"read":true}'`,
  },
  fetch: {
    language: "javascript",
    code: `// Node.js 18+ on your trusted server. Keep the request ID across retries.
const API_BASE_URL = '{{API_BASE_URL}}';
for (const name of ['LOYALTYOS_API_KEY', 'LOYALTYOS_PROGRAM_ID', 'LOYALTYOS_MEMBER_ID', 'EVENT_REQUEST_ID', 'ORDER_ID']) {
  if (!process.env[name]) throw new Error('Missing required configuration: ' + name);
}
const response = await fetch(API_BASE_URL + '/events', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-API-Key': process.env.LOYALTYOS_API_KEY,
    'X-Program-Id': process.env.LOYALTYOS_PROGRAM_ID,
    'Idempotency-Key': process.env.EVENT_REQUEST_ID,
  },
  body: JSON.stringify({
    type: 'purchase',
    memberId: process.env.LOYALTYOS_MEMBER_ID,
    payload: { amount: 1, orderId: process.env.ORDER_ID },
  }),
});
const body = await response.json();
if (!response.ok) {
  // Log status/code only; never headers, session IDs, keys, or personal data.
  throw new Error('LoyaltyOS ' + response.status + ': ' + (body.error?.code ?? 'HTTP_ERROR'));
}
// Initial member event: data.event / data.earnResults.
// Completed replay: data is the event record and body.idempotent === true.
const eventRecord = body.data.event ?? body.data;`,
  },
  browser: {
    language: "javascript",
    code: `// Customer browser, after member login at this API origin.
const API_BASE_URL = '{{API_BASE_URL}}';
const response = await fetch(API_BASE_URL + '/members/me/notifications?page=1&pageSize=20', {
  credentials: 'include',
});
const body = await response.json();
if (!response.ok) throw new Error(body.error?.code ?? 'HTTP_ERROR');
const notifications = body.data;
// Cross-origin requests require an allowed CORS origin and valid cookie policy.
// Never place a SERVER key in browser bundles, VITE_* variables, or localStorage.`,
  },
  pagination: {
    language: "json",
    code: `{
  "data": {
    "items": [],
    "total": 0,
    "page": 1,
    "pageSize": 20,
    "totalPages": 0
  }
}`,
  },
  error: {
    language: "json",
    code: `{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "VALIDATION_ERROR",
    "details": [{ "path": ["memberId"], "message": "Required" }]
  }
}`,
  },
};

function sample(key: keyof typeof snippets, title: string): ApiGuideCodeSample {
  return { title, ...snippets[key] };
}

const englishGuide: ApiGuideSection[] = [
  {
    id: "environments",
    title: "1. Choose the environment and API base URL",
    purpose: "Connect to the intended database and program before sending a request. Every REST example uses a base URL ending in /api/v1, with no trailing slash.",
    steps: [
      "Production admin origin: https://adminloyalty.trunglocxoay.store; sandbox admin origin: https://adminloyalty-sandbox.trunglocxoay.store. Append /api/v1. The matching customer origins are https://loyalty.trunglocxoay.store and https://loyalty-sandbox.trunglocxoay.store; their reverse proxies also serve /api/v1.",
      "For a custom domain, use https://<your-domain>/api/v1. For an isolated HTTP installation use http://<host>:<published-admin-or-customer-port>/api/v1. Local development can use the configured API port directly; the admin Vite proxy targets localhost:3002, while .env.example sets PORT_API=3000, so verify your actual process configuration.",
      "Open Admin → Settings → API access and copy Program ID. This is the current program's existing identifier, not a secret; it cannot be regenerated. GET /admin/settings/api-access or GET /admin/me also returns data.programId. Never infer an ID from another environment.",
      "Keep separate Postman environments, keys, sessions, member IDs, point type IDs, and request IDs for production and sandbox. Select the sandbox first for integration experiments, then verify the target before each production write.",
    ],
    notes: [
      "Sandbox uses its own database and configuration, but it is a real deployment: writes create real sandbox records. It also runs NODE_ENV=production and rejects the public development seed key.",
      "The HTTP smoke-test overrides are isolated test configurations, not a recommendation for production data or credentials. TLS is required for real deployments.",
      "API endpoints use /api/v1; /healthz, /readyz, /metrics and /docs belong to the backend root. The supplied admin proxy exposes /api/ and /healthz only. Do not append /docs to the admin origin and assume Swagger is publicly available.",
    ],
    codeSamples: [sample("environment", "Check point types with the selected environment")],
  },
  {
    id: "authentication",
    title: "2. Choose API key, admin cookie, or member session",
    purpose: "Authentication determines the program and actor. The three credential types have different permissions and are not interchangeable.",
    steps: [
      "Trusted server integration: send X-API-Key. X-Program-Id is optional for an API key; if present it must exactly match the key's program or the API returns 403. The key is active only while isActive is true and its optional expiresAt has not passed.",
      "Admin application: POST /admin/login with JSON {email, password}. The response sets the HttpOnly loyaltyos_admin_session cookie; subsequent admin calls use that cookie and the user's configured capabilities. The login response is not an API key or an admin bearer token.",
      "Customer application: POST /auth/login with {username, password} and X-Program-Id (or ?programId=...). The response sets loyaltyos_session and returns data.sessionId, data.expiresAt, and data.member. Use Authorization: Bearer <sessionId> or the member cookie.",
      "Use one intended actor per client. A valid member bearer token takes precedence over an admin cookie, then the API checks the admin cookie, the member cookie, and finally X-API-Key. Mixed cookies and keys can cause a request to run under the wrong actor.",
    ],
    notes: [
      "Member bearer credentials are opaque Lucia session IDs, not JWTs. Admin sessions are configured for 8 hours and member sessions for 30 days; logout and revocation can invalidate them sooner.",
      "A SERVER key bypasses admin capability checks and is highly privileged within its program. Some endpoints still require an actual admin session or member identity. CLIENT is a limited key scope, not a member account: it cannot establish request.memberId or read /members/me.",
      "Keep SERVER keys exclusively in trusted services. Authentication and authorization remain enforced even if a route name includes public or a package comment describes a bearer endpoint; follow the deployed route contract.",
    ],
    codeSamples: [],
  },
  {
    id: "create-key",
    title: "3. Obtain and create an API key",
    purpose: "Create, inspect, and revoke integration keys in Admin → Settings → API access. An owner-only deployment helper is also available for server administration.",
    steps: [
      "Open Settings, confirm the environment and copy Program ID and API base URL. Viewing this context requires settings.view; key metadata requires api_key.view or api_key.manage, and creation/revocation requires api_key.manage. Only Owner has key permissions by default; other roles need an explicit grant.",
      "Choose Create API key, enter an integration name, select CLIENT or SERVER, and set expiry. CLIENT and 90 days are the defaults; choose SERVER only for trusted backend services, as it bypasses administrator role permissions. Expiry accepts 1–3650 days or an explicit no-expiry choice.",
      "Copy the new secret privately once and store it in the service's secret manager. Dismissing the notice or leaving Settings removes it from the screen. The list shows only metadata, never an existing secret. If lost, create a replacement and revoke the previous key.",
      "For REST management with an actual admin session, GET /admin/settings/api-keys lists metadata, POST to the same path with {name, scope, expiresInDays} returns {data: {key, secret}}, and DELETE /admin/settings/api-keys/:id revokes that record. expiresInDays defaults to 90 or may be null for no expiry. SERVER API keys cannot manage keys; an admin cookie is required.",
    ],
    notes: [
      "The helper connects to the database selected by DATABASE_URL. --environment must match the deployment configuration; it is an extra context check, not an automatic guarantee that a database URL points to the intended server. Verify the deployment before running it.",
      "Use --environment production for production, sandbox for the sandbox Compose deployment, or development for a local context. The commands below intentionally select sandbox; do not copy them into a production workflow unchanged.",
      "New keys are stored only as SHA-256 digests. Existing legacy credentials remain compatible until rotated; restrict database and backup access. API_KEY_SALT is internal configuration, not a usable API key, and is never exposed by Settings.",
      "A running image built before this helper was added will not contain it; the deployment owner must deploy an image containing the helper before using the container command. Viewing this guide does not provision or deploy anything.",
    ],
    codeSamples: [sample("provision", "Owner-only provisioning; writes occur only when explicitly run")],
  },
  {
    id: "rotate-key",
    title: "4. Rotate, revoke, and recover a key",
    purpose: "Replace a credential without interrupting the integration, and deactivate a precise old key when it is no longer needed.",
    steps: [
      "In Settings → API access, find the old record by name, scope, expiry, last use, and status. Metadata never recovers an existing secret; if lost, create a replacement.",
      "Create the replacement with the same intended program and scope. Store it securely, test a read request, switch your service configuration, and verify a harmless request succeeds under the replacement.",
      "Choose Revoke on the exact old key in Settings and confirm. DELETE /admin/settings/api-keys/:id or the helper's exact --key-id does the same scoped soft revocation: isActive=false, metadata is retained, and subsequent authentication fails.",
      "If exposure is suspected, revoke the affected credential promptly and issue a replacement through the owner. Remove it from shared outputs and review relevant audit records without reproducing the secret.",
    ],
    notes: [
      "Updating expiry or requesting a new key is not a rotation of the stored secret. This helper supports create, list, and exact-ID revoke; it has no bulk revoke, secret export, or secret retrieval operation.",
      "Use an overlap window only for an ordinary planned rotation. An expired or deactivated key returns 401; sending X-Program-Id for another program returns 403.",
    ],
    codeSamples: [sample("rotate", "Deactivate the exact previous key")],
  },
  {
    id: "admin-session",
    title: "5. Authenticate an administrator",
    purpose: "Use an admin session for operations that require a named administrator, including issuance proposals and approval decisions.",
    steps: [
      "Load the administrator's actual email and password into a protected local context. POST /admin/login uses the field password, not pass or secret, and accepts an active administrator account.",
      "Retain Set-Cookie in the Postman cookie jar, a protected curl cookie file, or a browser request with credentials: 'include'. GET /admin/me verifies the signed-in program, role, and capabilities.",
      "Follow the configured capability checks for each endpoint. GET /admin/approvals/inbox requires approval.inbox; decision endpoints require approval.decide plus assignment to the current workflow step.",
      "POST /admin/logout invalidates the session and clears the cookie. Remove the temporary cookie file after the session is no longer needed.",
    ],
    notes: [
      "Password login is limited to 5 requests per minute. Microsoft sign-in is an additional browser OIDC flow when configured; newly created Microsoft admin accounts require activation before access.",
      "Cookie security depends on the deployment's TLS/cookie configuration. For cross-origin browsers the origin must be allowed by CORS and cookie SameSite restrictions must also permit the request. Never weaken cookie policy merely to make an integration example work.",
    ],
    codeSamples: [sample("adminLogin", "Admin login and session verification with curl")],
  },
  {
    id: "member-session",
    title: "6. Authenticate a member",
    purpose: "Read a customer's own profile, wallets, history, and notifications using their member identity.",
    steps: [
      "An authorized administrator first provisions the member's username and password. Creating a member with just email or externalId does not automatically make it password-login ready.",
      "POST /auth/login with {username, password} and the program ID. Store data.sessionId only as a credential, and use Authorization: Bearer <sessionId> for member requests; browser clients can use the HttpOnly loyaltyos_session cookie instead.",
      "Call GET /members/me or GET /auth/me to verify the identity. An inactive member is rejected; an API key, including SERVER, cannot substitute for this member session on /members/me endpoints.",
      "POST /auth/logout with the same session to invalidate it and clear the member cookie. Use GET /auth/methods?programId=... to discover whether Microsoft login is configured for the program.",
    ],
    notes: [
      "Customer password login is limited to 5 requests per minute. Magic-link routes remain in the API for compatibility but the current customer sign-in flow uses username/password or configured Microsoft sign-in.",
      "The login response contains a session secret. Keep it out of logging, screenshots, shared Postman exports, URLs, analytics, and persistent browser storage.",
    ],
    codeSamples: [sample("memberLogin", "Member login and Bearer session")],
  },
  {
    id: "postman",
    title: "7. Configure and test with Postman",
    purpose: "Keep environment selection and credentials explicit while testing the real API contract.",
    steps: [
      "Create separate production and sandbox environments with API_BASE_URL, PROGRAM_ID, MEMBER_ID, POINT_TYPE_ID, and business request IDs. API_BASE_URL already includes /api/v1. Store API_KEY, passwords, and session IDs in a private secret vault or private unsynced variables.",
      "For server requests add X-API-Key: {{API_KEY}}, optional matching X-Program-Id: {{PROGRAM_ID}}, and Content-Type: application/json for JSON bodies. Choose No Auth if you enter these headers manually; do not add a Bearer token at the same time.",
      "Begin with GET {{API_BASE_URL}}/point-types, then GET /members?page=1&pageSize=20 with a SERVER key. Verify the program and IDs before sending a write request.",
      "For member endpoints first POST /auth/login, then use its sessionId as a Bearer token or the correct member cookie. For administrator workflows use /admin/login and its admin cookie. Clear unrelated cookies when switching actors.",
      "For POST /events create EVENT_REQUEST_ID once for that business event, use a raw JSON body, and preserve the exact request ID and payload on retry. Do not send a new request ID each time you click Send.",
    ],
    notes: [
      "The JSON below describes a Postman request; it is not an importable collection file. Replace the variables with values from the selected environment, and check both HTTP status and the response body.",
      "The Developer endpoint catalog is a route inventory. Backend Swagger is registered at /docs only where backend access or an explicit proxy makes it reachable; it also requires valid authentication, including /docs/json. Many route schemas are parsed with Zod inside handlers, so generated OpenAPI does not provide a complete request/response specification.",
    ],
    codeSamples: [sample("postman", "Postman request: trusted purchase event")],
  },
  {
    id: "register-member",
    title: "8. Register and find a member",
    purpose: "Create a member through an authorized integration and retain the server-issued member ID for later events.",
    steps: [
      "POST /members requires member.manage capability or a trusted SERVER key. Supported fields include externalId, email, phone, firstName, lastName, department, photoUrl, metadata, tags, username, and password. Supply only fields needed by your integration.",
      "If the program defines required member fields, include their valid values in metadata. Unknown, archived, missing required, and wrongly typed metadata fields are rejected; required metadata can make the minimal example insufficient for your deployment.",
      "A successful create returns HTTP 201 with {data: member}; save data.id as MEMBER_ID. Username/password provisioning additionally requires member.credentials.manage, and a password requires a username. The member password must be 10–1024 characters when supplied.",
      "Use GET /members with page, pageSize, search, department, and status filters to locate existing records. The default list includes active, nondeleted members; page starts at 1 and pageSize defaults to 20 with a maximum of 100.",
    ],
    notes: [
      "POST /members has no Idempotency-Key handler. Persist successful IDs, reconcile after an uncertain timeout, and apply your own durable external identity mapping before retrying creation; a header alone will not prevent duplicate members.",
      "Creation schedules configured onboarding issuance asynchronously. Do not also send a registration event by default: check the configured onboarding/event rules first to avoid awarding twice. Creating a member is not the same operation as ingesting an event.",
      "Use synthetic, authorized test data in the sandbox. Member emails, phone numbers, profile fields, and metadata are personal data.",
    ],
    codeSamples: [sample("createMember", "Create a member and list members")],
  },
  {
    id: "events-and-earn",
    title: "9. Trigger events and understand earning",
    purpose: "Report trusted external business activity so the configured issuance rules and campaigns can act on it.",
    steps: [
      "POST /events requires a SERVER API key specifically: an administrator cookie is not sufficient. Send Idempotency-Key and a body with type, optional memberId, and optional payload. Include memberId for activity intended to credit a member.",
      "Purchase uses type: 'purchase' and payload.amount as its configured rule base. Use a stable business order reference in the payload. With purchase rules, issued points are floor(payload.amount × rule.multiplier); no rule means no guaranteed award.",
      "For a nonpurchase event such as registration, configure an active event definition in the same program. External events must not target a scheduled automation mode. Definitions that require approval do not trigger direct automatic rule issuance.",
      "On an initial member event, inspect data.event, data.earnResult, data.earnResults, and data.appliedCampaigns. A completed replay returns the persisted event as data with idempotent: true, so the response shape differs from the first processing result.",
      "Verify the member wallet and transaction history after processing. Campaign eligibility, segments, point type state, validity dates, budgets, bank balances, and approval configuration determine actual results; accepting an event does not promise a fixed amount or delivery of a notification.",
    ],
    notes: [
      "Event ingestion is limited to 60 requests per minute. The same program and idempotency key identify a business event; a changed type, memberId, or canonical payload with the same Idempotency-Key returns EVENT_IDEMPOTENCY_CONFLICT (409).",
      "EVENT_PROCESSING (409) means a processing lease exists; use a delayed retry with the original key and payload. The lease is 10 minutes. After a failure the retry can resume using that key; creating a new key can duplicate business effects.",
      "There is no generic POST /earn endpoint. Trusted event ingestion and configured issuance rules form the automatic earning path. Manual ledger adjustment is a separate privileged operation, not a substitute for approval workflows.",
      "Event side effects can include points, campaigns, tier/badge evaluation, and queued notifications. Some work is best effort or asynchronous; a successful response is not proof that email/SMS/push has been delivered.",
    ],
    codeSamples: [sample("event", "Send an event and inspect the result")],
  },
  {
    id: "issuance-and-approval",
    title: "10. Issue points with the configured approval workflow",
    purpose: "Use the human approval path when a points grant must be requested and approved by assigned administrators.",
    steps: [
      "An administrator with wallet.adjust posts /admin/issuance-proposals using their admin cookie, Idempotency-Key of at least 8 characters, and {memberId, pointTypeId, amount, reason}. Amount must be a positive integer; expiresAt is an optional ISO datetime.",
      "The member and point type must be active in the same program. A matching POINT_ISSUANCE_PROPOSAL approval workflow must exist; otherwise the route returns POINT_ISSUANCE_WORKFLOW_NOT_CONFIGURED (409).",
      "Retain the returned approval request ID. Creation returns an approval record, not an immediate balance increase. Assigned reviewers use their own sessions to inspect /admin/approvals/inbox and /admin/approvals/:id, then decide through POST /admin/approvals/:id/approve or /reject.",
      "Approval bodies accept an optional comment; rejection requires a nonempty comment. Step order, reviewer assignment, requester restrictions, duplicate decisions, and workflow status are enforced. Read the final status and confirm the resulting ledger entry before treating the grant as complete.",
    ],
    notes: [
      "A SERVER key cannot submit an issuance proposal or make an approval decision because these routes require an actual administrator identity. Do not impersonate a reviewer with another person's cookie or bypass approval with a direct adjustment.",
      "POST /admin/credits/adjust and /admin/point-types/:id/adjust are separate direct ledger operations requiring wallet.adjust. They require Idempotency-Key, a nonzero integer amount, and reason, and only work when allowManualAdjustment is enabled; bank and balance constraints still apply. They do not submit an issuance proposal.",
      "A proposal's request ID must remain stable on retry. Approval decision endpoints use workflow status/decision protections, not a general Idempotency-Key protocol; a repeated completed decision can return 409.",
    ],
    codeSamples: [sample("proposal", "Submit a proposal and inspect it as an assigned approver")],
  },
  {
    id: "wallets-and-notifications",
    title: "11. Read wallets, history, and notifications",
    purpose: "Verify ledger results and retrieve the customer's in-app notification state with the appropriate identity.",
    steps: [
      "A SERVER key or administrator with wallet.view can use GET /members/:id/balance and /members/:id/transactions. The explicit member ID is scoped to the authenticated program; balance returns the member's point wallets, not a single universal points number.",
      "An authenticated member uses GET /members/me/point-wallets or /members/me/credits for their wallets, and /members/me/transactions or /members/me/credits/transactions for history. /me always comes from the member session.",
      "Use GET /members/me/notifications with page and pageSize, then /members/me/notifications/unread-count. Mark one notification using PATCH /members/me/notifications/:id with {read: true}; {read: false} marks it unread again.",
      "POST /members/me/notifications/read-all marks the current member's notifications read. Each notification mutation requires that member's session, and the notification must belong to them.",
    ],
    notes: [
      "Member notification pageSize defaults to 20 and has a maximum of 50. Member and explicit-member transaction routes default to 20 with a maximum of 100; credits transaction routes default to 50. Check each route instead of applying one pagination setting globally.",
      "Admin notification activity and member notifications are different resources. A key cannot read /members/me/notifications by adding X-Program-Id; it has no member identity.",
      "Notification persistence, template/channel configuration, queue workers, and external delivery providers are separate from wallet correctness. Poll ledger state and inspect operational delivery state separately when needed.",
    ],
    codeSamples: [sample("wallet", "Read server and member resources"), sample("readNotification", "Mark the member's notification read")],
  },
  {
    id: "javascript",
    title: "12. Integrate with JavaScript fetch",
    purpose: "Keep privileged integration calls on the server and use sessions for customer-facing browser requests.",
    steps: [
      "On Node.js 18+, load the API key, program ID, member ID, and durable request ID from trusted configuration. Validate their presence before constructing a request; never compile server secrets into a frontend bundle.",
      "Serialize the JSON body with JSON.stringify, send the documented headers, and check response.ok before using body.data. Decode body.error.code for business handling instead of matching a translated message.",
      "Persist the original request ID and payload before a write. After a timeout retry only endpoints with verified deduplication support, using the same values and appropriate backoff.",
      "In a browser use the signed-in member's cookie with credentials: 'include', or an explicit member Bearer session when the client architecture requires it. If both admin and member cookies exist on the same host, use an explicit member Bearer session or end the admin session, because a valid admin cookie otherwise takes precedence. Browser calls still need the correct CORS origin and cookie policy.",
    ],
    notes: [
      "The server sample sends a real purchase event if executed with valid credentials. Start in the sandbox and review the configured earning rules before running it.",
      "Log only the route, status, error code, safe request IDs, and elapsed time. Avoid request headers, complete payloads, cookie values, member login responses, and provider credentials.",
    ],
    codeSamples: [sample("fetch", "Trusted server event request"), sample("browser", "Member browser notification request")],
  },
  {
    id: "headers-and-pagination",
    title: "13. Headers, response envelopes, and pagination",
    purpose: "Parse the actual response contract instead of assuming every endpoint has the same shape.",
    steps: [
      "Use Content-Type: application/json for JSON writes; send X-API-Key for server integration or Authorization: Bearer <memberSessionId> for a member. X-Program-Id is optional but must match an API key's program, and is required to select a program for public member password login.",
      "Send Idempotency-Key only as documented by the route. Use a unique, durable business request identifier; several financial routes require at least 8 characters.",
      "Most successful JSON responses wrap the result in data. Lists may return data as an array or as {items, total, page, pageSize, totalPages}; some routes return 204 with no body. Do not unconditionally call response.json() on a 204 response.",
      "GET /members uses page=1, pageSize=20 by default with max=100. GET /members/me/notifications uses page=1, pageSize=20 with max=50. Some configuration and approval routes return arrays and do not support page/pageSize at all.",
      "Stop a paginated scan according to that route's returned metadata. Offset pages are not a snapshot: new records or concurrent updates can shift results, so retain IDs and deduplicate during long scans.",
    ],
    notes: [
      "Accept-Language can localize messages in the global error handler, but custom route errors may have literal messages. Current browser CORS allowedHeaders lists Content-Type, Authorization, X-API-Key, X-Program-Id, and Idempotency-Key; non-safelisted additional headers may require deployment changes.",
      "The example envelope below illustrates GET /members, not every list endpoint. Read the endpoint catalog and the corresponding route for filters and route-specific shape.",
    ],
    codeSamples: [sample("pagination", "Example paginated members envelope")],
  },
  {
    id: "errors-and-limits",
    title: "14. Handle errors and rate limits",
    purpose: "Separate invalid credentials, denied operations, business conflicts, throttling, and transient failures.",
    steps: [
      "Errors normally use {error: {code, message, details?}}. Handle code and HTTP status; messages can be translated, literal, or fall back to the code. Zod validation errors use VALIDATION_ERROR (400) with structured details; general LoyaltyError parameters are not exposed as details.",
      "400 means malformed input or a missing required header; 401 means no valid credential or an expired/inactive key/session; 403 means scope, program, member state, capability, or reviewer access is denied. Correct the cause before retrying.",
      "404 means the resource cannot be found in the applicable context. 409 is a business or concurrency conflict, including event idempotency conflicts, an in-progress event, unconfigured workflows, or a completed approval. 422 can represent insufficient balance or other unmet business conditions.",
      "The global default is 1000 requests per minute, keyed by X-API-Key when that header is present and otherwise by IP. Stricter route limits apply: admin/member password login 5/min, /events 60/min, /credits/give 30/min, /credits/exchange 10/min, reward redemption 20/min, and coalition writes 30/min.",
      "On 429, honor Retry-After when available and use bounded backoff with jitter. For a timeout or 5xx, reconcile the outcome and retry only an idempotent operation with its original request ID. Do not blindly replay every POST.",
    ],
    notes: [
      "Rate-limit counters are process-local in the current configuration; they are not a guaranteed shared quota across multiple replicas. Some endpoints define their own rate-limit key (for example gift card validation).",
      "Generated Swagger and a route inventory do not replace endpoint-specific error handling. A response shape can vary between first execution, replay, approval state, and business rejection.",
    ],
    codeSamples: [sample("error", "Illustrative validation error envelope")],
  },
  {
    id: "idempotency-and-dates",
    title: "15. Idempotency, dates, and concurrent writes",
    purpose: "Prevent duplicate business effects while respecting each endpoint's actual deduplication behavior.",
    steps: [
      "Generate and persist one request ID per business operation before sending it. /events requires a nonempty Idempotency-Key and scopes it to the program; financial routes such as /credits/give, /credits/exchange, reward redemption, direct adjustments, and issuance proposals require a key of at least 8 characters.",
      "For /events, retries must preserve type, memberId, and payload; changed content returns 409. Other endpoints implement their own validation and replay behavior, so do not assume they all perform the same full-body conflict comparison or offer a common replay response.",
      "POST /members, ordinary configuration creation, and approval decisions are not made universally idempotent by adding this header. Approval decisions rely on workflow/decision protections; member creation requires application-level reconciliation after uncertain responses.",
      "Use ISO 8601 datetime strings with UTC Z where a route accepts dates, such as an issuance proposal's expiresAt. Date validation varies by schema; ensure startsAt precedes endsAt and use the program's configured business timezone for scheduled occasions.",
      "Read returned balances, transaction IDs, and workflow statuses after a write. A read followed by a separate write is not a reservation: balance, stock, budget, bank funds, and approval status can change concurrently.",
    ],
    notes: [
      "Idempotency is not a guarantee that every secondary effect is replay-safe: some direct adjustment handlers still audit and notify after the wallet service returns an existing transaction. Check ledger state and avoid needless repeated calls.",
      "Never use a new request ID merely because a timeout made the result uncertain. For a real new business operation, use a new ID. Keep IDs free of passwords, keys, session IDs, and unnecessary personal information.",
    ],
    codeSamples: [],
  },
  {
    id: "troubleshooting",
    title: "16. Troubleshoot and prepare for production",
    purpose: "Resolve integration failures using safe, specific checks before allowing production writes.",
    steps: [
      "If you receive HTML instead of JSON, verify the origin, published port, and /api/v1 prefix. If /docs renders the admin application, you are using the frontend proxy; Swagger needs backend access or an explicitly configured proxy route.",
      "For 401 verify the intended auth mode, key activity/expiry, member session, and cookie jar without printing credentials. For 403 compare the program, scope, actual actor, administrator capabilities, and reviewer assignment; /events needs a SERVER API_KEY actor, while proposals/decisions need adminId.",
      "For a member create validation failure, inspect required metadata fields and username/password rules. For a zero-point event, inspect active issuance rules, event definitions, amount, point types, date windows, segment eligibility, bank budgets, and configured approval behavior.",
      "For missing notifications, verify in-app state separately from delivery, then check active templates, member channel preferences, provider configuration, and worker status using the deployment owner's operational tools.",
      "Before production, verify separate environment secrets, a documented rotation owner, stable request IDs, bounded retries, safe logs, permission/approval behavior, timezone/date handling, and a small sandbox scenario from member creation through ledger and notification verification.",
    ],
    notes: [
      "Never put secrets into URLs, source control, shared documentation, support tickets, screenshots, browser bundles, or frontend environment variables. API keys, cookies, opaque session IDs, member credentials, webhook secrets, and provider credentials all require confidential handling.",
      "This guide describes current implemented routes. It does not create credentials, approve actions, configure a workflow, guarantee rewards, or make undocumented endpoints available.",
    ],
    codeSamples: [],
  },
];

const vietnameseGuide: ApiGuideSection[] = [
  {
    id: "environments",
    title: "1. Chọn môi trường và URL gốc của API",
    purpose: "Xác định đúng cơ sở dữ liệu và chương trình trước khi gửi yêu cầu. URL gốc trong mọi ví dụ kết thúc bằng /api/v1, không có dấu / cuối.",
    steps: [
      "Trang quản trị production: https://adminloyalty.trunglocxoay.store; sandbox: https://adminloyalty-sandbox.trunglocxoay.store. Thêm /api/v1 để gọi API. Trang khách hàng tương ứng là https://loyalty.trunglocxoay.store và https://loyalty-sandbox.trunglocxoay.store; proxy của các trang này cũng phục vụ /api/v1.",
      "Với tên miền riêng, dùng https://<tên-miền>/api/v1. Với bản cài HTTP thử nghiệm độc lập, dùng http://<máy-chủ>:<cổng-admin-hoặc-customer>/api/v1. Khi phát triển cục bộ có thể gọi trực tiếp cổng API đã cấu hình; proxy Vite của admin trỏ tới localhost:3002, nhưng .env.example đặt PORT_API=3000, nên phải kiểm tra cổng thực tế.",
      "Vào Admin → Cài đặt → Truy cập API để sao chép Program ID. Đây là mã định danh chương trình hiện tại, không phải bí mật và không tạo lại được. GET /admin/settings/api-access hoặc GET /admin/me cũng trả data.programId. Không lấy ID từ môi trường khác.",
      "Tách môi trường Postman, API key, phiên đăng nhập, member ID, point type ID và mã yêu cầu giữa production và sandbox. Thử tích hợp ở sandbox trước, rồi xác nhận lại đích đến trước mỗi thao tác ghi production.",
    ],
    notes: [
      "Sandbox có cơ sở dữ liệu và cấu hình riêng nhưng vẫn là bản triển khai thật: thao tác ghi tạo dữ liệu thật trong sandbox. Sandbox cũng chạy NODE_ENV=production và từ chối khóa seed công khai dùng khi phát triển.",
      "Các tệp ghi đè HTTP smoke test chỉ phục vụ kiểm thử độc lập, không dùng với dữ liệu production hay thông tin xác thực thật. Bản triển khai thực tế cần TLS.",
      "API dùng /api/v1; /healthz, /readyz, /metrics và /docs nằm ở gốc backend. Proxy admin hiện chỉ mở /api/ và /healthz. Không mặc định rằng /docs trên tên miền admin sẽ mở Swagger.",
    ],
    codeSamples: [sample("environment", "Kiểm tra loại điểm trong môi trường đã chọn")],
  },
  {
    id: "authentication",
    title: "2. Chọn API key, cookie admin hoặc phiên thành viên",
    purpose: "Thông tin xác thực quyết định chương trình và người thực hiện. Ba cách xác thực có quyền khác nhau và không thể thay thế lẫn nhau.",
    steps: [
      "Tích hợp máy chủ tin cậy: gửi X-API-Key. X-Program-Id không bắt buộc khi dùng API key; nếu có, phải khớp chính xác với chương trình của khóa, nếu không API trả 403. Khóa chỉ hợp lệ khi isActive=true và expiresAt chưa hết hạn.",
      "Ứng dụng admin: POST /admin/login với JSON {email, password}. API thiết lập cookie HttpOnly loyaltyos_admin_session; các yêu cầu admin tiếp theo dùng cookie này và quyền được cấu hình cho tài khoản. Kết quả đăng nhập không phải API key hay admin bearer token.",
      "Ứng dụng khách hàng: POST /auth/login với {username, password} và X-Program-Id (hoặc ?programId=...). API thiết lập loyaltyos_session và trả data.sessionId, data.expiresAt, data.member. Dùng Authorization: Bearer <sessionId> hoặc cookie thành viên.",
      "Mỗi client nên dùng một danh tính rõ ràng. Bearer thành viên hợp lệ được ưu tiên trước cookie admin; sau đó API kiểm tra cookie admin, cookie thành viên rồi X-API-Key. Trộn cookie và khóa có thể khiến yêu cầu chạy dưới danh tính khác với dự kiến.",
    ],
    notes: [
      "Bearer thành viên là mã phiên Lucia dạng opaque, không phải JWT. Phiên admin được cấu hình 8 giờ, phiên thành viên 30 ngày; đăng xuất hoặc thu hồi có thể làm phiên mất hiệu lực sớm hơn.",
      "Khóa SERVER bỏ qua kiểm tra capability của admin và có quyền rất rộng trong chương trình. Một số endpoint vẫn bắt buộc danh tính admin hoặc thành viên thật. CLIENT là phạm vi khóa hạn chế, không phải tài khoản thành viên: không thiết lập request.memberId và không đọc được /members/me.",
      "Chỉ lưu khóa SERVER trong dịch vụ máy chủ tin cậy. Quyền truy cập vẫn do luồng xác thực và từng route quyết định; tên route hay chú thích public trong gói không thay thế hợp đồng API đang triển khai.",
    ],
    codeSamples: [],
  },
  {
    id: "create-key",
    title: "3. Lấy và tạo API key",
    purpose: "Tạo, xem thông tin và thu hồi khóa tích hợp tại Admin → Cài đặt → Truy cập API. Chủ triển khai cũng có thể dùng công cụ quản trị máy chủ.",
    steps: [
      "Mở Cài đặt, xác nhận môi trường rồi sao chép Program ID và URL API. Xem thông tin này cần settings.view; xem danh sách khóa cần api_key.view hoặc api_key.manage; tạo/thu hồi cần api_key.manage. Mặc định chỉ Owner có quyền quản lý khóa, vai trò khác cần được cấp rõ ràng.",
      "Chọn Tạo khóa API, nhập tên tích hợp, chọn CLIENT hoặc SERVER và hạn dùng. Mặc định CLIENT và 90 ngày; chỉ chọn SERVER cho máy chủ tin cậy vì khóa này bỏ qua phân quyền vai trò admin. Hạn dùng cho phép 1–3650 ngày hoặc chọn rõ Không hết hạn.",
      "Sao chép mã bí mật mới riêng tư một lần rồi lưu vào kho bí mật của dịch vụ. Đóng thông báo hoặc rời Cài đặt sẽ xóa mã khỏi màn hình. Danh sách chỉ hiển thị thông tin khóa, không lấy lại mã cũ; nếu mất mã, tạo khóa thay thế rồi thu hồi khóa trước.",
      "Quản lý qua REST cần phiên admin thật: GET /admin/settings/api-keys trả danh sách thông tin, POST cùng đường dẫn với {name, scope, expiresInDays} trả {data: {key, secret}}, DELETE /admin/settings/api-keys/:id thu hồi khóa đó. expiresInDays mặc định 90 hoặc null để không hết hạn. Khóa SERVER không được quản lý khóa; phải dùng cookie admin.",
    ],
    notes: [
      "Công cụ kết nối cơ sở dữ liệu do DATABASE_URL chọn. --environment phải khớp cấu hình triển khai; đây là kiểm tra bổ sung, không tự bảo đảm URL cơ sở dữ liệu trỏ đúng máy chủ. Xác nhận bản triển khai trước khi chạy.",
      "Dùng --environment production cho production, sandbox cho bản Compose sandbox, development cho máy cục bộ. Ví dụ bên dưới chủ động chọn sandbox; không chép nguyên vào quy trình production.",
      "Khóa mới chỉ lưu mã băm SHA-256. Khóa cũ vẫn tương thích đến khi được thay thế; hạn chế quyền truy cập cơ sở dữ liệu và bản sao lưu. API_KEY_SALT là cấu hình nội bộ, không phải API key để gọi API và không hiển thị trong Cài đặt.",
      "Image đã dựng trước khi thêm công cụ sẽ chưa chứa công cụ; chủ triển khai cần triển khai image có công cụ trước khi dùng lệnh container. Xem tài liệu không tự tạo khóa hay triển khai hệ thống.",
    ],
    codeSamples: [sample("provision", "Chỉ chủ triển khai chạy; chỉ ghi dữ liệu khi chủ động thực thi")],
  },
  {
    id: "rotate-key",
    title: "4. Đổi, thu hồi và khôi phục quyền truy cập bằng khóa",
    purpose: "Thay thông tin xác thực mà không ngắt tích hợp, rồi vô hiệu hóa đúng khóa cũ khi không còn cần.",
    steps: [
      "Trong Cài đặt → Truy cập API, xác định khóa cũ qua tên, phạm vi, hạn dùng, lần dùng cuối và trạng thái. Không thể lấy lại mã bí mật cũ; mất mã thì tạo khóa thay thế.",
      "Tạo khóa thay thế đúng chương trình và phạm vi. Lưu an toàn, thử một yêu cầu đọc, đổi cấu hình dịch vụ rồi xác nhận yêu cầu đơn giản thành công bằng khóa mới.",
      "Chọn Thu hồi tại đúng khóa cũ trong Cài đặt rồi xác nhận. DELETE /admin/settings/api-keys/:id hoặc --key-id chính xác trong công cụ cũng vô hiệu khóa đúng chương trình: đặt isActive=false, giữ thông tin và từ chối xác thực bằng khóa đó.",
      "Nếu nghi lộ khóa, thu hồi khóa liên quan ngay và nhờ chủ triển khai cấp lại. Gỡ khóa khỏi các đầu ra đã chia sẻ và xem audit liên quan mà không chép lại bí mật.",
    ],
    notes: [
      "Đổi hạn dùng hay xin khóa mới không thay đổi bí mật của bản ghi cũ. Công cụ chỉ hỗ trợ create, list và revoke đúng ID; không có thu hồi hàng loạt, xuất bí mật hay lấy lại bí mật.",
      "Chỉ giữ thời gian chồng lấp hai khóa khi đổi khóa theo kế hoạch. Khóa hết hạn hoặc bị vô hiệu trả 401; X-Program-Id của chương trình khác trả 403.",
    ],
    codeSamples: [sample("rotate", "Vô hiệu hóa chính xác khóa cũ")],
  },
  {
    id: "admin-session",
    title: "5. Đăng nhập quản trị viên",
    purpose: "Dùng phiên admin cho thao tác cần quản trị viên cụ thể, gồm đề xuất cấp điểm và quyết định phê duyệt.",
    steps: [
      "Nạp email và mật khẩu thật của quản trị viên vào ngữ cảnh cục bộ được bảo vệ. POST /admin/login dùng trường password, không phải pass hay secret, và yêu cầu tài khoản admin đang hoạt động.",
      "Giữ Set-Cookie bằng cookie jar của Postman, tệp cookie curl được bảo vệ, hoặc fetch có credentials: 'include'. GET /admin/me xác nhận chương trình, vai trò và capability hiện tại.",
      "Tuân thủ quyền từng endpoint. GET /admin/approvals/inbox cần approval.inbox; route quyết định cần approval.decide và được chỉ định tại bước hiện tại của workflow.",
      "POST /admin/logout vô hiệu phiên và xóa cookie. Xóa tệp cookie tạm khi không còn dùng phiên.",
    ],
    notes: [
      "Đăng nhập mật khẩu giới hạn 5 yêu cầu/phút. Đăng nhập Microsoft là luồng OIDC bổ sung qua trình duyệt khi được cấu hình; tài khoản admin Microsoft mới cần được kích hoạt trước khi truy cập.",
      "Bảo mật cookie phụ thuộc TLS và cấu hình triển khai. Trình duyệt khác origin cần CORS cho phép và thỏa chính sách SameSite. Không giảm bảo vệ cookie chỉ để chạy ví dụ tích hợp.",
    ],
    codeSamples: [sample("adminLogin", "Đăng nhập admin và xác nhận phiên bằng curl")],
  },
  {
    id: "member-session",
    title: "6. Đăng nhập thành viên",
    purpose: "Đọc hồ sơ, ví, lịch sử và thông báo của khách hàng bằng danh tính của chính họ.",
    steps: [
      "Quản trị viên có quyền cần cấp username và password cho thành viên trước. Tạo thành viên chỉ có email hoặc externalId không tự làm tài khoản đăng nhập mật khẩu hoạt động.",
      "POST /auth/login với {username, password} và program ID. Xem data.sessionId là bí mật xác thực và dùng Authorization: Bearer <sessionId> cho API thành viên; trình duyệt có thể dùng cookie HttpOnly loyaltyos_session.",
      "Gọi GET /members/me hoặc /auth/me để xác nhận danh tính. Thành viên inactive bị từ chối; API key, kể cả SERVER, không thay phiên thành viên cho các endpoint /members/me.",
      "POST /auth/logout với cùng phiên để vô hiệu hóa và xóa cookie. GET /auth/methods?programId=... cho biết chương trình có cấu hình đăng nhập Microsoft hay không.",
    ],
    notes: [
      "Đăng nhập mật khẩu khách hàng giới hạn 5 yêu cầu/phút. Các route magic link còn để tương thích, nhưng luồng khách hàng hiện dùng username/password hoặc Microsoft đã được cấu hình.",
      "Kết quả đăng nhập chứa bí mật phiên. Không đưa vào log, ảnh chụp, tệp Postman chia sẻ, URL, analytics hay bộ nhớ trình duyệt lưu dài hạn.",
    ],
    codeSamples: [sample("memberLogin", "Đăng nhập thành viên và dùng phiên Bearer")],
  },
  {
    id: "postman",
    title: "7. Thiết lập và kiểm thử bằng Postman",
    purpose: "Giữ rõ môi trường và thông tin xác thực khi thử hợp đồng API thực tế.",
    steps: [
      "Tạo môi trường production và sandbox riêng với API_BASE_URL, PROGRAM_ID, MEMBER_ID, POINT_TYPE_ID và mã yêu cầu nghiệp vụ. API_BASE_URL đã bao gồm /api/v1. Lưu API_KEY, mật khẩu và mã phiên trong vault riêng hoặc biến riêng không đồng bộ.",
      "Yêu cầu máy chủ cần X-API-Key: {{API_KEY}}, X-Program-Id: {{PROGRAM_ID}} nếu dùng và phải khớp, Content-Type: application/json khi gửi JSON. Chọn No Auth nếu tự nhập header; không thêm Bearer đồng thời.",
      "Bắt đầu với GET {{API_BASE_URL}}/point-types rồi GET /members?page=1&pageSize=20 bằng khóa SERVER. Xác nhận chương trình và các ID trước khi gửi thao tác ghi.",
      "Với endpoint thành viên, POST /auth/login trước rồi dùng sessionId làm Bearer hoặc cookie thành viên đúng. Với workflow admin, dùng /admin/login và cookie admin. Xóa cookie không liên quan khi đổi danh tính.",
      "Với POST /events, tạo EVENT_REQUEST_ID một lần cho sự kiện nghiệp vụ, dùng body raw JSON rồi giữ nguyên ID và payload khi thử lại. Không sinh ID mới mỗi lần nhấn Send.",
    ],
    notes: [
      "JSON bên dưới mô tả một yêu cầu Postman, không phải tệp collection nhập trực tiếp. Thay biến bằng giá trị của môi trường đã chọn và kiểm tra cả HTTP status lẫn body.",
      "Danh mục Developer liệt kê route. Swagger backend đăng ký ở /docs khi có truy cập backend hoặc proxy được cấu hình rõ; Swagger và /docs/json cũng yêu cầu xác thực hợp lệ. Nhiều schema được phân tích bằng Zod trong handler nên OpenAPI sinh tự động không mô tả đầy đủ mọi body và phản hồi.",
    ],
    codeSamples: [sample("postman", "Yêu cầu Postman: sự kiện mua hàng tin cậy")],
  },
  {
    id: "register-member",
    title: "8. Đăng ký và tìm thành viên",
    purpose: "Tạo thành viên bằng tích hợp được cấp quyền và giữ member ID do máy chủ trả về để gửi sự kiện sau này.",
    steps: [
      "POST /members cần capability member.manage hoặc khóa SERVER tin cậy. Các trường gồm externalId, email, phone, firstName, lastName, department, photoUrl, metadata, tags, username, password. Chỉ gửi dữ liệu tích hợp thực sự cần.",
      "Nếu chương trình cấu hình trường thành viên bắt buộc, gửi giá trị đúng trong metadata. Khóa không biết, trường đã archive, thiếu trường bắt buộc hoặc sai kiểu đều bị từ chối; ví dụ tối thiểu có thể chưa đủ với cấu hình của bạn.",
      "Tạo thành công trả HTTP 201 và {data: member}; lưu data.id làm MEMBER_ID. Cấp username/password cần thêm member.credentials.manage; có password thì phải có username. Mật khẩu thành viên khi tạo phải dài 10–1024 ký tự.",
      "GET /members hỗ trợ page, pageSize, search, department, status để tìm bản ghi có sẵn. Mặc định chỉ lấy thành viên active chưa xóa; page bắt đầu từ 1, pageSize mặc định 20 và tối đa 100.",
    ],
    notes: [
      "POST /members không xử lý Idempotency-Key. Lưu ID tạo thành công, đối chiếu sau timeout chưa rõ kết quả và dùng ánh xạ định danh ngoài bền vững trước khi thử tạo lại; thêm header không tự ngăn thành viên trùng.",
      "Tạo thành viên lên lịch cấp onboarding theo cấu hình một cách bất đồng bộ. Không mặc định gửi thêm registration event: kiểm tra quy tắc onboarding/sự kiện trước để tránh thưởng hai lần. Tạo thành viên và tiếp nhận sự kiện là hai thao tác riêng.",
      "Dùng dữ liệu thử tổng hợp được phép trong sandbox. Email, số điện thoại, hồ sơ và metadata thành viên là dữ liệu cá nhân.",
    ],
    codeSamples: [sample("createMember", "Tạo và liệt kê thành viên")],
  },
  {
    id: "events-and-earn",
    title: "9. Kích hoạt sự kiện và hiểu cách cộng điểm",
    purpose: "Báo hoạt động nghiệp vụ bên ngoài đáng tin cậy để quy tắc cấp điểm và chiến dịch đã cấu hình xử lý.",
    steps: [
      "POST /events bắt buộc API key SERVER: cookie quản trị viên không đủ. Gửi Idempotency-Key và body có type, memberId tùy chọn, payload tùy chọn. Phải có memberId nếu muốn hoạt động cộng điểm cho thành viên.",
      "Mua hàng dùng type: 'purchase' và payload.amount làm cơ sở của quy tắc. Đưa mã đơn hàng ổn định vào payload. Điểm từ purchase rule bằng floor(payload.amount × rule.multiplier); không có rule thì không bảo đảm được cộng điểm.",
      "Với sự kiện khác purchase, ví dụ registration, phải có định nghĩa sự kiện active trong cùng chương trình. Sự kiện ngoài không được gửi vào chế độ tự động theo lịch. Định nghĩa cần approval sẽ không trực tiếp kích hoạt rule cấp tự động.",
      "Lần đầu xử lý sự kiện có thành viên, xem data.event, data.earnResult, data.earnResults, data.appliedCampaigns. Gửi lại sự kiện đã hoàn tất trả bản ghi event trong data cùng idempotent: true, vì vậy hình dạng phản hồi khác lần đầu.",
      "Kiểm tra ví và lịch sử giao dịch sau xử lý. Chiến dịch, segment, trạng thái loại điểm, thời gian hiệu lực, ngân sách, số dư ngân hàng và approval quyết định kết quả thật; API nhận sự kiện không bảo đảm số điểm cố định hay thông báo đã được gửi đến người nhận.",
    ],
    notes: [
      "Tiếp nhận sự kiện giới hạn 60 yêu cầu/phút. Cùng chương trình và mã idempotency xác định sự kiện nghiệp vụ; đổi type, memberId hoặc nội dung payload chuẩn hóa với cùng Idempotency-Key trả EVENT_IDEMPOTENCY_CONFLICT (409).",
      "EVENT_PROCESSING (409) nghĩa là đang có quyền xử lý tạm thời; thử lại có trì hoãn với key và payload cũ. Quyền xử lý tạm thời kéo dài 10 phút. Sau lỗi có thể tiếp tục với key này; tạo key mới có thể nhân đôi tác động nghiệp vụ.",
      "Không có endpoint POST /earn chung. Tích hợp tin cậy gửi sự kiện và quy tắc cấp điểm tạo luồng cộng điểm tự động. Điều chỉnh sổ điểm thủ công là thao tác đặc quyền riêng, không thay quy trình phê duyệt.",
      "Sự kiện có thể tạo điểm, chạy chiến dịch, xét hạng/huy hiệu và xếp hàng thông báo. Một phần là best effort hoặc bất đồng bộ; HTTP thành công không chứng minh email/SMS/push đã đến người nhận.",
    ],
    codeSamples: [sample("event", "Gửi sự kiện và kiểm tra kết quả")],
  },
  {
    id: "issuance-and-approval",
    title: "10. Cấp điểm qua workflow phê duyệt đã cấu hình",
    purpose: "Dùng đường phê duyệt có người tham gia khi khoản cấp điểm cần được đề xuất và quản trị viên được chỉ định duyệt.",
    steps: [
      "Admin có wallet.adjust gửi /admin/issuance-proposals bằng cookie của mình, Idempotency-Key ít nhất 8 ký tự và {memberId, pointTypeId, amount, reason}. Amount là số nguyên dương; expiresAt là datetime ISO tùy chọn.",
      "Thành viên và loại điểm phải active trong cùng chương trình. Phải có workflow POINT_ISSUANCE_PROPOSAL phù hợp; nếu không, route trả POINT_ISSUANCE_WORKFLOW_NOT_CONFIGURED (409).",
      "Lưu ID yêu cầu phê duyệt trả về. Tạo đề xuất trả bản ghi approval, chưa tăng số dư ngay. Người duyệt được chỉ định dùng phiên riêng xem /admin/approvals/inbox và /admin/approvals/:id rồi quyết định bằng POST /admin/approvals/:id/approve hoặc /reject.",
      "Body duyệt nhận comment tùy chọn; từ chối bắt buộc comment không rỗng. Thứ tự bước, chỉ định người duyệt, giới hạn người đề xuất, quyết định trùng và trạng thái được kiểm tra. Đọc trạng thái cuối cùng và xác nhận giao dịch sổ điểm trước khi xem là hoàn tất.",
    ],
    notes: [
      "Khóa SERVER không gửi được đề xuất hay quyết định approval vì các route yêu cầu danh tính admin thật. Không dùng cookie của người khác hoặc dùng điều chỉnh trực tiếp để bỏ qua phê duyệt.",
      "POST /admin/credits/adjust và /admin/point-types/:id/adjust là thao tác sổ điểm trực tiếp riêng, cần wallet.adjust. Chúng yêu cầu Idempotency-Key, amount nguyên khác 0, reason, và allowManualAdjustment được bật; ràng buộc ngân hàng và số dư vẫn áp dụng. Chúng không tạo đề xuất cấp điểm.",
      "Giữ nguyên request ID của đề xuất khi thử lại. Route quyết định dùng bảo vệ trạng thái/quyết định của workflow, không phải cơ chế Idempotency-Key chung; lặp quyết định đã hoàn tất có thể trả 409.",
    ],
    codeSamples: [sample("proposal", "Gửi đề xuất và xem bằng phiên người được chỉ định duyệt")],
  },
  {
    id: "wallets-and-notifications",
    title: "11. Đọc ví, lịch sử và thông báo",
    purpose: "Xác nhận kết quả sổ điểm và lấy trạng thái thông báo trong ứng dụng bằng đúng danh tính.",
    steps: [
      "Khóa SERVER hoặc admin có wallet.view dùng GET /members/:id/balance và /members/:id/transactions. Member ID rõ ràng được giới hạn theo chương trình đang xác thực; balance trả các ví loại điểm, không phải một số điểm tổng dùng cho mọi loại.",
      "Thành viên đã đăng nhập dùng GET /members/me/point-wallets hoặc /members/me/credits để xem ví; dùng /members/me/transactions hoặc /members/me/credits/transactions để xem lịch sử. /me luôn lấy từ phiên thành viên.",
      "GET /members/me/notifications nhận page, pageSize; /members/me/notifications/unread-count trả số chưa đọc. Đánh dấu một thông báo bằng PATCH /members/me/notifications/:id với {read: true}; {read: false} chuyển lại chưa đọc.",
      "POST /members/me/notifications/read-all đánh dấu đã đọc cho thành viên hiện tại. Mỗi thao tác sửa thông báo cần phiên của thành viên đó và thông báo phải thuộc họ.",
    ],
    notes: [
      "Thông báo thành viên có pageSize mặc định 20, tối đa 50. Route giao dịch thành viên và theo member ID mặc định 20, tối đa 100; route giao dịch credits mặc định 50. Kiểm tra từng route thay vì dùng một quy tắc phân trang chung.",
      "Thông báo hoạt động admin và thông báo thành viên là tài nguyên khác nhau. Thêm X-Program-Id không giúp khóa đọc /members/me/notifications vì khóa không có danh tính thành viên.",
      "Lưu thông báo, template/kênh, worker hàng đợi và nhà cung cấp gửi ngoài tách biệt với tính đúng của ví. Khi cần, kiểm tra sổ điểm và trạng thái gửi thông báo riêng.",
    ],
    codeSamples: [sample("wallet", "Đọc tài nguyên máy chủ và thành viên"), sample("readNotification", "Đánh dấu thông báo của thành viên đã đọc")],
  },
  {
    id: "javascript",
    title: "12. Tích hợp JavaScript fetch",
    purpose: "Đặt cuộc gọi đặc quyền ở máy chủ và dùng phiên cho yêu cầu trình duyệt của khách hàng.",
    steps: [
      "Với Node.js 18+, nạp API key, program ID, member ID và request ID bền vững từ cấu hình tin cậy. Kiểm tra biến đã có trước khi tạo yêu cầu; không đưa bí mật máy chủ vào bundle frontend.",
      "Chuyển body bằng JSON.stringify, gửi header đúng và kiểm tra response.ok trước khi dùng body.data. Xử lý nghiệp vụ theo body.error.code thay vì so sánh thông báo đã dịch.",
      "Lưu ID và payload gốc trước thao tác ghi. Sau timeout chỉ thử lại route có chống trùng đã kiểm chứng, giữ nguyên giá trị và dùng backoff phù hợp.",
      "Trình duyệt dùng cookie thành viên đã đăng nhập với credentials: 'include', hoặc Bearer phiên thành viên rõ ràng khi kiến trúc yêu cầu. Nếu cùng máy chủ có cả cookie admin và thành viên, dùng Bearer thành viên rõ ràng hoặc đăng xuất admin vì cookie admin hợp lệ được ưu tiên. CORS origin và chính sách cookie vẫn phải phù hợp.",
    ],
    notes: [
      "Ví dụ máy chủ sẽ gửi sự kiện purchase thật nếu chạy với thông tin hợp lệ. Bắt đầu bằng sandbox và xem rule cộng điểm trước khi chạy.",
      "Chỉ log route, status, error code, request ID an toàn và thời gian. Tránh header xác thực, toàn bộ payload, cookie, kết quả đăng nhập thành viên và bí mật nhà cung cấp.",
    ],
    codeSamples: [sample("fetch", "Máy chủ tin cậy gửi sự kiện"), sample("browser", "Trình duyệt thành viên đọc thông báo")],
  },
  {
    id: "headers-and-pagination",
    title: "13. Header, lớp bọc phản hồi và phân trang",
    purpose: "Đọc đúng hợp đồng phản hồi của từng endpoint thay vì giả định tất cả giống nhau.",
    steps: [
      "Ghi JSON dùng Content-Type: application/json; tích hợp máy chủ gửi X-API-Key hoặc thành viên gửi Authorization: Bearer <memberSessionId>. X-Program-Id không bắt buộc nhưng phải khớp chương trình của API key; đăng nhập mật khẩu thành viên công khai cần chọn chương trình.",
      "Gửi Idempotency-Key theo tài liệu từng route. Dùng mã yêu cầu nghiệp vụ duy nhất, bền vững; nhiều route tài chính yêu cầu ít nhất 8 ký tự.",
      "Phần lớn JSON thành công bọc kết quả trong data. Danh sách có thể là mảng hoặc {items, total, page, pageSize, totalPages}; có route trả 204 không body. Không gọi response.json() vô điều kiện với phản hồi 204.",
      "GET /members mặc định page=1, pageSize=20, tối đa 100. GET /members/me/notifications mặc định page=1, pageSize=20, tối đa 50. Một số route cấu hình và approval trả mảng, không hỗ trợ page/pageSize.",
      "Dừng quét phân trang theo metadata của route. Phân trang offset không phải ảnh chụp dữ liệu cố định: bản ghi mới hoặc cập nhật đồng thời có thể làm trang dịch chuyển; giữ ID và loại trùng khi quét dài.",
    ],
    notes: [
      "Accept-Language có thể dịch thông báo của error handler chung, nhưng lỗi tự trả trong route có thể dùng thông báo cố định. CORS allowedHeaders hiện gồm Content-Type, Authorization, X-API-Key, X-Program-Id, Idempotency-Key; thêm header không thuộc safelist có thể cần thay cấu hình triển khai.",
      "Ví dụ lớp bọc dưới đây minh họa GET /members, không phải mọi danh sách. Xem danh mục endpoint và route tương ứng để biết bộ lọc và cấu trúc cụ thể.",
    ],
    codeSamples: [sample("pagination", "Ví dụ lớp bọc danh sách thành viên có phân trang")],
  },
  {
    id: "errors-and-limits",
    title: "14. Xử lý lỗi và giới hạn tốc độ",
    purpose: "Phân biệt sai xác thực, bị từ chối quyền, xung đột nghiệp vụ, giới hạn tốc độ và lỗi tạm thời.",
    steps: [
      "Lỗi thường có {error: {code, message, details?}}. Dùng code và HTTP status; message có thể được dịch, cố định hoặc bằng code. Lỗi Zod là VALIDATION_ERROR (400) kèm details có cấu trúc; tham số LoyaltyError chung không tự công khai thành details.",
      "400 là input sai hoặc thiếu header; 401 là không có xác thực hợp lệ hoặc khóa/phiên hết hạn, bị vô hiệu; 403 là sai scope/chương trình, trạng thái thành viên, capability hoặc quyền người duyệt. Sửa nguyên nhân trước khi thử lại.",
      "404 nghĩa là không tìm thấy tài nguyên trong ngữ cảnh tương ứng. 409 là xung đột nghiệp vụ/đồng thời, gồm đổi nội dung cùng idempotency key, sự kiện đang xử lý, thiếu workflow hoặc approval đã hoàn tất. 422 có thể là thiếu số dư hay điều kiện nghiệp vụ chưa thỏa.",
      "Mặc định chung là 1000 yêu cầu/phút, theo X-API-Key khi có header này, nếu không theo IP. Route có mức chặt hơn: đăng nhập admin/thành viên 5/phút, /events 60/phút, /credits/give 30/phút, /credits/exchange 10/phút, đổi reward 20/phút, thao tác ghi coalition 30/phút.",
      "Khi 429, tuân thủ Retry-After nếu có và dùng backoff hữu hạn có jitter. Khi timeout hay 5xx, đối chiếu kết quả và chỉ thử lại thao tác idempotent bằng mã gốc. Không tự gửi lại mọi POST.",
    ],
    notes: [
      "Bộ đếm giới hạn hiện nằm trong từng tiến trình; không phải hạn mức chia sẻ bảo đảm giữa nhiều replica. Một số route tự định nghĩa khóa đếm, ví dụ kiểm tra gift card.",
      "Swagger sinh tự động và danh mục route không thay xử lý lỗi từng endpoint. Cấu trúc phản hồi có thể khác giữa lần đầu, gửi lại, trạng thái approval và lỗi nghiệp vụ.",
    ],
    codeSamples: [sample("error", "Minh họa lớp bọc lỗi kiểm tra dữ liệu")],
  },
  {
    id: "idempotency-and-dates",
    title: "15. Chống trùng, thời gian và ghi đồng thời",
    purpose: "Tránh tác động nghiệp vụ lặp mà vẫn tuân thủ cơ chế chống trùng thật của từng endpoint.",
    steps: [
      "Sinh và lưu một request ID cho mỗi nghiệp vụ trước khi gửi. /events cần Idempotency-Key không rỗng và giới hạn trong chương trình; /credits/give, /credits/exchange, đổi reward, điều chỉnh trực tiếp và đề xuất cấp điểm yêu cầu ít nhất 8 ký tự.",
      "Với /events, gửi lại phải giữ type, memberId, payload; đổi nội dung trả 409. Endpoint khác có kiểm tra và phản hồi gửi lại riêng; không mặc định mọi route đều so sánh toàn body hoặc trả cấu trúc replay chung.",
      "POST /members, tạo cấu hình thông thường và quyết định approval không tự idempotent chỉ nhờ header này. Quyết định approval dựa vào bảo vệ workflow/quyết định; tạo thành viên cần đối chiếu ở ứng dụng sau phản hồi không rõ kết quả.",
      "Dùng datetime ISO 8601 với UTC Z khi route nhận thời gian, ví dụ expiresAt của đề xuất cấp điểm. Kiểm tra ngày khác nhau theo schema; đảm bảo startsAt trước endsAt và dùng múi giờ nghiệp vụ đã cấu hình cho sự kiện theo lịch.",
      "Đọc số dư, transaction ID và trạng thái workflow sau thao tác ghi. Đọc rồi ghi riêng không phải giữ chỗ: số dư, tồn kho, ngân sách, tiền ngân hàng và trạng thái approval có thể thay đổi đồng thời.",
    ],
    notes: [
      "Idempotency không bảo đảm mọi tác động phụ đều an toàn khi lặp: một số handler điều chỉnh vẫn ghi audit và gửi thông báo sau khi wallet service trả giao dịch cũ. Kiểm tra sổ điểm và tránh gọi lặp không cần thiết.",
      "Không tạo request ID mới chỉ vì timeout làm kết quả chưa rõ. Nghiệp vụ mới thực sự cần ID mới. Không đặt mật khẩu, API key, mã phiên hay dữ liệu cá nhân không cần thiết trong ID.",
    ],
    codeSamples: [],
  },
  {
    id: "troubleshooting",
    title: "16. Gỡ lỗi và chuẩn bị production",
    purpose: "Giải quyết lỗi bằng kiểm tra cụ thể, an toàn trước khi cho phép tích hợp ghi production.",
    steps: [
      "Nếu nhận HTML thay JSON, kiểm tra origin, cổng công khai và tiền tố /api/v1. Nếu /docs mở ứng dụng admin thì bạn đang gọi proxy frontend; Swagger cần đường backend hoặc proxy được cấu hình riêng.",
      "Với 401, kiểm tra cách xác thực, isActive/expiry của khóa, phiên thành viên và cookie jar mà không in bí mật. Với 403, so sánh chương trình, scope, danh tính thực, quyền admin và chỉ định người duyệt; /events cần SERVER API_KEY, còn đề xuất/quyết định cần adminId.",
      "Lỗi tạo thành viên: xem metadata bắt buộc và quy tắc username/password. Sự kiện không cộng điểm: xem rule active, định nghĩa sự kiện, amount, loại điểm, thời gian hiệu lực, segment, ngân sách ngân hàng và cơ chế approval.",
      "Thiếu thông báo: kiểm tra thông báo trong ứng dụng riêng với trạng thái gửi, sau đó xem template active, tùy chọn kênh của thành viên, cấu hình nhà cung cấp và worker bằng công cụ vận hành của chủ triển khai.",
      "Trước production, xác nhận bí mật tách môi trường, người phụ trách đổi khóa, request ID ổn định, retry hữu hạn, log an toàn, quyền/approval, thời gian/múi giờ và một kịch bản sandbox nhỏ từ tạo thành viên đến kiểm tra sổ điểm và thông báo.",
    ],
    notes: [
      "Không đưa bí mật vào URL, source control, tài liệu chung, ticket hỗ trợ, ảnh chụp, bundle trình duyệt hay biến frontend. API key, cookie, mã phiên opaque, mật khẩu thành viên, webhook secret và khóa nhà cung cấp đều phải được giữ kín.",
      "Hướng dẫn mô tả route đã triển khai trong mã hiện tại. Nó không tự tạo thông tin xác thực, duyệt thao tác, cấu hình workflow, bảo đảm thưởng hay mở endpoint chưa được hỗ trợ.",
    ],
    codeSamples: [],
  },
];

export function getDeveloperApiGuide(locale: ApiGuideLocale): ApiGuideSection[] {
  return locale === "vi" ? vietnameseGuide : englishGuide;
}
