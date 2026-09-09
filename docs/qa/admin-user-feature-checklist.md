# LoyaltyOS Admin + Portal/User QA Checklist

## Test record

- Date: 2026-09-09
- Branch/commit under test: `main` / `e99f6d0` + QA verification changes in working tree
- API: `http://127.0.0.1:3002` inside Docker, public `https://adminloyalty.trunglocxoay.store/api/v1` and `https://loyalty.trunglocxoay.store/api/v1`
- Admin UI: `http://127.0.0.1:5173`
- Portal UI: `http://127.0.0.1:5174`
- Database migrations: verify the latest applied migration before starting a destructive test
- Status: `PASS` = verified by an automated/smoke test, `MANUAL` = requires an authenticated browser session, `BLOCKED` = test data or external integration is unavailable, `FAIL` = a reproducible defect remains

## Automated baseline

- [x] `PASS` Run all repository unit/integration tests (direct package runners; `turbo test` is unavailable because the host has no pnpm binary)
- [x] `PASS` Run API, Admin and Portal TypeScript checks
- [x] `PASS` Build API, Admin and Portal production bundles
- [x] `PASS` Run lint for API, Admin and Portal
- [x] `PASS` Run Prettier check and `git diff --check`
- [x] `PASS` Verify `/healthz` and `/readyz`
- [x] `PASS` Verify API/Admin/Portal containers are healthy
- [x] `PASS` Verify latest Prisma migrations are applied (`20260909103000_accounting_exchange_vouchers`)
- [ ] `FAIL` Verify no 5xx responses in the smoke-test window; one known failure remains at `/api/v1/admin/coalition/capabilities` (QA-003)

### Executed automated and smoke-test results

- API integration: **100 tests passed** across 10 files on an isolated PostgreSQL QA database; all 20 migrations applied, then the QA database was removed.
- Admin application tests: **15 passed**.
- Portal application tests: **19 passed**.
- Workspace package tests: **459 passed** across badges, campaigns, coalition, core, coupons, gift cards, i18n, notifications, rewards, segments and telemetry.
- Total recorded automated tests: **593 passed**.
- TypeScript checks passed for API, Admin, Portal and all tested packages.
- Production builds passed for API, Admin and Portal. Admin reports only the existing large-bundle warning (>500 kB).
- Read-only API smoke passed for health, auth context, dashboard, members, credits, point types, campaigns, coupons, segments, badges, tiers, rewards, gift cards, coalition lists/configuration and notifications.
- Authenticated temporary member session smoke passed for member profile, balances, wallets, credits, transactions, recognition feed, redemptions, badges, tier, notifications, preferences, point types, reward categories and logout. The temporary session was removed by logout.
- Admin and Portal SPA fallback smoke passed for all listed routes, including login, create/edit routes and a missing Portal reward route.
- Production containers after rebuild: API, Admin, Portal, PostgreSQL and Redis healthy.
- The full interactive browser checklist below remains `MANUAL`; this environment did not provide browser automation for authenticated click-through, visual tooltip placement, responsive layout or keyboard behavior.

## Admin browser checklist

### Authentication, navigation and permissions

- [ ] `MANUAL` Admin login with valid credentials
- [ ] `MANUAL` Invalid login shows a safe error and does not reveal whether an email exists
- [ ] `MANUAL` Session restoration after refresh
- [ ] `MANUAL` Logout invalidates the session
- [ ] `MANUAL` Navigation only shows capabilities granted to the current role
- [ ] `MANUAL` Dashboard, Members, Credits, Point Types, Roles & Permissions, Campaigns, Coupons, Segments, Badges, Tiers, Rewards, Coalition and Gift Cards routes load
- [ ] `MANUAL` English/Spanish locale switch persists after refresh
- [ ] `MANUAL` Every Admin form field has a `?` tooltip with a useful definition
- [ ] `MANUAL` Tooltip is keyboard/focus accessible and does not cover the active control
- [ ] `MANUAL` 404 route renders the Not Found screen

### Dashboard

- [ ] `MANUAL` KPI cards load without errors
- [ ] `MANUAL` Point overview matches the ledger totals
- [ ] `MANUAL` Recognition volume and top rewards load
- [ ] `MANUAL` Empty-state and API-error states are usable

### Members

- [ ] `MANUAL` List loads active members with pagination
- [ ] `MANUAL` Search by email, name and external ID
- [ ] `MANUAL` Filter by department and active/inactive status
- [ ] `MANUAL` Open member detail and verify profile data
- [ ] `MANUAL` View all configured point wallets and balances
- [ ] `MANUAL` View member transaction history and pagination
- [ ] `MANUAL` Offboard a member with a required reason
- [ ] `MANUAL` Verify offboarding clears configured wallets while retaining history
- [ ] `MANUAL` Reactivate a member and verify wallets remain zero until a new grant
- [ ] `MANUAL` Confirm member detail has no duplicate point-adjustment form; adjustment exists only in Credits

