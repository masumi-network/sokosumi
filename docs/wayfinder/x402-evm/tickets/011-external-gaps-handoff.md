---
title: Hand the node/registry question list to the external teams
type: task
status: closed
claimed: sandro
blocked-by: []
---

## Question

Research surfaced concrete questions only the payment-node and registry
teams can answer. Deliver them and capture the answers — later tickets
(pay-endpoint contract, ADR ratification) depend on some, and every day of
external latency is on PR 1's critical path.

Payment node (`research/002-node-x402-registry.md` §5):

- `POST /x402/pay` error contract — nothing is declared; what do failures
  return?
- Idempotency of `/x402/pay` — retries must currently be assumed to
  double-charge budget; is `paymentIdentifier` a dedupe key, and what are
  its semantics?
- Outbound attempt terminal status (ADR assumes `Verified`; spec is silent).
- By-`attemptId` lookup on `/x402/payments` (ADR assumes it; only list
  filters exist).
- Per-network buy-side readiness (checks are environment-global today).
- The `accepts` selection rule when a 402 offers multiple options.
- Which x402 dialect `/x402/pay` accepts — v1, v2, or the hybrid the node
  itself speaks (`research/001-bazaar-mechanics.md` §2/§5).

~~Registry: does/will the deployed registry index Bazaar agents?~~ Resolved
by [the source-of-truth ticket](010-bazaar-source-of-truth.md): x402 agents
register through the payment service onto the V2 registry policy; no
registry-team ask remains. One replacement question for the node team:
**when do the x402 registration + `/x402/*` surfaces on upstream `main`
reach the deployed node** our pinned specs are fetched from — PR 1's spec
refresh waits on that deploy.

HITL: Sandro sends these (Slack to Patrick / node team or issues on their
repos). Resolution = answers recorded here, plus follow-on edits to the
affected tickets.

## Resolution

**Handoff never needed to be sent.** Sandro answered all seven questions as
node authority (2026-08-11), each verified against masumi-payment-service
`main` source. Full answers: [`../NODE-QUESTIONS.md`](../NODE-QUESTIONS.md)
`## Answers`. Headlines: a documented non-200 from `/x402/pay` proves only
that **this call** issued no header — Soko refunds on the fresh first
attempt when no header was written, not on every non-200; no node
idempotency (Soko's key is the sole dedupe);
outbound terminal at Verified (settlement observation phased, EXPIRED_UNUSED
post-hoc auto-refund later); by-id lookup + per-chain readiness downgraded to
composition/nice-to-have; readiness also checks wallet balances and trusted
EIP-712 domains; Soko normalizes both 402 dialects → v2; **deployed
nodes already run latest main** — spec refresh and preprod e2e can start now.
Two low-priority node asks remain (outbound settlement observation,
per-chain readiness breakdown) — neither gates anything.

## Superseded: draft that was ready to send

Paste-ready message + per-question rationale drafted in
[`../NODE-QUESTIONS.md`](../NODE-QUESTIONS.md). Seven questions, ranked by
blast radius:

1. `/x402/pay` error contract — **blocking** (the synchronous-refund line
   depends on distinguishing pre-sign refusal from post-sign failure).
2. `/x402/pay` idempotency + `paymentIdentifier` semantics — **blocking**.
3. Outbound attempt terminal status — blocking for PR 2.
4. By-`attemptId` lookup on `/x402/payments` — needed for the reconciler.
5. Per-network buy-side readiness — nice to have; env-global ships otherwise.
6. Which x402 dialect `/x402/pay` accepts — how Soko normalizes the 402.
7. Deploy timing of the upstream `main` x402 surfaces — schedules the spec
   refresh + preprod test; gates both PRs regardless.

The registry-team question is dropped — resolved by
[ticket 010](010-bazaar-source-of-truth.md) (x402 agents register through the
payment service onto the V2 registry policy).

**(Superseded — the message was never sent; answered in-house, see
`## Resolution` above. Original next-action draft kept for the record:)**

**Next action: Sandro sends the message; answers return under a `## Answers`
section in NODE-QUESTIONS.md, then this ticket closes and the mapped
follow-up edits (1→003+006, 2→003, 3+4→ADR/009, 5→ADR, 6→003, 7→spec
refresh) land.**
