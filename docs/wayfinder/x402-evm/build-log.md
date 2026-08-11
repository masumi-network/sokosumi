# x402/EVM PR 1 — build log

Running status log for the PR 1 implementation stack. One section per
sub-component, appended in build order. Specs: [PR1-SPEC.md](PR1-SPEC.md),
map: [MAP.md](MAP.md).

## Sub-component 1 — spec refresh (`x402-1-spec-refresh`) — 2026-08-11

**Branch:** `x402-1-spec-refresh`, cut from `masumi-payment-v2-migration`
(`a7fe04283`). Two commits so far: the wayfinder docs import (including the
ADR 0001 Proposed→Accepted ratification edit, which was still uncommitted in
the working tree) and the spec refresh.

### What changed in the specs: nothing

`pnpm --filter @sokosumi/masumi fetch:specs` fetched both deployed specs
(payment.masumi.network / registry.masumi.network) and wrote them over the
pins; both came back **byte-identical** to the 2026-08-07 snapshots
(payment `1.0.0`, registry `0.1.2`). `pnpm generate:api` reran both hey-api
clients and produced zero diff. The "pinned specs lag upstream `main`" caveat
in PR1-SPEC §7 is resolved in the good direction: the pins already ARE the
deployed x402 surface. Only `spec/SPEC_SOURCES.md` changed (provenance note).

- **`/x402/*` paths present in the pin (20):** `/x402/pay`, `/x402/verify`,
  `/x402/settle`, `/x402/networks`, `/x402/networks/available`,
  `/x402/budgets`, `/x402/wallets` (+ detail/delete/update/balance/count),
  `/x402/payments` (+ reconcile/count), `/x402/settlements` (+ count),
  `/x402/low-balance`, `/x402/analytics`, `/payment/x402`.
- **Registry entry surface:** V2 landmarks all present — `X402` entry type,
  `x402ResourcesUrl`, `SupportedPaymentSources`, per-source pricing
  (`Fixed`/`Dynamic`/`Free` union with `asset`/`amount`/`decimals`).
- **`POST /x402/pay` contract (pin):** request
  `{ evmWalletId, paymentRequired, preferredNetwork?, preferredAsset?, paymentIdentifier? }`;
  200 data `{ attemptId, payer, caip2Network ("eip155:N"), asset (0x…),
  amount (base units), payTo, xPaymentHeader, … }` — matches the PR1-SPEC §3
  request/response shapes.

### Verification

- `pnpm --filter @sokosumi/masumi test` — 11 files, 207 tests passed.
- `pnpm --filter @sokosumi/masumi test:specs` — 4 passed (fetch-specs guards).
- `pnpm typecheck` — all 9 workspaces clean.
- `pnpm check` — 2973 files, no fixes.
- No hand-written client code needed changes (nothing regenerated differently).

### Surprises

- None material. hey-api emits pre-existing "Transformers warning: schema …
  too complex" notices for the pricing unions during `generate:api`; harmless,
  present before this refresh.
- The refresh commit carries only the `SPEC_SOURCES.md` provenance note, since
  specs and generated clients were already current.

### What sub-component 2 (TaskX402Payment schema + migration) needs to know

- **No client-surface drift to absorb.** Generated types under
  `packages/masumi/src/clients/openapi/generated/` are stable; build the
  Prisma model straight from PR1-SPEC §4 as written.
- Field shapes the node will hand back for the record: `attemptId: string`,
  `payer` (EIP-3009 `from` → `payerAddress`), `caip2Network` matching
  `^eip155:\d+$`, `asset` as a 0x ERC-20 address, `amount` as a base-unit
  digit string, `payTo` 0x address — the `String` columns in the spec's model
  are right; no numeric columns.
- `paymentIdentifier` is a top-level optional request field on `/x402/pay`
  (the task-identity correlation echo, PR1-SPEC §3) — nothing extra to store
  beyond the spec's columns.
- The dedupe unique is `@@unique([taskId, idempotencyKey])` and the node has
  **no idempotency of its own** (ticket 011) — the migration must ship that
  unique in the same change as the table, never as a follow-up.
- Reminder from the spec: `TaskX402PaymentStatus` enum
  `PENDING|VERIFIED|FAILED|REFUNDED`, `@@index([agentId, status])` for the
  per-endpoint refund aggregation, plus the FK-free append-only
  `TaskX402PaymentAction` sibling.

## Sub-component 2 — TaskX402Payment schema + migration (`x402-2-model`) — 2026-08-11

**Branch:** `x402-2-model`, cut from `x402-1-spec-refresh` (`eafc3a89d`). Two
commits: the schema + migration, and the user-deletion guard + tests.

### Schema decisions

