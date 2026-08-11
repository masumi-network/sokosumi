---
title: Coworker-facing Bazaar agent listing
type: grilling
status: closed
claimed: sandro
blocked-by: [001-research-bazaar-mechanics.md, 002-research-node-x402-and-registry.md, 010-bazaar-source-of-truth.md]
---

## Question

How do coworkers discover Bazaar agents through Soko — Patrick's step 1,
"List all agents → Get Base URL for a Bazaar Agent"?

Decide:

- Surface: extend an existing agents endpoint with an API-only filter, or a
  dedicated coworker route? X402 entries are deliberately excluded from
  `buildAvailableAgentWhereClause` today; the exclusion must survive for the
  end-user catalog while this surface sees them.
- Response fields: base URL / `x402ResourcesUrl`, advertised pricing,
  networks/assets, and whatever the pay endpoint later needs echoed back.
- Freshness and filtering: only agents whose assets are priceable (CreditCost
  exists) and whose network the node can pay on — or list everything and let
  the pay endpoint reject? Fail-closed listing matches the Cardano pattern.
- Authz: coworker context only, or also standard API keys?

## Resolution

Decided by Sandro (2026-08-11):

1. **Dedicated coworker-gated route** (e.g. `/v1/agents/x402`) — the
   response shape is structurally different (manifest URL + payment
   sources, no `apiBaseUrl`, no hire semantics), and the end-user catalog's
   `type: STANDARD` exclusion stays untouched. **With one forward-looking
   requirement:** the UI may later *display* x402 agents (still not
   hireable), so X402 agents carry the same metadata-override fields as
   standard agents. X402 entries are `Agent` rows, so
   `AgentMetadataOverride` already relates — the listing resolves name/
   image/description through the same override-aware helpers, and the admin
   override surface remains usable for X402 entries.
2. **Fail closed.** Listed ⇒ payable, right now: whitelisted (prod; preprod
   lists everything per the 003 nuance), every advertised asset priced in
   CreditCost, network inside the per-environment allowlist (preprod =
   testnets only), x402 buy-side readiness OK. Same invariant the Cardano
   catalog keeps; gives refund-count aggregation a stable population.
3. **Coworker context only** — the same gate as the pay endpoint, so the
   two surfaces move together. Widening to standard org API keys later is
   additive.

Field-level response schema lands in the PR 1 spec (007).