### Credits and wallets

- [ ] `MANUAL` Load point types, banks, cycles, rates, categories, exchange vouchers and ledger
- [ ] `MANUAL` Fund a bank with a reason and idempotency key
- [ ] `MANUAL` Positive member adjustment consumes bank value when bank funding is enabled
- [ ] `MANUAL` Negative member adjustment returns value to the bank
- [ ] `MANUAL` Adjustment requires member, point type, non-zero amount and reason
- [ ] `MANUAL` Per-grant expiry requires an expiry override
- [ ] `MANUAL` Expire due lots and verify balances/ledger entries
- [ ] `MANUAL` Ledger filters by point type, member and action
- [ ] `MANUAL` Exchange rate create/deactivate and min/max/period limits
- [ ] `MANUAL` Cash exchange creates an accounting voucher in `PENDING`, not a payout
- [ ] `MANUAL` Authorized approver transitions `PENDING -> APPROVED`
- [ ] `MANUAL` Authorized accountant transitions `APPROVED -> COMPLETED` with a reference
- [ ] `MANUAL` Completion without an accounting reference is rejected
- [ ] `MANUAL` Unauthorized users cannot adjust wallets, approve or complete vouchers
- [ ] `MANUAL` Recognition categories create/update/delete
- [ ] `MANUAL` Bulk member import validates rows, reports failures and does not partially corrupt data

### Point Types

- [ ] `MANUAL` Create a custom point type with code, name, unit, icon, color and description
- [ ] `MANUAL` Configure `NEVER`, `AFTER_DAYS`, `FIXED_DATE` and `PER_GRANT` expiry modes
- [ ] `MANUAL` Configure manual adjustment, transfer, redemption, exchange, cash eligibility and bank settings
- [ ] `MANUAL` Configure allowance, carry-over, give source, recipient limits and pair limits
- [ ] `MANUAL` Configure source-to-destination transfer rules and verify disallowed paths fail
- [ ] `MANUAL` Set/replace primary point type
- [ ] `MANUAL` Delete an unused point type
- [ ] `MANUAL` Archive a point type that has history and verify history remains available
- [ ] `MANUAL` Verify archived/inactive types are excluded from new grants and portal balances
- [ ] `MANUAL` Verify point-type tooltips explain every configuration field

### Campaigns and coupons

- [ ] `MANUAL` Create, view, edit, estimate, activate/pause and delete a campaign
- [ ] `MANUAL` Configure audience, rules, channels and schedule
- [ ] `MANUAL` Verify campaign lifecycle rejects invalid transitions
- [ ] `MANUAL` Create and edit a coupon campaign
- [ ] `MANUAL` Bulk-generate coupons with valid settings
- [ ] `MANUAL` Verify generated codes, uniqueness, channel and schedule settings
- [ ] `MANUAL` View coupon statistics and delete/deactivate safely

### Segments

- [ ] `MANUAL` Create segment with rule builder
- [ ] `MANUAL` Estimate segment size
- [ ] `MANUAL` View member IDs/count
- [ ] `MANUAL` Add/remove members manually
- [ ] `MANUAL` Edit and delete a segment
- [ ] `MANUAL` Invalid rule combinations show validation instead of a 500

### Badges and tiers

- [ ] `MANUAL` Create/edit/delete badge
- [ ] `MANUAL` Configure badge conditions and preview
- [ ] `MANUAL` View badge statistics
- [ ] `MANUAL` Create/edit/delete tier
- [ ] `MANUAL` Reorder tiers
- [ ] `MANUAL` View tier benefits and distribution statistics

### Rewards and redemptions

- [ ] `MANUAL` Create reward with a program-defined category such as `food_drinks`
- [ ] `MANUAL` Configure accepted prices for multiple custom point types
- [ ] `MANUAL` Edit reward and verify changes are reflected in the portal
- [ ] `MANUAL` Delete reward from table and card views
- [ ] `MANUAL` Verify delete is soft-delete: catalog hides it and redemption history remains
- [ ] `MANUAL` View reward redemption history, totals and unique members
- [ ] `MANUAL` Verify unsupported/invalid price or category input returns a useful validation error

### Coalition

- [ ] `MANUAL` View and edit coalition configuration
- [ ] `MANUAL` Verify adapter capabilities and connection validation
- [ ] `MANUAL` Link/unlink a member
- [ ] `MANUAL` View coalition balances and transactions
- [ ] `MANUAL` Run reconciliation and inspect the result
- [ ] `MANUAL` Verify external provider failure is surfaced without corrupting local ledger data

### Gift Cards

