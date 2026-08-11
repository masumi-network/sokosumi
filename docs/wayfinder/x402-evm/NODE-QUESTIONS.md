# x402 buy-side — questions for the payment-node team

> Handoff draft for wayfinder ticket 011. Everything below is about the
> **`POST /x402/pay` buy-side** as pinned in
> `packages/masumi/spec/payment.openapi.json`. Sokosumi's x402 integration
> (Bazaar coworker payments first, masumi x402 jobs second) is specced and
> ADR-ratified against this surface; these are the gaps where the spec is
> silent and Soko currently has to assume the worst. Answers unblock the
> build, not the design.

---

## Paste-ready message

Hey — we've specced Sokosumi's x402 buy-side against the pinned
`/x402/pay` surface and hit a handful of spots where the OpenAPI is silent
and we've had to assume the pessimistic case. None block the design; they
block shipping, because we're moving real credits against them. Ranked by
how much they cost us if we guess wrong:

**1. `/x402/pay` error contract (blocking).** The operation declares only a
`200`. We need the status + body for the failure modes: budget exhausted,
purchasing wallet missing, chain not in the API key's `ChainIdLimit`, and
no acceptable option in `accepts`. We refund the buyer's credits
*synchronously* when the signing provably never put funds at risk — so we
need to tell "node refused before signing" (→ refund) apart from "signed,
then something downstream" (→ do not refund). Without documented error
shapes we can't draw that line safely.

**2. `/x402/pay` idempotency + `paymentIdentifier` semantics (blocking).**
No idempotency is documented (contrast `/x402/settle`, "idempotent per
payment payload hash"). If we retry `/x402/pay` — same `paymentIdentifier`
or not — does it create a second attempt and charge the budget twice? And
what *is* `paymentIdentifier` (the request field has no description): a
dedup key we can rely on, a correlation id, or an echo of the 402's Masumi
extension? We're carrying our own idempotency key on our side regardless,
but we need to know whether a retry that reaches you is safe.

**3. Outbound attempt terminal status (blocking for jobs).** For an
`OutboundPayment` attempt, is `Verified` the terminal success state, and
can `Replayed` ever apply to it? The `/x402/pay` response carries no status
field and `X402PaymentAttempt.status` is a flat enum with no
direction-scoped lifecycle documented. We want to hardcode "outbound stops
at `Verified`/`Failed`, never `Settled`" and need that confirmed.

**4. Look up one attempt by id (needed for reconciliation).** `GET
/x402/payments` only paginates + filters (`status`, `direction`, `side`,
`caip2Network`, …) — there's no `attemptId` filter and no
`/x402/payments/{id}`. Our reconciler for ambiguous (timed-out) payments
needs to fetch a specific attempt. Is an id lookup on the roadmap, or
should we paginate-and-match?

**5. Per-network buy-side readiness (nice to have).**
`/rail-readiness` exposes `x402.purchasing_wallet` / `x402.budget` once per
environment, not per EVM network — no per-source analog of the Cardano
`PurchaseSources`. We'll gate environment-globally for now; is per-network
buy readiness planned, or should we compose it from
`/x402/networks/available` + `/x402/budgets`?

**6. Which x402 dialect does `/x402/pay` accept?** We forward the agent's
raw 402 `paymentRequired`. In the wild we see v1 (`X-PAYMENT`, JSON body)
and v2 (`PAYMENT-REQUIRED`/`PAYMENT-SIGNATURE` headers, CAIP-2 networks) —
does `/x402/pay` take one, both, or the hybrid the node itself speaks? If
we should normalize before forwarding, to which shape?

**7. Deploy timing (scheduling).** The x402 registration + `/x402/*`
surfaces are on your `main`, ahead of the build our pinned specs are
fetched from. When does that reach the deployed preprod/mainnet node? Our
spec refresh (and preprod end-to-end test) waits on that deploy.

Happy to jump on a call for 1–3 if that's faster. Thanks!

---

## Why each matters (internal — not for the message)

| # | Soko decision it unblocks | If unanswered |
|---|---|---|
| 1 | PR1 §3.7 / PR2 refund branch — synchronous refund on provable non-payment | refund branch stays designed-but-unconfirmed; can't ship |
| 2 | PR1 dedupe (own key) + budget-safety on retry | must treat every retry as a double-charge risk |
| 3 | `JobX402Payment.status` terminal state | can't hardcode the lifecycle; PR2 only |
| 4 | ambiguous-payment reconciler | pagination workaround, slower |
| 5 | per-chain readiness gating | environment-global gate ships instead |
| 6 | how Soko normalizes the forwarded 402 | risk of forwarding a shape the node rejects |
| 7 | pinned-spec refresh + preprod test | both PRs wait on the deploy regardless |

Answers land back here as a `## Answers` section; each triggers a follow-up
edit to the affected ticket/spec (1→003+006, 2→003, 3+4→ADR/009, 5→ADR,
6→003, 7→spec-refresh note).

---

## Answers (resolved 2026-08-11 — handoff never sent)

Sandro answered as node authority; each verified against masumi-payment-service
`main` source (`packages/payment-source-x402/src/pay.ts`, `attempt-filters.ts`,
`src/routes/api/x402/index.ts`, `rail-readiness/service.ts`).

1. **Error contract:** 400 = deterministic pre-sign rejection (bad accepts, no
   ChainIdLimit match, network disabled, requirements drift, identifier not
   advertised); 402 = budget/balance refusal; 500 = config/signing failure.
   **Non-200 ⇒ no header issued ⇒ unsettleable ⇒ synchronous credit refund is
   always safe** — "Local signing only — this service never sends the buyer's
   request" (pay.ts). Even a lost-in-transit 200 is unsettleable from the
   coworker's side.
2. **Idempotency: none, by design.** Every call reserves a new attempt and
   decrements budget. `paymentIdentifier` = fail-loud correlation echo into the
   signed payload's extensions (400 if the 402 doesn't advertise the
   extension); never a dedup key. Soko's idempotency key is the sole dedupe;
   double-call costs node budget only, never user funds.
3. **Outbound terminal at Verified | Failed — hardcode it.** Settled/Replayed
   are inbound-only. Eventual settlement (agent → facilitator → chain) is
   modeled **phased**: records store validBefore + from/nonce/payloadHash now;
   a later reconciler checks EIP-3009 authorizationState after expiry —
   consumed → settled-observed; unused → EXPIRED_UNUSED → post-hoc auto-refund
   (provably unpaid). New low-pri node ask: outbound settlement-observation
   surface.
4. **By-attemptId lookup: downgraded to nice-to-have.** Refund-safety removes
   the correctness need; paginate-and-match covers audit.
5. **Per-network readiness: compose Soko-side** from /x402/networks/available
   + /x402/budgets (per-chain today). Env-global /rail-readiness stays the
   coarse signal; low-pri ask to un-collapse the per-chain breakdown it
   already computes.
6. **Dialect: node accepts v2-shaped accepts only** (amount/payTo/
   maxTimeoutSeconds; v1's maxAmountRequired fails validation). **Soko
   normalizes both wild dialects → v2** before forwarding.
7. **Deploy: already live.** Deployed nodes run latest main — pinned-spec
   refresh and preprod end-to-end can start immediately.
