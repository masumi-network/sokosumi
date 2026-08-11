---
title: How the x402 Bazaar actually works
type: research
status: closed
claimed: research-agent
blocked-by: []
---

## Question

What exactly is the "Bazaar" a coworker discovers agents through, and what
does the full pay-per-call loop look like on Base from the *caller's* side?

Resolve, with sources:

1. What the x402 Bazaar/index is today (Coinbase's discovery layer?), who
   operates it, and what its listing/discovery API returns per resource —
   fields, base URLs, pricing advertisement.
2. The exact 402 response a Bazaar agent returns: `paymentRequirements`
   shape, schemes in the wild (`exact`?), asset/amount denomination, CAIP-2
   network ids, validity windows, nonces.
3. What a valid `X-PAYMENT` header contains (EIP-3009
   `transferWithAuthorization` payload?), who verifies/settles it
   (facilitator role), and what the caller must preserve between the 402 and
   the replay.
4. Replay semantics: can the same signed payment be replayed twice? What does
   the agent return on an expired/consumed authorization? How long is a
   signed payment valid?
5. Any Masumi-specific x402 extensions (payment-identifier) Bazaar agents
   advertise, per the pinned payment spec.

Findings go to `../research/001-bazaar-mechanics.md`; feeds the pay-endpoint
contract, the listing surface, and the refund-policy discussion.

## Resolution

Answered with live probes (2026-08-10) + spec reads; full evidence in
[`../research/001-bazaar-mechanics.md`](../research/001-bazaar-mechanics.md).

1. Bazaar = CDP-facilitator-operated index; public (keyless) discovery at
   `api.cdp.coinbase.com/platform/v2/x402/discovery/{resources,search}`;
   items carry `resource`, `type`, `x402Version`, full `accepts` pricing,
   `extensions.bazaar` call schema, plus wild-only `quality` stats.
2. 402: v1 = JSON body + `X-PAYMENT` header; v2 = base64 `PAYMENT-REQUIRED`
   / `PAYMENT-SIGNATURE` headers, CAIP-2 networks (`eip155:8453`), atomic
   `amount`, USDC asset; schemes in the wild: `exact` (+`batch-settlement`,
   `upto` on testnet). No server nonce — client signs EIP-3009
   `{from,to,value,validAfter,validBefore,nonce}`; facilitator
   `/verify` (stateless) then `/settle` (broadcasts, pays gas).
3. Replay: on-chain once per `(from,nonce)` ("authorization is used");
   validity ≈ `maxTimeoutSeconds` (client signs now−600s..now+timeout);
   pre-settle HTTP replay handled by payload-hash idempotency +
   `payment-identifier` extension.
4. Masumi implements upstream `payment-identifier` (16–128 chars) across
   `/x402/pay|verify|settle`, settle idempotent per payload hash, `Replayed`
   status; agents advertise agent-level pricing + `x402ResourcesUrl` manifest.
5. Unresolved: CDP facilitator `/supported` is auth-gated; Masumi's exact
   extensions envelope + version dialect; no protocol-level refunds.