- [ ] `MANUAL` View terms templates and create/edit/delete a template
- [ ] `MANUAL` Create a batch through all wizard steps
- [ ] `MANUAL` View batch metrics and cards
- [ ] `MANUAL` Inspect a card and verify status/history
- [ ] `MANUAL` Lookup, redeem, cancel and refund according to permissions
- [ ] `MANUAL` Verify duplicate redemption/idempotency is rejected safely
- [ ] `MANUAL` Verify HMAC/invalid code lookup cannot expose card secrets

## Portal/User browser checklist

### Public and authentication

- [ ] `MANUAL` Home page loads for an unauthenticated visitor
- [ ] `MANUAL` Rewards, badges and profile links show the correct authentication behavior
- [ ] `MANUAL` Request magic link for a known member
- [ ] `MANUAL` Request magic link for an unknown email returns the same safe response
- [ ] `MANUAL` Verify a valid magic link and create a member session
- [ ] `MANUAL` Expired/consumed/invalid magic link is rejected
- [ ] `MANUAL` Logout clears the member session
- [ ] `MANUAL` Member locale selection persists

### Home, profile and notifications

- [ ] `MANUAL` Home shows balances, tier, recent activity, rewards and badges
- [ ] `MANUAL` Profile reads member data and updates allowed profile fields
- [ ] `MANUAL` Notification preferences load and save
- [ ] `MANUAL` Notifications list loads read/unread state
- [ ] `MANUAL` Notification actions mark items read without duplicate requests
- [ ] `MANUAL` Missing/empty notification state is usable

### Credits and recognition

- [ ] `MANUAL` Credit wallets show every active configured point type, including custom types
- [ ] `MANUAL` Wallet balance, allowance and expiry information match the ledger
- [ ] `MANUAL` Give recognition validates recipients, amount, message and point type
- [ ] `MANUAL` Give allowance limits, pair limits and recipient rules are enforced
- [ ] `MANUAL` Recognition appears in sender/recipient history and feed
- [ ] `MANUAL` Transfer matrix prevents disallowed point-type conversions
- [ ] `MANUAL` Exchange rates, minimum/maximum and period limits are enforced
- [ ] `MANUAL` Cash exchange shows a pending accounting voucher flow only
- [ ] `MANUAL` Reward fulfillment debits the selected point type and shows redemption status
- [ ] `MANUAL` Duplicate submissions with the same idempotency key are safe
- [ ] `MANUAL` Wallet transaction history supports pagination and correct signed amounts

### Rewards and badges

- [ ] `MANUAL` Rewards catalog loads active rewards and custom categories
- [ ] `MANUAL` Reward detail shows accepted point types/prices and availability
- [ ] `MANUAL` Redemption rejects insufficient balance, inactive reward and invalid point type
- [ ] `MANUAL` Successful redemption appears in member redemption history
- [ ] `MANUAL` Badges page shows earned and in-progress badges
- [ ] `MANUAL` Empty badge state and loading/error states are usable

## Cross-cutting acceptance checks

- [ ] `MANUAL` Admin and Portal are usable at mobile and desktop widths
- [ ] `MANUAL` Keyboard navigation works for dialogs, selects, tabs and tooltips
- [ ] `MANUAL` Destructive actions require confirmation and preserve audit/history where specified
- [ ] `MANUAL` Validation errors are field-specific and do not expose stack traces/secrets
- [ ] `MANUAL` Repeating a request with an idempotency key does not duplicate ledger effects
- [ ] `MANUAL` Capability-denied actions are hidden or return 403 consistently
- [ ] `MANUAL` Date/time/locale formatting is consistent with the selected locale
- [ ] `MANUAL` No duplicate adjustment UI remains outside Credits
- [ ] `MANUAL` No 5xx appears in browser console/network during the full smoke pass

## Findings log

| ID     | Area             | Severity | Finding                                                                                                                        | Evidence / follow-up                                                                                                 |
| ------ | ---------------- | -------: | ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| QA-001 | Point adjustment |    Fixed | Prisma failed to deserialize the `void` result from `pg_advisory_xact_lock`, producing 500 on member adjustment.               | Fixed in `e99f6d0`; verify again with an authenticated adjustment.                                                   |
| QA-002 | Admin UI         |    Fixed | Adjustment form was duplicated in Member Detail and Credits.                                                                   | Member Detail form removed; Credits is the canonical UI.                                                             |
| QA-003 | Coalition        |     Fail | `GET /api/v1/admin/coalition/capabilities` returns 500 when the active provider is `GENERIC` because no adapter is registered. | Register/configure the selected coalition adapter or make the capabilities endpoint return a safe unavailable state. |

## Sign-off

- Automated checks: **\*\*\*\***\_\_\_\_**\*\*\*\***
- Admin browser pass: **\*\*\*\***\_\_\_\_**\*\*\*\***
- Portal/User browser pass: **\*\*\*\***\_\_\_\_**\*\*\*\***
- Release decision: `GO / NO-GO`
