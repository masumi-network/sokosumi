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

`20260819130000_task_x402_payment` — formerly `20260811130000_task_x402_payment`,
re-timestamped after `20260818120000_better_auth_1_7_account_identity` so the
stack applies after the current main tip. Fully idempotent (enum via
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
- `pnpm --filter core test src/helpers/user-deletion-tasks.test.ts` — 15
  passed (8 pre-existing + 7 new x402 cases).
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

### Confirmation-review fixes (migration convergence)

Two latent migration defects, both reproduced against local Postgres 18.4
before fixing and re-probed after:

- **Nonce-replay unique had a NULL hole.** `payerAddress` is nullable and a
  btree unique treats NULLs as distinct, while the partial predicate gates
  only on `payloadNonce IS NOT NULL` — two rows with the same nonce and a NULL
  payer inserted cleanly, which is the exact double-debit the index claims to
  prevent. Closed with a CHECK making the pair all-or-nothing
  (`task_x402_payment_nonce_payer_together_chk`), declared inline on the
  CREATE and restated in a `DO $$` guard for the converge path. Prisma cannot
  model CHECK constraints, so it is hand-written and documented on the
  `@@unique` in `schema.prisma`. `NULLS NOT DISTINCT` was rejected: it fights
  the `partialIndexes` generator and would show as permanent `migrate diff`
  drift.
- **The enum was the one object that did not restate its shape.** The
  `DO $$ CREATE TYPE … EXCEPTION WHEN duplicate_object` guard swallows the
  whole type on re-apply, so an amended member set never reaches a database
  that applied an earlier shape of the file. Appended
  `ALTER TYPE … ADD VALUE IF NOT EXISTS` for all four members. Verified by A/B
  on a converged database: with the restatements a simulated
  `EXPIRED_UNUSED` amendment lands (5 members), without them the database
  silently stays on 4.

`ALTER TYPE … ADD VALUE` is transaction-safe on PostgreSQL 12+ **only so long
as the member being added is not used in the same transaction**, so these
statements are safe whether or not the runner wraps the file in one. The
proviso holds here because no statement in this file uses a member it adds — the sole
enum literal is `DEFAULT 'PENDING'` in the CREATE TABLE, and on the fresh path
the type is created in the same transaction (which makes all its members
usable) while on every converge path 'PENDING' already exists. A future
amendment must add a member here and use it in a *later* migration; using it
in the same file raises `unsafe use of new value of enum type`. Confirmed
empirically on Postgres 18.4, both the working case and the failing one.

Validated on scratch local Postgres: `prisma migrate deploy` from zero; a hand
re-apply of the amended file; and deploy-then-hand-apply from **all four**
historical shapes of this file (`da9e9030f`, `d3a5ffee4`, `22bf84681`,
`0cb68cdd2`) — all five resulting `pg_dump -s` outputs byte-identical.
`prisma migrate diff` reports no x402 drift (only the pre-existing `chat_room`
partial-unique artifacts). Constraint probes on the real migrated table: a
nonce without a payer and a payer without a nonce are both rejected, two
all-NULL PENDING rows still coexist, and a repeated `(network, asset, payer,
nonce)` tuple still trips `task_x402_payment_nonce_replay_uidx`.

Guarded by `packages/database/src/types/__tests__/x402-migration-convergence.test.ts`,
which derives its expectations from `schema.prisma` — adding a fifth enum
member or another nullable column to the replay tuple fails the suite until
the migration converges on it.

Verification for this step:

- `pnpm --filter @sokosumi/database test` — 248 passed, 2 skipped (38 files).
- `pnpm --filter core test` — 3211 passed, 6 skipped (355 files).
- `pnpm typecheck` — all workspaces clean.
- `pnpm check` — 3119 files, no fixes.
- `prisma format` / `prisma validate` — no churn beyond the added comment.
## Sub-component 3 — buy-side helpers (`x402-3-helpers`) — 2026-08-11

**Branch:** `x402-3-helpers`, cut from `x402-2-model` (clean tree). Three
feature commits (one per area) plus this log entry. Framework-agnostic
helpers only — no route, no wiring into the sync cron yet.

### Area A — CAIP-19 pricing

- `packages/masumi/src/utils/caip19.ts`: canonical lowercase
  `eip155:<chainId>/erc20:<address>` CreditCost keys. Build throws on
  malformed input; parse is case-insensitive and returns lowercase parts.
  The form is a fixed point of `normalizeMasumiPaymentUnit` (it only
  lowercases), so CAIP-19 rows need no ingestion-era dual-spelling dance.
- `apps/core/src/helpers/x402-pricing.ts`:
  `calculateCentsFromX402Amount`. **Pricing convention decided here:**
  CAIP-19 CreditCost rows store `centsPerUnit` per **whole token**
  (ticket 004's "explicit decimals handling"), NOT per base unit like
  Cardano's `lovelace` rows — cents carry 10 decimal places, so a
  per-base-unit price for any asset over 10 decimals would round to zero
  and floor-charge everything. Conversion is ceiling division by
  `10^decimals`, then floored at `MIN_CHARGEABLE_CREDITS`. Unknown asset,
  non-positive row, malformed amount/decimals → 422 pre-charge.

### Area B — 402 dialect normalizer

- `packages/masumi/src/schemas/x402/payment-required.schema.ts`
  (exported from `@sokosumi/masumi/schemas`): accepts a v1 JSON body
  (`maxAmountRequired`, plain network names), a v2 JSON body, or the v2
  base64 `PAYMENT-REQUIRED` header transport (string input), and returns
  the node's v2 `paymentRequired` shape. Network-name map holds ONLY the
  researched names (base→eip155:8453, base-sepolia→eip155:84532); unknown
  names and non-EVM CAIP-2 namespaces error. Conflicting
  `amount`/`maxAmountRequired` spellings error. `x402Version` is
  preserved from the input (the node validates entry shape, not the
  version number). `isX402PaymentIdentifierAdvertised` gates whether the
  pay route may send `paymentIdentifier` (node 400s otherwise, 011 Q2).

### Area C — buy-side readiness composition

- Payment client grew thin `getX402AvailableNetworks` (passes
  `isTestnet` derived from the client's Preprod/Mainnet network) and
  `getX402Budgets`; both neverthrow, both raw node rows. NOTE:
  `clients/index.ts` is a curated export list — `X402AvailableNetwork` /
  `X402Budget` had to be added explicitly.
- `apps/core/src/services/agent-sync.x402-readiness.ts`:
  `syncX402BuySideReadiness` composes ready **(caip2Network, asset)
  pairs** — chain enabled AND a budget in that asset with
  `remainingAmount > 0`; `canSettle` deliberately ignored (buy side needs
  no facilitator). Cache key `x402-buy-side-readiness` +
  `…-failure` marker, copying the Cardano V2 pattern exactly: stale
  served on failure, one page per failure streak via the createMany
  latch, never-recorded bypasses the latch and keeps paging, empty-set
  pages once on transition, `x402_readiness: stale|never_recorded` tags.
- `apps/core/src/helpers/x402-readiness.ts`: `getX402ReadySources`
  (fail closed when never recorded, drops malformed cached pairs, never
  age-expired), `isX402SourceReady`, and the per-environment allowlist —
  Preprod → `eip155:84532` only, Mainnet → `eip155:8453` only, unknown
  never allowed. Environment comes from the existing `NETWORK` env;
  helpers take it as a parameter so they stay pure.

### Verification

- `pnpm --filter @sokosumi/masumi test` — 14 files, 244 tests passed.
- `pnpm --filter core test` on the three new test files — 40 passed;
  plus `agent-sync.service.test.ts` + `agent.test.ts` (146 across 5
  files) to guard the mirrored patterns.
- Mutation-tested by hand (mutate → watch fail → revert → green):
  dropped charge floor, truncating division, unknown-network guess in
  the normalizer, fail-open allowlist. Each killed by a dedicated test.
- `pnpm typecheck` all workspaces; `pnpm check` clean (3129 files).

### What sub-components 4/5 need to know

Exact signatures (all exported):

- `buildCaip19AssetKey(caip2Network: string, assetAddress: string): string`
  (throws on malformed input);
  `parseCaip19AssetKey(key: string): Caip19AssetKeyParts | null`;
  `isCaip19AssetKey(key: string): boolean`; patterns
  `CAIP2_EVM_NETWORK_PATTERN`, `EVM_ADDRESS_PATTERN` — `@sokosumi/masumi`.
- `calculateCentsFromX402Amount(input: { caip2Network; asset; amount;
  decimals }, creditCosts: CreditCost[]): bigint` — throws 422
  `HTTPException`; `@/helpers/x402-pricing`.
- `normalizeX402PaymentRequired(input: unknown):
  Result<X402PaymentRequired, string>`;
  `isX402PaymentIdentifierAdvertised(pr): boolean`;
  `x402PaymentRequiredSchema` (reuse it inside the route's request Zod)
  — `@sokosumi/masumi/schemas`.
- `paymentClient().getX402AvailableNetworks({ signal? })` /
  `.getX402Budgets({ signal? })` →
  `Result<X402AvailableNetwork[] | X402Budget[], string>`.
- `syncX402BuySideReadiness({ signal? }): Promise<boolean>` (changed?) —
  `@/services/agent-sync.x402-readiness`;
  `getX402ReadySources(tx?)`, `isX402SourceReady(network, asset, pairs)`,
  `getAllowedX402Caip2Networks(getEnv().NETWORK)`,
  `isX402NetworkAllowed(network, getEnv().NETWORK)` —
  `@/helpers/x402-readiness`.

Handoff items:

- **The readiness sync is NOT wired into `/sync/agents` yet.**
  `helpers/agent.ts` (890 lines) and `agent-sync.service.ts` (973) both
  sit over the 750-line ceiling, so nothing was added to them. Step 4:
  call `syncX402BuySideReadiness` from `routes/sync/agents/get.ts`
  (import the module directly, same signal/timeout treatment as the
  Cardano call) and extend the `routes/sync/index.test.ts` service mock.
- **Operator prerequisite:** CAIP-19 CreditCost rows price per whole
  token — `POST /v1/credit-costs` `creditsPerUnit` = credits per 1 USDC,
  unit = the `buildCaip19AssetKey` output.
- The listing gate composes: readiness pair (`isX402SourceReady`) +
  per-env allowlist (`isX402NetworkAllowed`) + CreditCost row + curation
  (`isShown`, production only). All fail closed independently.
- Rebuild `@sokosumi/masumi` (`pnpm --filter @sokosumi/masumi build`)
  after pulling — core resolves it through `dist`.
- Step-2 follow-up still open: bound `idempotencyKey` in the pay route's
  Zod (max ~200) before it reaches the btree unique.

### Step-3 review fixes (same branch) — 2026-08-11

Eight findings from the step-3 review, fixed in place. Where they touch the
handoff signatures above, this section supersedes it.

**`GET /x402/budgets` is ADMIN-gated and unscoped — verified upstream.**
Checked against masumi-payment-service `main`: `listX402BudgetsGet`
(`src/routes/api/x402/index.ts`) is built with
`adminAuthenticatedEndpointFactory` — a plain pay key is rejected — and its
handler `listX402WalletBudgets(input.apiKeyId)` returns EVERY key's budget
rows unless the optional `apiKeyId` query filter is passed; it is never
ctx-scoped. Meanwhile `POST /x402/pay` (`pay.ts`, `createX402Payment`) only
draws on budgets `where { apiKeyId: <calling key>, evmWalletId, asset,
enabled }` — a foreign key's budget is never spendable by our key. Fixes:
`getX402Budgets` now resolves its own key id via `GET /api-key-status` and
passes the `apiKeyId` filter (fails loud if the status call fails — never a
silent unscoped read), so readiness can never mark a pair ready off another
key's budget; the wrong "node scopes to the caller" comment is gone; the
admin-permission operator prerequisite is documented in PR1-SPEC §6.
Note the original review suggestion (filter by wallet ids from
`/x402/networks/available`) was unimplementable — that endpoint returns
network rows only, no wallet ids; `apiKeyId` scoping matches the pay-time
predicate exactly.

**Ready pairs now carry `evmWalletId` (decision for steps 4/5).**
`X402ReadySource` is `{ caip2Network, asset, evmWalletId }`; the pair's
`evmWalletId` is the budget-backing wallet the pay route passes to
`POST /x402/pay` — no per-payment `/x402/budgets` fetch. When several
budgets back one (network, asset) pair, `composeX402ReadySources` records
the one with the most remaining spend (tie-break: lexicographic wallet id)
so the recorded set is deterministic. New helper
`findX402ReadySource(caip2Network, asset, readySources):
X402ReadySource | undefined` returns the pair (and wallet) for the matched
402 entry; `isX402SourceReady` delegates to it. Cached rows without
`evmWalletId` (pre-field or malformed) are dropped by `getX402ReadySources`
— fail closed until the next sync rewrites the cache.

**402 normalizer hardening.** The wild entry schema and the node-shape
`x402PaymentRequirementsSchema` are now `looseObject`s: unknown entry keys
(live Bazaar aliases like `currency`/`recipient`) survive normalization
verbatim, because the chosen entry must be echoable byte-for-byte into the
signed payload's `accepted` (research 001 §3) and a strict server re-402s a
stripped echo AFTER the charge; only dialect-translated keys
(`maxAmountRequired`→`amount`, per-entry `resource`→top-level) are
consumed. `accepts` is capped at 20 entries (node `maxItems`) so an
oversized 402 fails pre-charge. v1 multi-entry bodies with DISAGREEING
per-entry resource URLs now error (never-guess, matching the
conflicting-amounts guard); agreeing/single resources keep working. The
dead not-valid-base64 catch is gone (`Buffer.from` never throws); the
surviving error reads "not base64-encoded JSON".

**CAIP-19 conventions fenced out of the Cardano pricing path.** The cost
calculators moved from `helpers/agent.ts` (was over the 750-line ceiling)
into `helpers/agent-cost.ts`: `getAgentCost`,
`calculateCentsFromMasumiAmountStrings`, `AgentCost`, plus new
`listCardanoBillableUnitSpellings`. `calculateCentsFromPricingAmountRows`
throws 422 on a CAIP-19 unit (it bills per SMALLEST unit; CAIP-19 rows
price per WHOLE token — honoring one would charge 10^decimals× wrong), and
`buildAvailableAgentWhereClause` excludes CAIP-19 units from `validUnits`
so a CAIP-19-keyed CreditCost row can never make a Cardano agent billable.
Import sites updated (`job.ts`, `agent-summary.ts`, `events/post.ts`,
`agents/[id]/get.ts`); mutation-tested (fence disabled → 2 tests fail →
restored → green). `agent.ts` is now 765 lines — still over the ceiling;
step 4 must keep extracting, not append.

**Re-arm test fixed.** The readiness re-arm test now seeds a recorded
readiness row before every failure call, so each failure takes the warm
(latched) path: held latch stays silent (count 0), success deletes the
marker, and the next failure's fresh insert (count 1) is what pages — the
latch re-arm itself is what the assertion proves, not the cold-start
bypass.

**Verification:** `pnpm --filter @sokosumi/masumi test` 14 files / 250
passed; core x402 + agent + deletion suites (12 files) 282 passed;
`pnpm typecheck` all workspaces; `pnpm format` + `pnpm check` clean.
