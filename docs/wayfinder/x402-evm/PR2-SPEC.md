# PR 2 spec — masumi-job x402 rail

> **Status:** approved (wayfinder ticket 009) — the second half of the
> destination, **reached 2026-08-11**; all three review points accepted as
> specced. Substrate: [ADR 0001](../../adr/0001-x402-evm-payment-rail.md)
> (Accepted 2026-08-11) — this spec does not restate it; it binds the ADR's
> decisions to concrete schema, flow, and rollout. All former node unknowns
> are resolved ([NODE-QUESTIONS.md](NODE-QUESTIONS.md) `## Answers`).

## 1. Scope

Core hire APIs can run a paid job on an x402 direct-settlement agent:
call → 402 → node-pay → replay inside Soko's job pipeline, and the HTTP
response is the result. Web `/agents` does **not** hire (SOK-805:
Coworkers-only gallery). Listing is already public `GET /v1/agents`
(`kind: "x402"`) from PR 1 — PR 2 **hires those listed agents**. Do not
flip x402 into `buildAvailableAgentWhereClause` (that predicate stays
Cardano MIP-003). Escrow paths untouched. Shares with PR 1: CAIP-19
credit keys, dialect normalizer, verify-against-source, the `/x402/pay`
client, refund policy. Ships **after** PR 1; reuses its helpers.

## 2. Schema

- `Job.paymentRail` enum `CARDANO_ESCROW` (default, backfilled) `| X402` —
  pinned at job creation from the agent's payment source (ADR decision 2/
  snapshot-on-job pattern). Migration: add enum + column with default;
  no data rewrite needed beyond the default.
- `JobX402Payment` — sibling of `JobPurchase` AND of PR 1's
  `TaskX402Payment` (two tables by decision). Shared columns by convention:
  `amount` is a digit `String` (node base units) plus `decimals` from
  **node-published** ready-pair config, not the agent row — same as
  PR1-SPEC §4. Also `jobId @unique`, `caip2Network`, `asset`,
  `payTo`, `paymentIdentifier?`, `status`
  (`PENDING | VERIFIED | FAILED | REFUNDED` — terminal at `VERIFIED`,
  confirmed), `failureReason?`. **Signed-once fields are nullable** —
  `attemptId?`, `xPaymentHeader?`, sign-lease columns (`signAttemptCount`,
  `processingAt?`, `signRiskExpiresAt?`), and the phased-settlement group
  (`payerAddress?`,
  `payloadNonce?`, `paymentPayloadHash?`, `validBefore?`) fill in only when the
  node returns a 200, so `PENDING` rows lack them (mirrors the
  `TaskX402Payment` specified in [PR1-SPEC §4](PR1-SPEC.md); that table is
  not on `main` until the PR 1 implementation lands). `transactionId @unique` is
  set at charge and is present from row creation; `refundTransactionId?
  @unique` is the compensating refund. `@@index([status, validBefore])` for the
  future expiry reconciler.
  - **Record lifecycle:** the `PENDING` row is created in the hire transaction
    with the credit charge (`transactionId`); the signed tuple + settlement
    fields fill in on `VERIFIED`.
  - **Allowed transitions:** `PENDING → VERIFIED` (sign 200);
    `PENDING → FAILED` (pre-sign refusal, + synchronous refund);
    `VERIFIED → REFUNDED` (admin goodwill lever);
    `PENDING → REFUNDED` (future reconciler, `EXPIRED_UNUSED`).

## 3. Job flow

1. **Create** — availability already gates on rail readiness + priced assets
   (fail closed, as Cardano). Credits debited at hire exactly like escrow
   jobs; price from the agent's x402 source via CAIP-19 keys, charge floor
   applies. `paymentRail = X402` pinned; `JobX402Payment` row `PENDING` in
   the same transaction.
2. **Call** the agent resource; expect 402. Normalize dialect (PR 1 helper),
   verify payTo/network/asset against the job's snapshotted source. Convert
   the 402's native amount to credits (same Price step as PR 1), then
   compare **credits ≤ the job's charged credits**. Native-vs-credits mix
   is a bug. Drift → fail the job, refund — provably unpaid, nothing signed.
3. **Pay** — node `POST /x402/pay` (Soko wallet, `paymentIdentifier` only if
   advertised). Three outcomes (the taxonomy specified in PR1-SPEC §3):
   - **Pre-sign refusal** (documented non-200, no header written) →
     **provably unpaid** → **synchronous refund**, record `FAILED`, job
     fails with a **new failure reason** (there is no `PAYMENT_FAILED` Job
     status on `main`; do not invent one silently).
   - **200 with a usable signed header** → record `VERIFIED` + signed tuple +
     phased fields; proceed to replay.
   - **Ambiguous / malformed 200** (no usable header) → record **stays
     `PENDING`**, not refunded inline; left for the post-hoc expiry
     reconciler.
4. **Replay** the original request with `xPaymentHeader`. 2xx → response is
   the result; persist, job completes. Non-2xx/timeout after a signed header
   → job fails, **debit stands** (not provably unpaid — the agent holds a
   settleable header), admin refund lever only. Record keeps the evidence
   for the future `EXPIRED_UNUSED` reconciler, which may post-hoc
   auto-refund if the authorization expires unused.
5. **No polling, no purchase sync** — the x402 job never enters the escrow
   sync selectors (`paymentRail` filter added to
   `buildJobsNeedingPurchaseSyncWhere` / `buildJobsPendingLocalRefundWhere`
   so selectors stay provably disjoint per rail).

## 4. Hire already-listed x402 agents

PR 1 already lists x402 on public `GET /v1/agents` via a **separate**
`kind: "x402"` predicate. PR 2 does **not** reopen that catalog. Hire
uses an already-listed `kind: "x402"` agent. `buildAvailableAgentWhereClause`
stays Cardano-only. Fail-closed gates (curation, `exact`, priced assets,
allowlist, readiness, trusted EIP-712 domain) remain the PR 1 listing
predicate.

## 5. Refund policy binding (ticket 006)

Auto-refund **only** provably-unpaid: nothing signed (steps 2–3 failures) or
node refusal. After a header exists: debit stands; admin lever
(`JobX402PaymentAction` audit, mirroring PR 1); per-agent failure/refund
aggregation feeds the same whitelist-disable dashboard. Future: expired-unused
post-hoc auto-refund via the phased reconciler.

## 6. Rollout

- Flag-free, like V2: the rail activates per-agent via availability (readiness
  + pricing + whitelist). No `paymentRail` rows exist until an x402 agent is
  hired; binary rollback is clean until the first x402 hire (new enum value
  on `Job.paymentRail` is the fence — document in PR body).
- Operator prereqs: X402Network enabled + funded purchasing wallet per chain,
  `ChainIdLimit` covering targets, budgets set. Preprod = testnets only.
- Pre-implementation step: refresh pinned specs (`fetch-specs`) — deployed
  nodes already run the x402 surface.

## 7. Tests

Unit: rail pinning at creation; drift rejection (step 2); refund branches
(provably-unpaid vs debit-stands) mutation-tested; selector disjointness per
rail. Route: hire → 402 → pay → replay happy path against a stubbed client;
non-200 pay → synchronous refund; failed replay → no refund + record
evidence. One preprod e2e against a live testnet x402 agent.
