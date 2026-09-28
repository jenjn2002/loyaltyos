BEGIN;

-- Keep production users, credentials, roles, program data, and ledger history,
-- but revoke copied sessions and one-time login links so no production session
-- can be replayed in the sandbox.
DELETE FROM "Session";
DELETE FROM "AdminSession";
DELETE FROM "MagicLinkToken";

-- Prevent copied keys and outbound integrations from reaching live services.
UPDATE "ApiKey" SET "isActive" = false;
UPDATE "MicrosoftAuthConfig"
SET "enabled" = false,
    "encryptedClientSecret" = NULL;
UPDATE "WebhookSubscription"
SET "isActive" = false,
    "secret" = '';
UPDATE "CoalitionConfig"
SET "accumulationEnabled" = false,
    "redemptionEnabled" = false,
    "conversionEnabled" = false,
    "endpoint" = 'http://127.0.0.1:9/disabled',
    "encryptedCredentials" = '';

COMMIT;
