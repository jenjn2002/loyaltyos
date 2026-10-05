-- The API historically seeded every built-in template as transactional. These
-- templates should follow members' channel preferences. Magic-link templates
-- remain transactional because they are part of account authentication.
UPDATE "NotificationTemplate"
SET "transactional" = false
WHERE "name" IN (
    'Tier Changed', 'admin-approval-pending', 'admin-approval-pending-in-app',
    'admin-approval-resolved', 'admin-approval-resolved-in-app',
    'admin-point-issuance', 'admin-point-issuance-in-app',
    'admin-project-member-responded', 'admin-project-member-responded-in-app',
    'admin-project-task-completed', 'admin-project-task-completed-in-app',
    'badge-unlocked', 'badge-unlocked-in-app', 'campaign-claim-available',
    'campaign-points-issued', 'campaign-points-issued-in-app', 'check-in', 'check-in-in-app',
    'credit-adjusted', 'credit-adjusted-in-app', 'credit-exchange', 'credit-exchange-approved',
    'credit-exchange-in-app', 'credit-exchange-rejected', 'credit-expiring', 'credit-expiring-in-app',
    'credit-received', 'credit-received-in-app', 'credit-redeemed', 'credit-redeemed-in-app',
    'exchange-cancelled', 'exchange-cancelled-in-app', 'exchange-completed', 'exchange-completed-in-app',
    'project-completed', 'project-completed-in-app', 'project-invitation', 'project-invitation-in-app',
    'project-points-issued', 'project-points-issued-in-app', 'project-task-assigned', 'project-task-assigned-in-app',
    'registration', 'registration-in-app', 'reward-fulfillment-changed', 'reward-fulfillment-changed-in-app',
    'reward-redemption-rejected', 'reward-redemption-rejected-in-app', 'tier-changed-in-app'
);
