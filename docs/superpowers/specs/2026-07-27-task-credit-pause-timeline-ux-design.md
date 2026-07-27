# Task credit pause + timeline UX

**Date:** 2026-07-27  
**Branch:** `cursor/task-credit-pause-timeline-ux-4bb2`  
**Status:** Approved for planning

## Goal

Make task credit charges legible when coworkers bill on any event (SOK-581), including credit-only rows and mid-run insufficient-balance pauses. Users should see attempted vs settled amounts; coworkers should get clear 422 extensions to retry after top-up.

## Non-goals

- Auto-settle / park completion after top-up (SOK-629 territory; keep today’s drop of requested status on pause)
- Changing `masumiPayment` request shape or mutual exclusivity with `credits`
- Allowing charges under coworker workspace context headers (bare agent key only)
- Filing / implementing Masumi↔credit conversion verification (explicitly deferred; no Linear issue in this workstream unless product opens it later)
- Refunds or clawback on reopen

## Problem summary

1. Credit-only events (no comment, no status) render action copy as “changed status to”.
2. Mid-run billed events that fail for balance become `OUT_OF_CREDITS` but drop attempted `cents`, so the timeline cannot show how much was needed.
3. Properties total and pause UX are fine for settled charges; failed attempts must not inflate `task.credits`.

## Approach (chosen)

**Reuse `TaskEvent.cents` + null `transactionId` for attempts** — no schema migration.

| Event state | `cents` | `transactionId` | Meaning |
|-------------|---------|-----------------|---------|
| Settled charge | set | set | Credits deducted |
| Attempted (pause) | set | null | Tried to charge; not settled |
| No charge | null | null | Status/comment only |

Alternatives rejected:

- New `attemptedCents` / `chargeStatus` columns (clearer model, migration overhead for this UX)
- Attempt amount only in 422 (fails timeline visibility)

## Core behavior

### Pause path (unchanged control flow, richer event)

When a coworker agent posts a credit-bearing event (`credits` or `masumiPayment`) and balance is insufficient:

- **Mid-run** statuses in `OUT_OF_CREDITS_PAUSE_STATUSES`: create event with `status: OUT_OF_CREDITS`, update **task** status to `OUT_OF_CREDITS`, return **422** with that event in `data`.
- **Change:** persist attempted amount on `cents`; leave `transactionId` null (no ledger spend).
- Requested status (e.g. `COMPLETED`) still does **not** apply; comment still attaches to the pause event.
- **Terminal** / already `OUT_OF_CREDITS`: hard-fail (no pause) — unchanged.

### `task.credits` aggregate

Keep summing only consuming transactions (`amount < 0`). Failed attempts (`cents` without spend tx) must not add to the total.

### 422 extensions

Keep `kind: insufficient_balance`. Add:

- `attemptedCredits` (number, user-facing credits)
- `requestedStatus` (string | null) — status from request body, if any

### MasumiPayment

Out of scope for code changes. Keep current behavior: `masumiPayment` exclusive of `credits`; amount from `Amounts` via CreditCost. Pause path should still store converted attempted `cents` the same way as numeric `credits` once the settle helper returns a pause (implementation detail: ensure masumi branch does not clear `cents` on pause).

## Web UI

### Timeline (`task-activity.tsx` + share view)

- Settled: `event.credits != null` and transaction present → existing “charged N credits”.
- Attempted: `event.credits != null` and no transaction → new copy “tried to charge N credits” (i18n all locales).
- Credit-only success (no comment, no status): action text = charged line; do not use “changed status to”.

Detection of “transaction present” must use a field already on the TaskEvent DTO (e.g. `transactionId`). If the web DTO does not expose it today, add it via Core OpenAPI → regenerate web client (no hand-edit of generated files).

### Properties

Unchanged: show total only when `task.credits > 0` (settled only).

## Testing

**Core**

- Mid-run insufficient `credits`: event has `cents` + null `transactionId`, task `OUT_OF_CREDITS`, 422 extensions include `attemptedCredits` / `requestedStatus`.
- Aggregate `task.credits` ignores attempt-only events.
- Settled charge still creates tx and shows settled mapping.

**Web**

- Credit-only settled row: action is charged line, not status copy.
- Attempted pause row: “tried to charge…”.
- Share view parity for both.

## Open follow-ups (not this PR)

- Verify masumiPayment always creates a matching credit ledger row and USDM/USDCx CreditCost conversion matches product expectation (product asked not to file Linear in this session).
- Optional later: auto-settle after top-up (SOK-629).
`}