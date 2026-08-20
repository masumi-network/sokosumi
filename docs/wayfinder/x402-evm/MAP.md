<!-- wayfinder:map -->

# x402/EVM integration — two-PR spec map

## Destination — **REACHED 2026-08-11**

Both specs are handoff-ready: [PR1-SPEC.md](PR1-SPEC.md) and
[PR2-SPEC.md](PR2-SPEC.md), ADR 0001 Accepted, every ticket closed, nothing
external gating. Implementation of each PR is a separate effort fed by its
spec.


Two implementation-ready specs, one per PR: **(1) Bazaar coworker payment
surface** — public `GET /v1/agents?kind=x402` lists payable agents; a
coworker calls the agent outside Soko, forwards the 402 to a Soko pay
endpoint that charges the task's org in credits and returns a signed
`X-PAYMENT` header; coworker replays for the result; **(2) masumi-job x402
rail** per ADR 0001, ratified. Every blocking decision resolved;
implementation itself is out of scope. PR 1 is the priority. There is no
`/v1/agents/x402`.

## Notes

- Tracker: local markdown (this directory). Linear is the repo convention but
  was unauthenticated at charting; migrate there if it gets authorized —
  tickets carry no Linear ids until then.
- Tickets live in `tickets/`, research assets in `research/`. A ticket is
  claimed by setting `claimed:` in its front matter; closed by `status:
  closed` plus a `## Resolution` section. Blocking is the `blocked-by:` list
  (file names); frontier = open, unclaimed, all blockers closed.
- Substrate: [ADR 0001](../../adr/0001-x402-evm-payment-rail.md) already
  designs most of PR 2 (rail discriminator, `JobX402Payment`, node-delegated
  signing, CAIP-19 credit-cost keys, buy-side readiness). **Accepted
  2026-08-11, credit-refund blocker resolved.**
- Standing decision inherited from ADR 0001: **no EVM keys in Soko** — all
  signing is delegated to the payment node (`POST /x402/pay`). PR 1 reuses
  this; a Soko-held wallet is off the table unless the ADR is reopened.