- `TaskX402PaymentStatus` (`PENDING|VERIFIED|FAILED|REFUNDED`) with a doc
  comment pinning why VERIFIED is terminal for the automated flow: the node
  signs locally, Soko cannot observe settlement until the phased-settlement
  reconciler (ticket 011 Q3) ships; REFUNDED is reachable only from
  PENDING/FAILED auto-refunds or an operator goodwill refund.
- `TaskX402Payment` per PR1-SPEC §4 verbatim, plus the relations the spec
  implies: `taskId → Task` **Restrict** (a money record must never vanish
  with its task — the same reasoning as the claim's Restrict on its
  transactions; the claim itself has no task FK, only `taskEventId SetNull`),
  `agentId → Agent` Restrict (aggregation key; no production code path
  hard-deletes Agent rows, so Restrict costs nothing today),
  `taskEventId → TaskEvent` SetNull `@unique`, `transactionId` /
  `refundTransactionId → Transaction` Restrict `@unique` — mirroring the
  claim exactly.
- Indexes: the `@@unique([taskId, idempotencyKey])` dedupe ships in the same
  migration as the table (the node has no idempotency of its own),
  `@@index([agentId, status])` for §5 aggregation, and
  `@@index([status, validBefore])` for the future reconciler's expiry scan.
- `TaskX402PaymentAction` mirrors `TaskPaymentClaimAction`: append-only,
  FK-free (account deletion hard-deletes terminal payments and can remove the
  operator's User row; cascade would erase the audit trail, restrict would
  block deletion).
- Back-relations added on `Task`, `Agent`, `TaskEvent` (`x402Payment?`), and
  `Transaction` (two named relations, claim-style).

### Migration

`20260811130000_task_x402_payment` — timestamped after
`20260811120000_external_channels`. Fully idempotent (enum via
`duplicate_object` guard, `CREATE TABLE/INDEX IF NOT EXISTS`, FK adds in
`DO $$` guards), matching the payment-v2 branch style. Validated on scratch
local Postgres: full `prisma migrate deploy` from zero, a second direct
`psql` re-apply of the new file (no-op, NOTICEs only), and
`prisma migrate diff` from the applied DB to the schema shows **no x402
drift** (the only reported diffs are pre-existing SQL-only partial unique
indexes Prisma cannot model, e.g. `chat_room_guest_invitation`'s
pending-status unique).

### User-deletion guard (apps/core)

`prepareTasksForUserDeletion` now mirrors the claim guard for x402 payments:
PENDING blocks with `TASK_X402_PAYMENT_PENDING` (no Sentry page — unlike a
review-required claim it self-clears via coworker retry or reconciler
auto-refund), then terminal payments are swept across **all three** RESTRICT
branches (`transaction`, `refundTransaction`, `task.ownerId`) before
`task.deleteMany`. The task-owner branch is the one the claim guard does not
have: `taskId` is Restrict, so a payment row on an owned task would fail the
owned-task delete regardless of who was charged.

### Verification

- Scratch-DB migration validation as above (local Postgres was available).
- `pnpm --filter @sokosumi/database test` — 36 files passed, 245 tests.
- `pnpm --filter core test src/helpers/user-deletion-tasks.test.ts` — 11
  passed (5 existing + 6 new/extended).
- `pnpm typecheck` — all workspaces clean.
- `pnpm check` — 3118 files, no fixes.
- `prisma format` fixed pre-existing alignment drift from the
  external-channels commit; formatting-only churn in `schema.prisma`.

### What sub-component 3 needs to know

- Core resolves `@sokosumi/database` through its built `dist` — after any
  schema change run `pnpm --filter @sokosumi/database build` (not just
  `prisma:generate`) or core tests see `undefined` enums.
- `TaskX402PaymentAction.action` doc comment reserves `"refund" | "resolve"`;
  the admin surface (§5) should stick to those strings.
- No status transition guard exists at the DB layer — terminal-at-VERIFIED is
  enforced by application code; the pay-route service must not add post-
  VERIFIED transitions until the phased-settlement reconciler ships.

### Step-2 review follow-ups (for sub-component 3+)

- **`idempotencyKey` MUST be `.max()`-bounded in the pay route's Zod** —
  it sits inside the `[taskId, idempotencyKey]` btree unique, and an
  unbounded coworker-supplied key can exceed the btree row limit at INSERT
  time: a runtime 500 (charge rolls back, no money lost) where a 400 belongs.
  Mirror identifierFromPurchaser's bounds (something like max 200).
- Review fixes applied on x402-2-model: order assertion on the terminal
  sweep (RESTRICT means sweep-before-task-delete is load-bearing), and a
  third `refundTransaction` OR branch on the PENDING guard.
