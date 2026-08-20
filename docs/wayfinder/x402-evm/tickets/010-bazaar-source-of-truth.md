---
title: Where do Bazaar agents come from — registry or direct CDP discovery?
type: grilling
status: closed
claimed: sandro
blocked-by: []
---

## Question

Patrick's requirement is "the registry then works and indexes x402 base
agents correctly" — but research established that **Bazaar is not
expressible in the pinned registry spec** (`POST /registry-source/` takes
Cardano `policyId` sources only), while Bazaar itself exposes a public,
keyless discovery API
(`api.cdp.coinbase.com/platform/v2/x402/discovery/…`) whose listings carry
full `accepts` pricing and call schemas.

So: what is Soko's source of truth for Bazaar agents?

- **Registry indexes Bazaar** (external work in masumi-registry-service,
  timeline unknown): Soko's existing X402 ingestion keeps working unchanged;
  PR 1 blocks on the registry team shipping.
- **Soko ingests CDP discovery directly**: a second sync source beside the
  registry — new code, new dedupe questions (same agent via both paths?),
  but no external dependency.
- **Hybrid / interim**: direct CDP now, registry later; or the listing
  endpoint proxies CDP live without ingestion.

This decides whether PR 1 has an external blocker, and reshapes the listing
surface (005). Needs Patrick — he owns the registry expectation. Fold in the
research evidence from `../research/001-bazaar-mechanics.md` §1 and
`../research/002-node-x402-registry.md` §4.

## Resolution

**The registry is the source of truth; it already speaks x402.** Resolved by
Sandro (2026-08-11) and verified against masumi-payment-service `main`
(`prisma/schema.prisma`):

- The three entry shapes ship upstream: **Standard** (single API base URL),
  **OpenApi** (`openApiSpecUrl`), **X402** (`x402ResourcesUrl`). The
  `x402ResourcesUrl` schema comment states the manifest is *"aligned to the
  x402 Bazaar DiscoveryResource shape but WITHOUT per-resource pricing
  (payment is agent-level via SupportedPaymentSources)"*.
- Settlement contract is a **per-source** dimension, not per-agent:
  `SupportedPaymentSource` rows are either *Disputable (Masumi)* —
  `chain=Cardano`, `paymentSourceType` set, escrow/refundable — or *x402
  direct settlement* — `chain=EVM`, CAIP-2 `network`, `scheme`/`payTo`/
  `resource`, `paymentSourceType` null, no refunds. The registration UI
  offers exactly these two, and x402 sources are V2-registration-only.
- Research ticket 002's "Bazaar is not expressible" was a wrong implication:
  `POST /registry-source/` being Cardano-only is consistent — x402 agents
  register **through the payment service onto the V2 registry policy**, so
  the registry-service scanner never needs an EVM source. Soko's existing
  X402 ingestion already consumes them.

Consequences: **no external blocker for PR 1 discovery**; direct CDP-Bazaar
ingestion is out of scope — an agent must be Masumi-registered to be listed
through Soko. Whether the pay endpoint signs for *unlisted* 402s remains
ticket 003's question. The pinned specs will need a refresh when the
deployed registry/payment node catch up to upstream main; spec tickets
should read upstream `main` schemas, not only the pins.

> *(Superseded — the deployed nodes already run latest `main` (ticket 011
> answer 7), so the spec refresh and preprod e2e can start now; the refresh
> pulled byte-identical to the pins. See [NODE-QUESTIONS.md](../NODE-QUESTIONS.md)
> `## Answers`.)*