- The V2 migration (PR #3440) already ingests X402 registry entries
  (`AgentEntryType.X402`, `x402ResourcesUrl`, EVM `AgentPaymentSource` rows
  with CAIP-2 networks) and excludes them from availability by type.
- Skills for HITL tickets: /grilling, /domain-modeling; specs are drafted as
  prototypes to react to, not delivered wholesale.
- Source conversation: Patrick (2026-08-10) — API-only, prioritize Bazaar,
  "the registry then works and indexes x402 base agents correctly".

## Decisions so far

- Destination + scope — decided at charting: two specs, implementation out of
  scope, PR 1 first.
- Charge scope for PR 1 — decided at charting: **task-scoped**. The coworker
  must be assigned to a task; the task's org pays, mirroring the
  `masumiPayment` trust/authz model, and the audit trail hangs off the task.
- [How the x402 Bazaar actually works](tickets/001-research-bazaar-mechanics.md)
  — Bazaar is the CDP-facilitator-operated index with keyless discovery
  endpoints; schemes in the wild are `exact` (client-signed EIP-3009, no
  server nonce, one on-chain use per `(from,nonce)`, validity ≈
  `maxTimeoutSeconds`); Masumi implements the upstream `payment-identifier`
  extension; **no protocol-level refunds**.
- [What the payment node and registry already give us](tickets/002-research-node-x402-and-registry.md)
  — `POST /x402/pay` happy path fully specced but declares **no error
  contract and no idempotency** (retries must be assumed to double-charge
  budget); `/x402/payments` has no by-`attemptId` lookup and readiness checks
  are environment-global, both drifting from ADR 0001; Soko already ingests
  X402 entries completely (availability flip is the only gate); the pinned
  spec's registry sources are Cardano-only — see the next line for why that
  is not a gap.
- [Where do Bazaar agents come from](tickets/010-bazaar-source-of-truth.md)
  — **the registry, which already speaks x402**: agents register through the
  payment service onto the V2 registry policy (entry shapes Standard /
  OpenApi / X402; `x402ResourcesUrl` manifest aligned to the Bazaar
  DiscoveryResource shape), and settlement contract is per-source —
  *Disputable (Masumi)* vs *x402 direct settlement*. No external blocker for
  PR 1 discovery; direct CDP ingestion out of scope; verified against
  payment-service `main`, which is ahead of our pinned specs.
- [Refund policy](tickets/006-refund-policy.md) — PR 1: **auto-refund only
  when unsettleable** (documented first-attempt refusal; header never
  written). No auto-refund after a header exists. Admin refund/resolve +
  per-agent aggregation feeding a whitelist disable. PR 2: **auto-refund
  only when provably unpaid** (never signed / never sent); after signing,
  admin lever only — no parity with escrow. Disputable-vs-x402 preference
  moot: different agents by registry design.
- [Coworker pay-endpoint contract](tickets/003-pay-endpoint-contract.md) —
  modeled after the node's `POST /x402/pay` on both sides: raw 402 in,
  node-response pass-through out, Soko owns `evmWalletId` and stamps task
  identity into metadata. Signs for **listed agents only** (payTo/network/
  asset reverse-match + pricing sanity check), per-env EVM network allowlist
  (preprod = testnets only), mandatory coworker idempotency key as the
  dedupe unique, authz identical to the `masumiPayment` task-event gate
  (sub-tasks covered via `TaskLink` `PARENT`; there is no `Task.parentTaskId`).
- [Pricing and spend controls](tickets/004-pricing-and-spend-controls.md) —
  CAIP-19 CreditCost keys + fail-closed unknown assets (inherited from ADR
  0001); **charge floor** at `MIN_CHARGEABLE_CREDITS` for micro-payments
  (ceil, never below); debit from the org/user **credit balance** (there is
  no `Task.maxCredits`); optional per-request `maxCredits` ceiling;
  node budgets as operator backstop.
- [Coworker-facing Bazaar agent listing](tickets/005-coworker-listing-surface.md)
  — public `GET /v1/agents` with `kind: "cardano" | "x402"`. **No**
  `/v1/agents/x402`. Fail closed (listed ⇒ payable: whitelist, `exact`
  scheme, priced assets, per-env network allowlist, readiness). Pay stays
  coworker + assigned task. Web `/agents` stays Coworkers-only (SOK-805).
- [PR 1 spec](tickets/007-pr1-spec.md) — **first half of the destination
  reached.** Full spec at [PR1-SPEC.md](PR1-SPEC.md): listing + pay
  endpoints, `TaskX402Payment` sibling model, charge-then-sign flow with the
  provably-unpaid refund branch, admin refund + per-endpoint aggregation,
  env/operator prerequisites, test strategy. Approved first-pass; task-nested
  path and required `agentId` confirmed. All former ship-gates resolved by
  the ticket-011 answers — spec upgraded in place (timeout/`PENDING` stays
  held unless no header was written, dialect normalizer, phased settlement
  fields).
- [Ratify ADR 0001](tickets/008-ratify-adr-0001.md) — [ADR 0001](../../adr/0001-x402-evm-payment-rail.md)
  flipped **Proposed → Accepted**: refund policy folded in as the resolved
  blocker, `JobX402Payment`/`TaskX402Payment` fixed as two sibling tables,
  the five node-behavior drifts annotated `[pending — ticket 011]`, and the
  proposed draft's TTL'd-readiness mischaracterization corrected against the
  code. Accepted-with-caveats; PR 2 spec (009) unblocked.
- [Node/registry handoff](tickets/011-external-gaps-handoff.md) — **all seven
  questions answered in-house** (Sandro + upstream `main` source), handoff
  never sent: documented first-attempt refusal with no written header
  refunds; a `PENDING` replay or lost 200 after delivery does not; no
  node idempotency (Soko's key sole dedupe); outbound terminal at Verified
  with settlement observation phased (EXPIRED_UNUSED post-hoc refund later);
  readiness composed Soko-side; Soko normalizes both 402 dialects → v2;
  **deployed nodes already run latest main** — nothing external gates the
  build. Answers: [NODE-QUESTIONS.md](NODE-QUESTIONS.md).
- [PR 2 spec](tickets/009-pr2-spec.md) — **second half of the destination
  reached; the map is complete.** Spec at [PR2-SPEC.md](PR2-SPEC.md):
  `paymentRail` discriminator, `JobX402Payment` sibling, call→402→pay→replay
  flow bound to the refund policy, flag-free rollout (fence = first x402
  hire), rail-filtered sync selectors, shared PR 1 helpers. Approved with
  all three review points as specced.

## Not yet specified

- **Map migration to Linear** if the connector gets authorized. (The
  admin/observability surface and PR 2 rollout/ops runbook, formerly listed
  here, are now specified — see [PR1-SPEC.md](PR1-SPEC.md) §5 and
  [PR2-SPEC.md](PR2-SPEC.md) §6.)

## Out of scope

- **Implementing either PR** — the specs are the destination; builds are
  separate efforts fed by them.
- **Code changes in masumi-registry-service or the payment node** — external
  repos. Gaps found here become handoffs, not tickets on this map.
- **Human-coworker task assignment** (Patrick's aside) — separate effort.
- **End-user visibility or hireability of Bazaar agents** — PR 1 is API-only
  by explicit product call; the catalog and hire flows do not change.
