# Credit & Recognition wallets

This implementation maps the Credit Program Rule Book's generic “Credit/Star” unit to two independent wallets:

- **P-credit (Project Credit)** — funded from the Credit Bank, can carry an `expiresAt`, is redeemable, and can be exchanged for cash or another configured payout.
- **R-credit (Recognition Credit)** — does not expire, is redeemable, and can be exchanged only through a non-cash payout.

The legacy `PointAccount` and `PointTransaction` models remain available for backwards compatibility. New Credit flows use `CreditWallet` and the append-only `CreditTransaction` ledger.

## Member APIs

All endpoints are under `/api/v1` and require the member session cookie (or an appropriately scoped API key for server integrations).

```text
GET  /members/me/credits
GET  /members/me/credits/transactions?creditType=P|R
GET  /credits/exchange/rates
POST /credits/give
POST /credits/exchange
POST /rewards/:id/redeem  { creditType: "P" | "R" }
```

`POST /credits/give` requires a non-empty `message`, one or more recipients, a positive integer amount per recipient, and an `Idempotency-Key` header. A P-credit debit is recorded as `GIVE_OUT`, while the receiver always receives R-credit as `GIVE_IN`. The same request supports multi-recipient distribution.

## Admin APIs

```text
GET  /admin/credits/bank
POST /admin/credits/bank/issue
POST /admin/credits/adjust
GET  /admin/credits/transactions
POST /admin/credits/exchange-rates
POST /admin/credits/expire
```

Positive member adjustments allocate from the selected Credit Bank and require a reason. Negative adjustments return the removed amount to the bank and cannot make a wallet negative. Every adjustment is recorded in both the credit ledger and `AuditLog`.

Exchange rates are versioned. A transaction stores the exact rate row and payout metadata used at confirmation time, so later rate changes do not rewrite history. No exchange rate is seeded automatically because the rule book leaves the cash value, minimums, maximums, and payout mechanism to Finance/Program Governance.

## Outstanding policy decisions

The code supports these rule-book items as configuration, but they still need business values:

1. Program budget and value per credit.
2. Credit Bank replenishment cadence and end-of-cycle clearing workflow.
3. Standard R-credit issuance outside campaigns.
4. Exchange limits and payout reconciliation mechanism.
5. Whether employees should see reward fulfillment status.
6. Whether P-credit expiration notifications should be enabled and how far in advance.
