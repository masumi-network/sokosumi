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

**Current contract:** public `GET /v1/agents` with `kind: "cardano" | "x402"`.
There is no `/v1/agents/x402`. Pay stays coworker + assigned task. Web
`/agents` stays Coworkers-only (SOK-805).

A dedicated coworker-gated `/v1/agents/x402` was the 2026-08-11 sketch and
was dropped during implementation. Callers see one agent catalog.

1. **One public list** — `GET /v1/agents`. Filter `?kind=x402` /
   `?kind=cardano` / omit both. x402 items have a different response shape
   (discovery URL + payment sources, no `apiBaseUrl`, no hire semantics).
   Metadata-override helpers still apply. `buildAvailableAgentWhereClause`
   stays Cardano-only; x402 rows join through the `kind` discriminator.
2. **Fail closed.** Listed ⇒ payable, right now: whitelisted (prod; preprod
   lists everything per the 003 nuance), every advertised source uses
   scheme `exact`, every advertised asset priced in CreditCost, network
   inside the per-environment allowlist (preprod = testnets only), x402
   buy-side readiness OK. Same invariant the Cardano catalog keeps.
3. **List is public; pay is not.** The catalog is unauthenticated. Paying
   still requires `requireTaskCollaboration` + `isCoworkerAgentContext`.

Field-level response schema lands in the PR 1 spec (007).
