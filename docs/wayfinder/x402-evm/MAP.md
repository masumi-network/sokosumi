<!-- wayfinder:map -->

# x402/EVM integration — two-PR spec map

## Destination — **REACHED 2026-08-11**

Handoff-ready specs: [PR1-SPEC.md](PR1-SPEC.md) and [PR2-SPEC.md](PR2-SPEC.md).
[ADR 0001](../../adr/0001-x402-evm-payment-rail.md) Accepted. Node gaps
resolved in [NODE-QUESTIONS.md](NODE-QUESTIONS.md). Charting tickets and
research notes are spent and removed. `TaskX402Payment` shipped on main.

Two specs: **(1) Bazaar coworker payment surface** — public
`GET /v1/agents?kind=x402` lists payable agents; a coworker calls the agent
outside Soko, forwards the 402 to a Soko pay endpoint that charges the
task's org in credits and returns a signed `X-PAYMENT` header; coworker
replays for the result; **(2) masumi-job x402 rail** per ADR 0001. There is
no `/v1/agents/x402`. PR 1 was the priority and is implemented. PR 2
implementation is a separate effort fed by its spec.

## Notes

- Substrate: [ADR 0001](../../adr/0001-x402-evm-payment-rail.md) — Accepted
  2026-08-11, credit-refund blocker resolved.
- Standing decision: **no EVM keys in Soko** — all signing is delegated to
  the payment node (`POST /x402/pay`).
- The V2 migration (PR #3440) already ingests X402 registry entries
  (`AgentEntryType.X402`, `x402ResourcesUrl`, EVM `AgentPaymentSource` rows
  with CAIP-2 networks) and excludes them from availability by type.
- Source conversation: Patrick (2026-08-10) — API-only, prioritize Bazaar,
  "the registry then works and indexes x402 base agents correctly".

## Specs

- [PR1-SPEC.md](PR1-SPEC.md) — listing + pay, `TaskX402Payment`,
  charge-then-sign, refund policy, readiness.
- [PR2-SPEC.md](PR2-SPEC.md) — `paymentRail` discriminator, `JobX402Payment`,
  hire flow.
- [NODE-QUESTIONS.md](NODE-QUESTIONS.md) — resolved node/registry gaps.

## Out of scope

- **Implementing PR 2** — the spec is the destination; the build is a
  separate effort.
- **Code changes in masumi-registry-service or the payment node** — external
  repos.
- **Human-coworker task assignment** (Patrick's aside) — separate effort.
- **End-user visibility or hireability of Bazaar agents** — PR 1 is API-only
  by explicit product call; the catalog and hire flows do not change.
