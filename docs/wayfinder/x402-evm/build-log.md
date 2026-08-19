# x402/EVM PR 1 — build log

Running status log for the PR 1 implementation stack. One section per
sub-component, appended in build order. Specs: [PR1-SPEC.md](PR1-SPEC.md),
map: [MAP.md](MAP.md).

> **Current-contract note, 2026-08-17.** This file is an append-only history.
> Earlier sections can describe designs that later reviews superseded. Use
> PR1-SPEC.md and ADR 0001 for the current contract. In particular:
>
> - Only a documented node-owned refusal with its documented error envelope
>   permits a synchronous refund. Other sign outcomes remain risk-fenced
>   `PENDING`.
> - Base-unit amounts persist as digit strings. The record also stores the
>   bearer header, sign-attempt count, lease, and sign-risk expiry.
> - Readiness uses networks, Soko-key budgets, purchasing-wallet balances, and
>   a local trusted exact-EVM domain allowlist.
> - Bazaar and OpenAPI rows use separate discovery URL fields. `specification`
>   identifies which field is present.
> - Request `maxCredits` caps one payment intent. It is not a cumulative task
>   budget.
> - Admin aggregation groups by `agentId`. Current docs call it per-agent
>   aggregation, not per-endpoint aggregation.
> - The x402 gallery preview built on August 14–15 is disabled. Discovery is
>   API-only, and the standard catalog and search receive no x402 rows.

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

### Step-3 re-review residuals (for step 4)

- `apps/core/src/helpers/agent.ts` is 762 lines — still over the 750 ceiling.
  Step 4 touches listing: extract the availability/where-clause helpers (or
  the metadata-override getters) as part of its change, per the split rule.

### Step-3 fourth review — trusted asset decimals + canonicalizer holes

**Ready pairs now carry the NODE's `decimals`; the agent's copy is never
priced off.** `X402ReadySource` is
`{ caip2Network, asset, evmWalletId, decimals }` (the shape recorded above
is superseded). `decimals` scales the charge inversely
(`cents = ceil(amount x centsPerUnit / 10^decimals)`), and the only copy
reaching `calculateCentsFromX402Amount` came from
`registryPaymentSourcePricingSchema` — the agent's OWN registry entry,
range-checked but never cross-checked. Registering USDC on Base with
`decimals: 18` (true value 6) floored the charge at
`MIN_CHARGEABLE_CREDITS` while the managed wallet signed away a real
USDC; the demand still cleared the ceiling check, because that compares
against the same agent-registered amount. `composeX402ReadySources` now
reads `defaultAsset` + `defaultAssetDecimals` off
`GET /x402/networks/available` (both required-but-nullable in the pinned
spec) and records the node's scale, matching the budget's asset to the
chain's default asset canonically. `getX402ReadySources` re-validates it
on read like every other field (`isUsableAssetDecimals`, hoisted into
`helpers/x402-pricing.ts` next to the formula that consumes it).

Everything fails closed: null / non-integer / out-of-range decimals drop
the pair; a chain listed twice with disagreeing scales drops entirely; a
cached row predating the field drops until the next sync. **A funded
budget in a NON-default asset also drops** — the node vouches for no
scale on it, and the only other copy is the agent's, so unpriceable is
unpayable. Nothing real is lost today (each allowed chain lists exactly
the one USDC contract Soko pays in); a second asset needs the NODE to
publish its decimals, not a Soko-side guess. Consequence: at most one
pair per chain, so the compose-time sort is a no-op until an allowlist
grows — kept, because the serialized array is the change-detection key.
Mutation-tested: recording the agent-authored 18 instead fails the money
assertion (`expected 1n to be 10000000000n`); restored green.

**Steps 4/5 must consume it.** `helpers/x402-agent-listing.ts` and
`helpers/x402-payment-verify.ts` still pass `amount.decimals` (the
projected registry value) into pricing. They must take `decimals` from
the matched `X402ReadySource` instead — `isX402SourceReady` becomes a
`findX402ReadySource` call on the listing side — and keep the row's own
`missing_decimals` / no-decimals rejections only as a registry sanity
gate, never as the pricing input.

**Canonical-JSON fences.** `canonicalJsonKey` swallows EVERY throw now,
not just `NotCanonicalizableError`: a throwing enumerable getter escaped
as a plain `Error`, which on the pay path is a 500 instead of the
fail-closed "not equal" the caller is written for. Array holes serialize
as `null` (an index loop, not `map`, which skips them) so a sparse array
can no longer produce `[,1]`. The key-side `JSON.stringify` is now
guarded by a test that a raw `"${key}":` makes red
(`{ 'a":1,"b': 2 }` vs `{ a: 1, b: 2 }`) — the previous pair of
assertions only exercised the value side and left the whole suite green
under that mutation. `X402_MAX_ENCODED_PAYLOAD_LENGTH`'s doc now names
its companion, the pay route's `bodyLimit`, since the v1 JSON-body
dialect still has no total-size bound in the package (32 MB body: ~32 ms,
+9.4 MB heap through `stripPrototypePollutingKeys`).

**Verification:** `pnpm --filter @sokosumi/masumi test` 17 files / 322
passed; `pnpm --filter core test` 359 files / 3275 passed (6 skipped);
`pnpm typecheck` all workspaces; `pnpm check` clean.

### Step-3 fifth review — `accepts` is a menu, not an all-or-nothing offer

**One unsupported option no longer poisons a 402 that also carries a
payable one.** `accepts` is a MENU and the client picks ONE, but every
unsupported-option check was enforced payload-wide: `wildRequirementSchema`
typed `scheme`, `extra.assetTransferMethod` and the `maxTimeoutSeconds`
cap, so a single bad element failed `z.array(...)`, and the normalization
loop `return err`ed on the first entry it could not translate. Measured
before the fix — every payload below also carries the canonical payable
entry from research 001 §2:

```
REFUSED  exact + batch-settlement          -> Invalid input: expected "exact"
REFUSED  exact on Base + exact on Solana   -> Unknown x402 network "solana:5eykt4Us…"
REFUSED  exact eip3009 + exact permit2     -> Invalid input: expected "eip3009"
REFUSED  exact 3600s + exact 86400s        -> Too big: expected number to be <=3600
REFUSED  exact + a 79-digit-amount entry   -> x402 amount is 79 digits
OK       control: the payable entry alone
```

Not hypothetical: research 001 §2 records `batch-settlement` offered
*alongside* `exact` by live Base-mainnet resources (`receiverAuthorizer`,
`withdrawDelay: 86400`), and §3 records Permit2/ERC-7710 as standardized
v2 exact/EVM fallbacks beside EIP-3009. Base mainnet `eip155:8453` is
exactly what `X402_MAINNET_ALLOWED_CAIP2_NETWORKS` allows. The listing
side composes payability from the registry plus readiness rather than
from the live 402, so the agent stayed listed while every call 422'd —
"listed ⇒ payable" broken against a real listing.

**Selection is now per entry.** Those three fields are shape checks in the
wild schema (`scheme` a bounded string, `assetTransferMethod` a bounded
string, `maxTimeoutSeconds` an int without the cap); the VALUES are
refused per entry in `selectPayableRequirement`, which `continue`s with a
collected reason instead of failing the payload. The payload is refused
only when NO entry survives, echoing every reason through
`truncateDetail`: `No payable x402 requirement in accepts (N refused):
[0] … | [1] …`. A field of the wrong TYPE is still a payload-wide parse
failure — that is a malformed 402, not a menu option Soko does not
support.

**Nothing is guessed and no fence is weakened.** An unsupported option is
not translated into a supported one, it is simply not selected.
`x402PaymentRequirementsSchema` stays strict and is now the ONLY gate on
an emitted entry — the scheme allowlist, the CAIP-2 and canonical-address
patterns, the amount width, the timeout cap and the pinned
`extra.assetTransferMethod` all re-run on every survivor (the translation
step deliberately returns untyped data). The shadow-key filter, prototype
sanitizer, length caps, echo truncation and the 20-entry cap are
untouched, and `min(1)` becomes the structural nothing-payable backstop.
Resource URLs are pooled over EVERY wild entry and evaluated BEFORE
selection, so the cross-entry conflict fence keeps its meaning.

**The downstream same-`(network, asset)` agreement fence is unaffected.**
Removing a member from a group can only remove disagreements, so the only
question is whether a skipped entry could have been one that *should*
have refused the payload. It cannot: every skip reason either puts the
entry in a different `(network, asset)` group (bad network, bad asset) —
out of the fence's scope by definition — or makes it structurally
unpayable (invalid `payTo`, unpersistable amount, unsupported scheme or
transfer method, over-cap timeout), so it can never be the entry the node
signs. A fully valid sibling that merely disagrees on `payTo`/`amount` is
NOT skippable and still reaches the fence. And `narrowToChosenRequirement`
forwards exactly one entry, so the node's own selection rule is
irrelevant either way; even without it the node would see a strict subset
of today's entries, all of them fully validated.

**The sanitizer no longer rethrows.** Round 4 made `canonicalJsonKey`
swallow every throw because a throwing enumerable getter escaped as a
plain `Error`; the sibling recursive walker over the same
attacker-authored value kept its narrow catch. `walk` reads `source[key]`,
so any throwing property read escaped `stripPrototypePollutingKeys` and
through it `normalizeX402PaymentRequired`, whose declared contract is
`Result<X402PaymentRequired, string>` (measured: `canonicalJsonKey ->
undefined`, the other two `-> THREW TypeError`). This walker runs FIRST
and is the choke point that rebuilds the payload into plain data before
zod sees it (`safeParse` throws on the same input). Same reachability
round 4 accepted: `JSON.parse` output cannot carry a getter, so no live
transport triggers it, but a caller handing the exported normalizer a
hand-built payload can, and a throw there is an unhandled 500 where the
contract is a fail-closed `err`. The message is FIXED rather than the
thrown error's own, which is attacker-authored and unbounded.

**`payment-required.schema.ts` split three ways** to stay under the
750-line ceiling, by responsibility rather than line count:
`payment-required.wild.ts` owns what Soko may READ (the lenient v1/v2
dialect shapes, the per-field translations, `dropShadowKeys`,
`selectPayableRequirement`); `payment-required.supported.ts` owns the
option allowlists and the `extra`/`extensions` map shapes both sides need
(so neither imports the other); the schema file keeps what Soko may EMIT.

**Review premise that was wrong.** The cycle guard in
`payment-required.canonical.ts` (and its twin in the sanitizer) is NOT
unreachable behind the depth guard: `ancestors` holds the objects on the
CURRENT path, so a self-referencing value trips it at depth 1 — verified
by instrumenting the built module (`[reached the cycle guard at depth 1]`)
and observable directly in the sanitizer, which answers `contains a
circular reference` for a shallow cycle and `nested deeper than 64 levels`
for a 100-long loop. It was merely indistinguishable by an `isErr`
assertion, so deleting it left the suite green. Both halves are now pinned
by message.

**Also:** the top-level STRING arm of the wild `resource` union is covered
(a normalizer reading only `resource.url` left all 92 tests green);
`X402_MAX_ENCODED_PAYLOAD_LENGTH` is pinned two-sided like
`X402_MAX_TIMEOUT_SECONDS` (raising it to 256 MB kept the suite green);
the `dropShadowKeys` prototype-key comment is corrected — the sanitizer
removes those keys before the wild schema parses, so `unknownKeys` can
never hold one and the filter never fires (kept as belt and braces).

**Mutation-tested.** Per-entry selection: `continue` → `return err` kills
14; pooling resource URLs only over selectable entries kills 1; dropping
the no-survivor guard kills 9 (and everything still fails closed, via
`min(1)`); dropping the scheme / transfer-method / timeout check kills
2 / 1 / 1. Sanitizer: restoring `throw error` kills 2; echoing the thrown
error's own message kills 1; deleting the cycle guard now kills 1.
Coverage additions: ignoring a top-level string `resource` kills 2;
raising the encoded-payload cap kills 1. All restored green.

**Verification:** `pnpm --filter @sokosumi/masumi test` 17 files / 342
passed; `pnpm --filter core test` 357 files / 3275 passed (2 files / 6
skipped); `pnpm typecheck` all workspaces; `pnpm check` clean.

### Step-3 sixth review (confirmation) — two test-quality fixes — 2026-08-13

**Verdict: clean on security.** The confirmation round found both round-5
fixes correct, the three-way file split behaviour-preserving, and no
fund-diversion, fail-open or new DoS path. It left exactly two
test-quality findings, both of them coverage a comment CLAIMED and the
suite did not have. No production behaviour changed in this round.

**1. The raw `scheme` length cap was covered by a vacuous assertion.** The
oversized-strings test asserted only `isErr()` on a 65-character
`scheme`, and the scheme ALLOWLIST refuses that value regardless of its
length — so `.max(X402_MAX_RAW_SCHEME_LENGTH)` could be deleted from
`wildRequirementSchema` with all 112 x402 tests green; the payload merely
failed one fence later with a different message. The cap is triply
redundant (a 1 MB scheme is refused by `boundedMapCheck`, and the echo is
bounded by `truncateEcho` at 78 either way), so the impact was nil — but
it is exactly the pattern earlier rounds kept catching. The case now has
its own test asserting the MESSAGE on both sides of the cap: 65 characters
gives `Unparseable x402 402 payload: … <=64 characters … accepts[0].scheme`
and never `Unsupported x402 scheme`; 64 characters parses and gives
`No payable x402 requirement in accepts … Unsupported x402 scheme`.

**2. The output schema's half of the safety argument had zero tests.** The
stated invariant is that the wild schema loosens three fields so a payload
with an unsupported option still parses, and `x402PaymentRequirementsSchema`
re-imposes all three on whatever survives selection. Every test of the
re-imposition went through `normalizeX402PaymentRequired`, where
`selectPayableRequirement` refuses the same values FIRST, so the emitted
half was unpinned: four mutants survived. Node-shape entries are now fed
DIRECTLY into the exported schemas, and the supported counterparts are
asserted to pass so the bounds cannot be met by refusing everything. No
exploit today — selection catches all four and the exported schemas have
no consumer outside the module at this commit — but a later branch imports
from this package, and this is the layer the comments call load-bearing.

**Mutation-tested (all five went red, all restored green).**

```
wild.ts    scheme .max(64) deleted          -> kills 1 (the new cap test)
schema.ts  scheme z.enum -> z.string()      -> kills 1
schema.ts  maxTimeoutSeconds .max() dropped -> kills 1
supported  assetTransferMethod literal      -> kills 1
           -> z.string()
schema.ts  accepts .min(1) -> .min(0)       -> kills 1
```

**Optional observation, taken as a comment.** An entry serialized at
8186–8192 characters carrying a v1 network name grows past
`X402_MAX_SERIALIZED_LENGTH` when `base` expands to `eip155:8453` (+7),
and the trailing `safeParse` then refuses the whole payload including a
payable sibling. Measured and confirmed (`base` fails at wild length 8186,
`eip155:8453` only at 8193). Not a finding — fail-closed, identical to
pre-change behaviour, only the resource server can author it, and 8 KiB
entries are orders of magnitude past any live listing — so the asymmetry
is documented on the constant (the ceiling is applied to the wild entry
before translation and to the emitted entry after) rather than
special-cased.

**Verification:** `pnpm --filter @sokosumi/masumi test` 17 files / 345
passed (115 of them x402); `pnpm --filter core test` 357 files / 3275
passed (2 files / 6 skipped); `pnpm typecheck` all workspaces;
`pnpm check` clean.
## Sub-component 4 — readiness wiring + listing endpoint (`x402-4-listing`) — 2026-08-11

**Branch:** `x402-4-listing`, cut from `x402-3-helpers` (clean tree).

### Readiness wiring

`syncX402BuySideReadiness` now runs in `/sync/agents`
(`apps/core/src/routes/sync/agents/get.ts`), after the Cardano readiness
refresh and before the registry replay, with the identical
`AbortSignal.any([cron signal, AbortSignal.timeout(10_000)])` treatment.
Imported from `@/services/agent-sync.x402-readiness` directly — NOT through
`agentSyncService` because readiness has no dependency on that service.
Decision: an x402
readiness change does **not** reset the registry cursor — the listing reads
`getX402ReadySources` at request time, nothing readiness-dependent is baked
into agent rows (Cardano readiness differs: it feeds the projected
availability filters). `routes/sync/index.test.ts` mock extended; new tests
pin the sequencing, the abort signal, and the no-reset decision.

### Listing endpoint — `GET /v1/agents/x402`

> **Superseded.** That dedicated route was dropped. Listing is public
> `GET /v1/agents?kind=x402` on the unified catalog. The notes below are
> the original sketch.

- **Route:** `apps/core/src/routes/v1/agents/x402/get.ts`, mounted on the
  authed agents sub-router **before** `mountGetAgentById` so the static
  `/x402` segment can never be captured by `/{id}`.
- **Authz:** `isCoworkerAgentContext` or `403 forbidden("Coworker agent
  authentication required")` — users, orchestrators, and context-carrying
  (delegated) coworkers all rejected; same gate the pay endpoint must use.
- **Schemas:** `apps/core/src/schemas/x402-agent.schema.ts` —
  `x402AgentPaymentSourceSchema` (`X402AgentPaymentSource`),
  `x402AgentSchema` (`X402Agent`, OpenAPI component names `X402Agent` /
  `X402AgentPaymentSource`), `x402AgentsSchema` (array).
- **Fail-closed composition:** empty `getX402ReadySources` (incl.
  never-recorded) returns `[]` before any catalog read; SQL filters
  `type: X402, status: ONLINE, x402ResourcesUrl != null`; Mainnet also
  requires `isShown: true`, while Preprod intentionally bypasses curation;
  per agent `buildX402AgentPaymentSources`
  (`apps/core/src/helpers/x402-agent-listing.ts`) requires EVERY advertised
  source to pass every gate — FIXED pricing with ≥1 amount row, `payTo`
  present, decimals recorded, `isX402NetworkAllowed`, `isX402SourceReady`,
  positive CAIP-19 CreditCost row via `calculateCentsFromX402Amount` — one
  failure hides the agent (`null`), because the agent picks which source its
  402 demands. Response per source: `caip2Network` (lowercased), `asset`
  (lowercased), `decimals`, `payTo`, `amount` (base-unit string), `credits`
  (`convertCentsToCredits`, charge-floored).

### Verification

- `pnpm --filter core test` — 359 files passed (3288 tests), incl. new
  `x402-agent-listing.test.ts` (13), `x402/get.test.ts` (9),
  and extended sync suite (35).
- `pnpm --filter @sokosumi/masumi test` — 14 files, 251 passed.
- `pnpm typecheck` all workspaces; `pnpm format` + `pnpm check` clean.
- Mutation-tested (disable → watch fail → restore → green): readiness-pair
  gate, network allowlist, unpriced-asset drop (catch→continue), readiness
  fail-closed early return, authz gate, `isShown` curation filter. Each
  killed by a dedicated test.
- File sizes: route 111, helper 110, schema 68 — all under 750.

### What sub-component 5 (pay endpoint) needs to know

- **Reuse, don't re-derive:** the listing's per-source predicate in
  `buildX402AgentPaymentSources` is exactly the §3 pre-charge verification
  set. For a forwarded 402, verify the demanded (payTo, network, asset)
  against the agent's `AgentPaymentSource` rows, then
  `isX402NetworkAllowed(network, getEnv().NETWORK)` +
  `findX402ReadySource(network, asset, readySources)` — the returned pair
  carries the `evmWalletId` to pass to `POST /x402/pay` — then
  `calculateCentsFromX402Amount` for the charge (it already throws 422
  fail-closed on unpriced/malformed).
- **Authz pattern to copy:** `requireTaskCollaboration` +
  `isCoworkerAgentContext` (see the `masumiPayment` gate in
  `routes/v1/tasks/[id]/events/post.ts`); the listing's bare
  `isCoworkerAgentContext` check is the taskless subset.
- **Route mounting:** task-nested pay route goes under
  `routes/v1/tasks/[id]/x402-payments/post.ts` per the spec's assumed path;
  nothing in this step constrains it.
- **Sanity check anchor:** the listing advertises `amount`/`credits` from
  the registered `AgentPaymentSourceAmount` rows — the §3 "demanded amount
  passes a sanity check against registry pricing" should compare the 402's
  demand against those same rows.
- **Still open (step-2/3 carryover):** bound `idempotencyKey` in the pay
  route Zod (max ~200) before it reaches the btree unique;
  `agent-sync.service.ts` is 974 lines — over the ceiling, do not append,
  extract when touched.

### Step-4 review — the listing consumes the node's decimals

**The listing now prices off `X402ReadySource.decimals`, not the registry's.**
This is the step-4 half of the step-3 fourth-review handoff.
`buildX402AgentPaymentSources` swapped `isX402SourceReady` for
`findX402ReadySource` and takes both the charged and the advertised
`decimals` from the returned pair. The row's own `decimals` stays a
registry sanity gate (`missing_decimals` — a FIXED row recording no scale
is malformed) but never reaches `calculateCentsFromX402Amount` or the
response. Before: an agent registering `decimals: 18` for 6-decimals USDC
advertised `credits: 1e-10` for 250000 base units — a real dollar at the
`MIN_CHARGEABLE_CREDITS` floor. After: 0.5 credits.

Consequence for the dedupe: `conflicting_price` compares
`advertised.decimals`, which the triple's own (network, asset) now selects,
so two entries under one key always carry the same scale and only `amount`
can differ. Duplicate rows disagreeing ONLY on registry decimals therefore
collapse into one entry instead of dropping the agent — correct, since they
price identically. The comparison stays as an invariant guard; the test that
asserted the old drop was rewritten to assert the collapse.

Also fixed: `get.test.ts`'s `seedReadiness` wrote pairs with no `decimals`,
which `getX402ReadySources` (parent branch) drops — 11 route tests were red
on the branch tip for that reason alone, independent of typecheck.

**Two vacuous tests pinned** (both green under deletion of the code they
nominally guard):

- `toAdvertisedPriceKey`'s `payTo.toLowerCase()`. New two-source test:
  checksummed `0xAbCd…` at 250000 vs the same address lowercased at 5000000
  → `conflicting_price`. Without the fold both advertise (0.5 AND 10 credits
  for one recipient) and the pay side's case-insensitive match resolves to
  the 250000 row, killing the 10-credit advertisement after the coworker
  already called the agent.
- The per-source `amounts.length === 0` gate, masked by the tail guard's
  identical `no_amount_rows` reason. New test: source 0 empty + source 1
  priced → dropped. Without the gate the empty source is skipped and the
  agent is LISTED — per-agent fail-closed degraded to per-source skip. Third
  test in this file with that masking shape.
- The tail guard at the end of the loop is genuinely unreachable (deleting it
  kills nothing, as its comment says). Kept as defence: the response schema
  requires ≥1 advertised source, so an empty list must drop, not 500.

**Mutation results:** registry decimals restored as the pricing input → 4
tests red (`credits: 1e-10, decimals: 18` vs `0.5, 6`), including the route
test; `missing_decimals` gate deleted → 1 red; ready-pair drop deleted → 1
red; `payTo` fold deleted → 1 red; per-source amount gate deleted → 1 red.
All restored green.

`isX402SourceReady` is deleted with this change: the listing was its last
caller, and every consumer in the stack now needs the pair itself (the
node's `decimals` here, `evmWalletId` on the pay side). Its two uncovered
cases moved into `findX402ReadySource`'s describe.

**Verification:** `pnpm --filter core test` 361 files / 3349 passed (6
skipped); `pnpm typecheck` all workspaces; `pnpm check` clean. Listing
helper 269 lines — under the 750 ceiling (its 717-line test is exempt, but
the route test is at 715 and should be split by concern before it grows).

### Step-4 fourth review — docs provenance, unasserted query shape, warn volume

Round 4 confirmed the round-3 fixes (53 mutations, no fourth vacuous test)
and left four LOW issues. All four are now closed.

**The OpenAPI `decimals` description still named the untrusted source.** The
round-3 change moved the value's provenance to `X402ReadySource.decimals`
but touched only `x402-agent-listing.ts`; the published description still
read "Asset decimals from the agent's registry entry". `decimals` scales the
charge inversely, and the agent-authored value was the 10^n mischarge this
stack closed — so the stale line invited a maintainer reconciling code
against docs to swap `readySource.decimals` back to `amount.decimals`. It
now states the payment node publishes it for that (network, asset) pair and
that it is never the agent's registered value, with a code comment naming
the safe source. The sibling fields were checked and are accurate: `amount`
and `payTo` genuinely are the registry's, and `credits` really is
charge-floored (`calculateCentsFromX402Amount` ceils, then floors at
`MIN_CHARGEABLE_CREDITS`). No test asserts doc strings anywhere in core, and
none was added — the behavioural guard ("advertises the cached node decimals
over the agent's registered scale") already covers the regression path.

**Two mechanisms in the route were unasserted** — deleting either left all
21 tests green, the strongest survivors in the file.

- `AGENT_PRICING_READ_TRANSACTION_OPTIONS` was invisible because the prisma
  mock's `$transaction` discarded its second argument. It is a `vi.fn()` now
  and the RepeatableRead level is asserted against the REAL constant (this
  suite does not mock `@/helpers/agent`, unlike the catalog route's test).
  Without the snapshot, Prisma issues the agent / paymentSources / amounts
  reads as separate statements and a registry replay committing mid-read
  yields a FIXED source with a partial amount set — listed-but-unpayable.
- The `{ id: "desc" }` cursor tiebreak. `agentOrderBy` is
  (jobCount, createdAt) and is not unique, so without a unique final key
  cursor pagination can skip or repeat agents sharing that pair.

**Warn volume was client-driven.** `logX402ListingDrops` warned whenever a
page listed nothing while dropping something, and BOTH inputs are
client-selectable: `?limit=1&cursor=<id before an unpayable agent>` emits one
`console.warn` per request on a healthy deployment, loopable by any
authenticated coworker. `limit` alone suffices — it narrows the page until a
single unpayable agent IS the page. That is the gap the empty-page case was
written to close. Of the two offered fixes, the warn was restricted to the
unfiltered first page (no cursor, default limit) rather than demoted to
`debug`: demoting would delete the "listing is broken" signal outright, since
the repo has no rate-limited log sink to hand it to. On the unfiltered first
page the client chooses neither which agents appear nor how many, so a
healthy deployment emits zero warns under any traffic. Accepted cost: a
genuinely broken deployment still logs once per unfiltered request; a
module-scoped rate limiter was rejected as per-instance mutable state in a
route handler. The per-reason tally is untouched and every demoted case still
reports it at debug — the env-separation test depends on that.

**Mutation results:** isolation option deleted → 1 red
(`reads the page and its count in one repeatable-read snapshot`); `{ id:
"desc" }` deleted → 1 red (`breaks the non-unique catalog order with a unique
id tiebreak`); warn gate reverted to `listedCount === 0` → 2 red (the
cursored and narrowed all-dropped pages). All restored green, and all three
re-run after the test split below.

**Test split.** The route suite hit 839 lines, past the point round 3 flagged
("at 715 and should be split by concern before it grows"). Split along the
boundary it already had: `get.query.test.ts` (9) covers how the route asks
Postgres for its page — pagination, cursor and tiebreak, relation ordering,
snapshot isolation, column narrowing; `get.test.ts` (16) keeps authorization,
the fail-closed gates, and drop logging. Builders moved to `get.fixtures.ts`
(not a `*.test.ts` name, so vitest's `src/**/*.test.ts` include skips it);
only the `vi.hoisted` mocks stay per-file, which `vi.mock` scoping requires.
No test added, removed, or reworded — 25 before, 25 after.

The move surfaced a latent typing weakness: `COWORKER_AGENT_CONTEXT` was
annotated with the whole `AuthenticationContext` union and only compiled
because an in-file `const` narrows back to its initializer's member. Once
imported, the delegated-coworker test's spread of `context` was an excess
property against `UserAuthenticationContext`. Typed as
`CoworkerAuthenticationContext` now, which is what it always was.

**Web client:** not regenerated, deliberately. Nothing under `apps/web/src`
references this endpoint, and the tracked Core client carries no `X402Agent`
or `X402AgentPaymentSource` at all — coworker agents call Core directly, so
PR4 never wired the listing into web. A description-only change to a schema
web does not import has nothing to regenerate.

**Verification:** `pnpm --filter core test` 361 files / 3353 passed (6
skipped); `pnpm typecheck` all workspaces; `pnpm check` clean. Route 239
lines, listing helper 269, schema 76, fixtures 136 — all under 750; the two
test files are 565 and 273.
## Sub-component 5 — pay endpoint (`x402-5-pay`) — 2026-08-11

**Branch:** `x402-5-pay`, cut from `x402-4-listing` (clean tree). Three
feature commits (masumi client, database column, core endpoint) plus this log
entry.

### Client — `payX402` (`@sokosumi/masumi`)

- New `packages/masumi/src/clients/masumi-payment-x402.ts`: the x402 client
  methods (the two step-3 readiness reads plus new `payX402`) moved out of
  `masumi-payment.client.ts` (was heading past the 750 ceiling; now 581) and
  are spread into `createPaymentClient`'s return, so callers see one client.
  Shared `extractNodeErrorMessage` moved to `clients/node-error.ts`.
- `payX402(input, { signal? }): Result<X402SignedPayment, X402PayFailure>` —
  never throws. Error taxonomy per 011 Q1: an HTTP **non-200 ⇒ `"refused"`**
  (no header issued, refund-safe inline; carries `status` + node message); a
  thrown transport error, abort, or **malformed 200 ⇒ `"ambiguous"`** (a
  header may exist that was lost in transit — still unsettleable, but the
  PENDING record is the reconciler's, never an inline refund). Optional
  request keys (`paymentIdentifier`, `preferred*`) are omitted — not sent as
  undefined — so the identifier gate actually holds on the wire.
- Exports added to `clients/index.ts` (curated list): `X402PayInput`,
  `X402PayFailure`, `X402SignedPayment`.

### Database — `xPaymentHeader` column

- PR1-SPEC §3.2 ("return its stored result verbatim") is unimplementable
  without storing the header: it cannot be reconstructed from the §4 columns
  (only `paymentPayloadHash` is stored), and re-signing on replay reserves a
  new node attempt and burns budget (011 Q2). Added nullable
  `TaskX402Payment.xPaymentHeader`, written only at VERIFIED. Migration
  `20260811150000_task_x402_payment_header`, idempotent; validated on a
  scratch DB (full deploy from zero, direct psql re-apply no-op, migrate
  diff shows no x402 drift).

### Endpoint — `POST /v1/tasks/{taskId}/x402-payments`

- **Split:** route thin (`routes/v1/tasks/[id]/x402-payments/post.ts`, 94
  lines — schema wiring and outcome mapping only); flow in
  `services/task-x402-payment.service.ts` (647); refusal refund in
  `services/task-x402-payment.refund.ts` (118); the 402↔agent matcher in
  `helpers/x402-payment-verify.ts` (159); request/response Zod in
  `schemas/x402-payment.schema.ts` (`idempotencyKey` bounded min 1 / max 200
  — step-2 carryover closed).
- **Charge machinery reused, not copied:** `chargeTaskCreditsOrMarkOutOfCredits`
  + `OUT_OF_CREDITS_PAUSE_STATUSES` extracted from the task-events route into
  `helpers/task-event-charge.ts`, and the status-notification dispatch into
  `helpers/task-notifications.ts`; `events/post.ts` now imports both and
  lands at 728 — back under the 750 ceiling. `settleTaskEventCharge` itself
  is untouched: x402 does not flow through POST /events, so no branch was
  added there — the x402 service creates its own credit-bearing task event
  (`cents` + `transactionId` + `coworkerId`, status null) and links it via
  `taskEventId`, exactly the masumiPayment shape.
- **Order of operations (§3):** coworker-agent gate (403) →
  `requireTaskCollaboration` → idempotency probe on the
  `[taskId, idempotencyKey]` unique → normalize → agent lookup with the
  listing's SQL gates (`type: X402, status: ONLINE, isShown: true`; miss =
  404 — not-listed must not be payable via a remembered id) →
  `verifyX402DemandAgainstAgentSources` (FIXED source, payTo/network/asset
  match, per-env allowlist, decimals recorded, demand ≤ advertised amount,
  and same-pair `accepts` entries must agree — the node is only restricted
  by `preferredNetwork`/`preferredAsset`, so a disagreeing sibling entry on
  the chosen pair could be what it signs) → ready pair via
  `findX402ReadySource` (carries the `evmWalletId` that is sent to the node)
  → `calculateCentsFromX402Amount` → charge + task event + PENDING record in
  ONE serializable transaction → `payX402` with `preferred*` pinned to the
  verified pair and `paymentIdentifier` = `"{taskId}_{paymentId}"` (joined with
  `_`, not `:`, to satisfy the node's `^[a-zA-Z0-9_-]+$`) ONLY when
  `isX402PaymentIdentifierAdvertised`.
- **Amount sanity decided as demand ≤ advertised:** a 402 may demand less
  than the registered fixed price (per-resource pricing under the advertised
  ceiling — charges fewer credits, safe) but never more (the manipulated-402
  overcharge the check exists for).
- **Resolve:** 200 → VERIFIED with attemptId, header, signed tuple, and the
  phased-settlement observation fields (`payerAddress` = response `payer`,
  `paymentPayloadHash`, plus `payloadNonce`/`validBefore` extracted
  best-effort from `paymentPayload.payload.authorization` — shape drift
  stores nulls, never fails a signed payment). Refusal → synchronous
  compensating refund (claim-refund shape: FAILED + refund transaction +
  non-expiring REFUND bucket `task-x402-payment:{id}`, atomic, idempotent)
  then node-400 → 422 (the coworker's 402 is the problem), node-402/500 →
  502. Ambiguous → 502 "retry with the SAME idempotencyKey", record stays
  PENDING — refund-safe per 011 Q1; the reconciler is deliberately NOT
  built here.
- **Idempotent replay:** VERIFIED → stored result verbatim (needs the new
  column); PENDING → re-sign against the STORED tuple (supplied 402 must
  still contain that exact demand and the same agentId, else 409 — a reused
  key never silently re-targets); FAILED/REFUNDED → 409 carrying the stored
  `failureReason` with kind `x402_payment_key_consumed` — the key is
  consumed because its debit was already compensated, and a replay cannot be
  told apart from a new intent accidentally reusing the key. Insert races
  map P2002-on-idempotencyKey to a retryable 409
  (`isIdempotencyKeyUniqueConstraintError`, `helpers/prisma.ts`).
- New `badGateway` (502) error helper + `BadGateway` in `getErrorName`.

### Verification

- `pnpm --filter core test` — 361 files passed (3332 tests), incl. new
  `x402-payments/post.test.ts` (29) and `x402-payment-verify.test.ts` (14);
  `pnpm --filter @sokosumi/masumi test` — 14 files, 256 passed;
  `pnpm --filter @sokosumi/database test` — 245 passed.
- `pnpm typecheck` all workspaces; `pnpm format` + `pnpm check` clean.
- Mutation-tested (mutate → dedicated test fails → revert → green): the
  idempotency replay branch (6 tests fail), the floored CAIP-19 pricing call
  (3), the refund-on-refusal branch (2), the identifier-only-when-advertised
  gate (1).
- File sizes: service 647, refund 118, verify 159, route 94, schema 73,
  task-event-charge 63, task-notifications 150, events/post.ts 728,
  masumi-payment.client.ts 581, masumi-payment-x402.ts 249 — all under 750.

### What sub-component 6 (admin surface, §5) needs to know

- **Record shape at rest:** VERIFIED rows always carry `attemptId` +
  `xPaymentHeader` + the signed tuple; `payloadNonce`/`validBefore` are
  best-effort nullable (payload-shape drift stores nulls). FAILED rows from
  the automated flow ALWAYS carry `refundTransactionId` (refusal refund is
  atomic with the status flip) — an admin "refund" on such a row must
  recognize it is already compensated (`refundRefusedTaskX402Payment`
  returns false). PENDING rows are the crash window: refund-safe, replayable
  by the coworker, reserved for the future reconciler.
- **`failureReason` semantics:** written only by the refusal path (node
  status + message, sliced to 2000 via
  `TASK_X402_MAX_FAILURE_REASON_LENGTH`) and surfaced verbatim in the 409
  replay answer — treat it as operator- and coworker-visible text.
- **Aggregation:** the §5 per-endpoint dashboard groups by `agentId` over
  `status` — the `@@index([agentId, status])` backs exactly
  `groupBy(agentId) + count by status`; refund count = FAILED/REFUNDED rows
  with `refundTransactionId != null`.
- **Where to build:** the operator refund belongs next to
  `task-x402-payment.refund.ts` (that seam was split out for §5); the
  append-only `TaskX402PaymentAction` (`"refund" | "resolve"` strings, step-2
  reservation) is still unused — the admin surface writes the first rows.
- **`xPaymentHeader` is a bearer instrument — MUST NOT leak (step-5 review,
  finding 7).** A VERIFIED row's `xPaymentHeader` is a signed X-PAYMENT header:
  a bearer authorization anyone can replay to move the buyer's funds until
  `validBefore` passes. It is secret to everyone except the coworker who
  received it once in the pay response.
  1. **Admin list/detail (§5) MUST exclude `xPaymentHeader`.** The per-endpoint
     aggregation groups by `agentId` over `status` and never needs the header;
     select columns explicitly (never `include`/`select: undefined` the whole
     row) so a support/admin surface can't hand out a live authorization. The
     schema.prisma doc comment on the column now says this.
  2. **The future reconciler MUST NULL `xPaymentHeader` once `validBefore`
     passes.** After expiry the header can no longer settle, and a permanently
     stored bearer value is pure liability. The reconciler's expiry scan
     (`@@index([status, validBefore])`) is the natural place: on the
     EXPIRED_UNUSED → auto-refund transition, also `xPaymentHeader = null`.
- **Carryover:** `agent-sync.service.ts` is still 974 lines — over the
  ceiling, do not append, extract when touched.

### Step-5 review fixes (same branch) — 2026-08-11

Money-path review of the pay flow. Two reds fixed with failing-first tests and
mutation checks; the rest are hardening + handoff notes.

**RED 1 — poisoned PENDING/VERIFIED replay could pay an attacker.** The fresh
path verifies the demand against the agent's sources
(`verifyX402DemandAgainstAgentSources`), but both replay branches skipped it:
the PENDING branch only did a `.some()` match against the stored tuple, so a
replay carrying the stored entry PLUS a sibling on the same (network, asset)
pair (`{huge amount, attacker payTo}`) passed, was forwarded whole, and the
node — pinned only by `preferredNetwork`/`preferredAsset` — could sign the
sibling, paying the attacker at the original small credit price (finalize then
overwrote the record with the attacker's tuple). The VERIFIED branch returned
the stored header for any request, even a different `agentId`/402. Fix
(`task-x402-payment.service.ts`): new `assertReplayMatchesStoredDemand` runs on
BOTH replay branches before returning a header or re-signing — agentId must
equal the stored record's, `verifyX402DemandAgainstAgentSources` must pass over
the FULL supplied 402 (its same-pair-agreement guard kills the sibling), and
the verified demand must equal the stored `(caip2Network, asset, payTo,
amount)` tuple. Any mismatch → 409 `x402_payment_key_reused` (distinct from the
FAILED/REFUNDED `x402_payment_key_consumed`). The fresh-path agent lookup was
extracted to `findListedX402Agent` and reused. Tests: poisoned-sibling PENDING
replay → 409, node never called; per-leg 409 (differing payTo/network/asset/
amount); VERIFIED replay with a different agentId or a mismatched 402 → 409;
clean same-key replays still return the stored result. Mutation: disabling the
re-verification makes the poisoned-sibling + mismatch tests fail; reverted.

**RED 2 — a malformed 200 could corrupt a VERIFIED row unrecoverably.**
`payX402` did `ok(response.data.data)` with no runtime validation, so a 200
with `attemptId` present but `xPaymentHeader` (or any signed-tuple field)
missing/empty flowed through as SIGNED → `finalizeVerifiedTaskX402Payment` wrote
VERIFIED with a NULL header → the route's zod 500s, every replay 500s forever
(`buildStoredSignedResponse` throws), and refund refuses VERIFIED — unrecoverable
without DB surgery. Fix (`masumi-payment-x402.ts`): `firstMissingSignedField`
requires `attemptId, xPaymentHeader, caip2Network, asset, amount, payTo` all
present non-empty strings (mirrors the `getX402Budgets` version-skew guard); any
miss → `kind: "ambiguous"` (NOT `"refused"` — a maybe-signed 200 must never
trigger an inline refund; ticket 011 Q1's safety is non-200 only), so the record
stays PENDING for the reconciler. Test: the existing "treats a 200 without usable
data" client test extended with partial bodies (missing/empty header, missing/
empty attemptId, and each signed-tuple field). Mutation: bypassing the guard
makes the partial-body test fail; reverted.

**Malformed-200 taxonomy (finding 5, folds into RED 2).** The incomplete-200
case is now explicitly `"ambiguous"`, not silently `ok`. This is why the pay
service's ambiguous branch (record stays PENDING, no VERIFIED write, no refund)
is the correct sink; its route test already pins that behavior.

**Finding 3 — refund double-guard now tested.** `refundRefusedTaskX402Payment`'s
`claimed.count === 0` double-refund guard was untested (the mutant survived).
New `task-x402-payment.refund.test.ts`: already-compensated (count 0 +
FAILED/REFUNDED + `refundTransactionId` set) → returns false, creates no second
refund; a VERIFIED record → throws; the happy path claims PENDING→FAILED and
creates the refund once. Mutation (`claimed.count === 0` → `false`) is killed by
the already-compensated + VERIFIED tests.

**Finding 6 — false refund promise softened + stuck-PENDING now visible.** The
PENDING-replay "pair no longer buy-side ready" 502 message promised a refund
nothing delivers (no reconciler yet, nothing pages). Reworded to "The held
charge stays on a pending record until reconciled or refunded by support," and
that branch now emits a `Sentry.captureMessage` (`error_type:
task_x402_payment_pending_held`) so ops sees held charges before the reconciler
ships. The ambiguous-node-result branch already paged
(`task_x402_payment_ambiguous`). **Reconciler requirement (still unbuilt, for a
later PR):** an auto-refund sweep over stale PENDING rows (`@@index([status,
validBefore])`) that refunds provably-unpaid held charges without consulting the
node — the Sentry captures are the interim manual signal until it exists.

**Finding 7 — header-storage handoff rewritten.** See the two bullets added to
"What sub-component 6 needs to know" above (exclude `xPaymentHeader` from admin
responses; reconciler NULLs it once `validBefore` passes) and the corrected
schema.prisma doc comment. No code shipped here beyond the comment — the admin
surface (§5) owns the exclusion.

**Finding 8 — idempotencyKey whitespace rejected.** The request zod now rejects
a blank or whitespace-padded `idempotencyKey` (`refine`: `value === value.trim()
&& value.trim().length > 0`). `"key"` and `"key\n"` are distinct btree slots, so
a padded duplicate of a live key would mint a SECOND charge for the same 402;
rejecting (not silently trimming) keeps the coworker sending the exact key back.
Tests cover `"  "`, `"\t\n"`, and leading/trailing-padded keys → 422 before any
transaction.

**Deferred as notes (not refactored this PR):**
- **Scattered error kinds.** The pay flow's `kind`s (`x402_payment_key_reused`,
  `x402_payment_key_consumed`, `x402_payment_key_in_flight`, `x402_pay_refused`,
  `x402_pay_outcome_unknown`) are defined inline at throw sites, not in a shared
  registry like `CORE_API_ERROR_KINDS`. Consolidating them is a follow-up; do
  not churn the taxonomy inside this money-path PR.
- **Double-call burns node budget, never user funds.** A retry that reaches the
  node reserves a new attempt and decrements node budget (ticket 011 Q2). Soko's
  `[taskId, idempotencyKey]` unique is the sole user-funds dedupe; the
  PENDING-replay re-sign path is the only place a second node call happens, and
  it is now gated by `assertReplayMatchesStoredDemand`. A budget-side idempotency
  note for the node team stays open (011 Q2).

### Step-5 review verification

- `pnpm --filter core test` (full) — all suites pass, incl. the extended
  `x402-payments/post.test.ts` and the new `task-x402-payment.refund.test.ts`.
- `pnpm --filter @sokosumi/masumi test` — extended client suite passes.
- `pnpm typecheck` all workspaces; `pnpm format` + `pnpm check` clean.
- File sizes: `task-x402-payment.service.ts` 728, `masumi-payment-x402.ts` 284
  — both under the 750 ceiling; the replay-resolution logic stayed in the
  service (no extraction needed).

### Step-5 security + architecture audit fixes (same branch) — 2026-08-11

Security/architecture audit of the pay flow. Four security fixes (each with a
failing-first test; the two money-adjacent ones mutation-tested) plus three
architecture cleanups. No merged Cardano readiness/claim-refund code touched.

**M1 (medium) — a PENDING x402 payment silently wedged account deletion.**
`prepareTasksForUserDeletion`'s PENDING x402 guard blocked deletion with a clean
400 and deliberately did NOT page, on a comment premise ("auto-refunded by the
reconciler") that is FALSE — no reconciler exists in this stack. A PENDING
record (from an ambiguous node outcome) therefore blocked deletion permanently
and invisibly. Fix (`helpers/user-deletion-tasks.ts`): the PENDING guard now
`Sentry.captureMessage`s (`error_type: user_deletion_blocked_by_x402_pending`,
level `error`, extra `{ userId, taskX402PaymentId }`) mirroring the
review-required CLAIM branch; the user message routes to support ("A task
payment is still being reconciled; contact support to complete account
deletion."); the false comment and the top-of-file doc comment are corrected.
No deletion-time sweep built (out of scope; the reconciler is a later PR). The
existing "must not page" test was flipped to assert the capture (fails before
the change).

**L2 (low, defense-in-depth) — finalize trusted the node's returned tuple.**
`finalizeVerifiedTaskX402Payment` stored/returned `signed.{payTo,amount,
caip2Network,asset}` verbatim, so a compromised/skewed node could restate a
different payTo/amount than credits were charged for and have it written as
VERIFIED (and handed back as a live header). Fix (`task-x402-payment.service.ts`):
before writing VERIFIED it asserts the signed tuple equals the charged demand
(same normalization as the verify path — lowercase payTo/network/asset, exact
amount string; the charged demand is threaded through the `sign` charge-phase
outcome). On mismatch it does NOT write VERIFIED, leaves the record PENDING,
pages `error_type: task_x402_payment_signed_mismatch`, and throws the ambiguous
502 (`x402_pay_outcome_unknown`). Test: node echoes a different payTo/amount →
502, record stays PENDING, no header. **Mutation-tested** (guard → `if (false)`
→ the mismatch test fails 502→200; reverted, clean tree).

**L1 (low) — raw node error leaked to the coworker on 402/500.**
The 402/500 refusal branch put `extractNodeErrorMessage(node error)` verbatim
into the 502 body (may carry wallet/budget internals). Fix: 402/500 now return a
generic message ("Payment could not be completed due to an operational error;
retry later. Credits were refunded; use a new idempotencyKey for a new
attempt."); the raw detail stays in the existing Sentry capture
(`task_x402_payment_refused`, `extra.reason`) only. The 400 branch stays verbose
(the coworker's own payload fault). The existing budget-refusal test was flipped
to assert the generic body + Sentry-carried detail; a `requirements drift`
assertion locks in "400 stays verbose".

**L3 (low) — uncapped PENDING re-sign burned node budget under node skew.** FIXED
WITH A MIGRATION (chose the counter over documenting-skip so the money-adjacent
logic is real and mutation-tested; the reconciler will reuse the column).
`TaskX402Payment.signAttemptCount Int @default(0)` (migration
`20260811160000_task_x402_payment_sign_attempt_count`, idempotent `ADD COLUMN IF
NOT EXISTS`, timestamped after the header migration; validated on a scratch DB —
deploy-from-zero clean, column `integer NOT NULL default 0`, idempotent
re-apply). The fresh path sets the counter to 1 at record creation; each PENDING
replay increments it inside the charge-phase transaction (so an ambiguous/timed-
out node call still burns an attempt). At `TASK_X402_MAX_SIGN_ATTEMPTS` (5) a
PENDING replay refuses with 409 `x402_payment_sign_attempts_exhausted` before the
readiness lookup and before any node call, leaving the record PENDING for the
reconciler. User funds always safe; only node budget is bounded. Test:
`signAttemptCount: 5` replay → 409, node never called, counter not bumped.
**Mutation-tested** (cap → `if (false)` → the exhausted test fails 409→200;
reverted).

**SHOULD-2 — split `task-x402-payment.service.ts` (was 728, ceiling pressure).**
The replay/idempotency-resolution concern (`findListedX402Agent`,
`assertReplayMatchesStoredDemand`, `resolveExistingPayment`, plus the shared
`normalizeOrThrow` / `buildStoredSignedResponse` helpers, the
`StoredTaskX402Payment` / `ChargePhaseOutcome` types, and the
`TASK_X402_MAX_SIGN_ATTEMPTS` cap) moved to
`services/task-x402-payment.replay.ts` (326) with a new
`task-x402-payment.replay.test.ts` (15 direct unit tests). The service imports
them back and lands at **500**. Replay takes a local `X402ReplayInput` so it does
not depend on the service's public input type (no cycle; the service imports
runtime helpers + the outcome type from replay via a one-way edge).

**NICE-4 — `extractEip3009Authorization` moved** to a reconciler-adjacent home,
`helpers/x402-settlement.ts` (53, exports `Eip3009Authorization` +
`extractEip3009Authorization`), so the future reconciler and the pay producer
share one shape; the service imports it.

**NICE-7 — dropped the no-op `type AgentMetadataOverrideScalars =
AgentMetadataOverride;` alias** in `helpers/agent-metadata.ts`; every use now
references `AgentMetadataOverride` directly.

**Deferred to a follow-up PR (named, not done here):**
- **SHOULD-1** — shared readiness-sync helper, and **SHOULD-3** — shared refund
  helper: both modify the merged Cardano readiness/claim-refund code, out of
  scope for this x402-only pass.
- **NICE-6** — centralized error kinds: the pay flow's `kind`s
  (`x402_payment_key_reused`, `…_key_consumed`, `…_key_in_flight`,
  `…_sign_attempts_exhausted`, `x402_pay_refused`, `x402_pay_outcome_unknown`)
  are still defined inline at throw sites; consolidating into a shared registry
  (like `CORE_API_ERROR_KINDS`) is a follow-up — do not churn the taxonomy inside
  a money-path PR.
- **NICE-5** — the append-only `TaskX402PaymentAction` audit table is left as
  step-6's seam.
- **L4** — refund-expiry residual is pre-existing/accepted; unchanged.

### Step-5 audit verification

- `pnpm --filter core test` (full) — 363 files / 3366 passed (6 skipped), incl.
  the new `task-x402-payment.replay.test.ts` (15) and the extended
  `x402-payments/post.test.ts` (44) and `user-deletion-tasks.test.ts` (11).
- `pnpm --filter @sokosumi/masumi test` — 14 files / 257 passed.
- `pnpm typecheck` all 9 workspaces (exit 0); `pnpm format` + `pnpm check` clean
  (3152 files).
- Scratch-DB migration validation as above.
- File sizes: `task-x402-payment.service.ts` 500, `task-x402-payment.replay.ts`
  326, `task-x402-payment.refund.ts` 118, `helpers/x402-settlement.ts` 53,
  `helpers/agent-metadata.ts` 151, `helpers/user-deletion-tasks.ts` 217 — all
  under the 750 ceiling.

### Step-5 hardening pass (same branch) — 2026-08-12

Follow-on to the security pass above. Every premise was re-verified against the
code before the fix; one was rejected (see the last bullet).

**MONEY BUG — the charge still scaled by the AGENT-REGISTERED `decimals`.**
Branches 3 and 4 closed this on the listing side; the pay side still had it.
`cents = ceil(amount x centsPerUnit / 10^decimals)` with `centsPerUnit` in cents
per WHOLE token, so `decimals` divides the charge, and
`verifyX402DemandAgainstAgentSources` returned `amountRow.decimals` — a value the
agent authors on its own registry entry. An agent registering USDC on Base with
`decimals: 18` (true 6) floored its charge at `MIN_CHARGEABLE_CREDITS` while
Soko's managed wallet signed away a real USDC, and the advertised-price ceiling
could not see it because that compares the demand against the same
agent-registered amount. The verify path already resolved the `X402ReadySource`
for `evmWalletId` one statement earlier, so the node's authoritative
`defaultAssetDecimals` was in hand. `decimals` is off `X402VerifiedDemand`
entirely; the registry row's null-check stays as a **sanity gate only** (a FIXED
source with no scale is half-registered and the listing refuses it, so paying
against one would break "listed => payable"). Red: node 6 vs registry 18 charged
`1n` (the floor) instead of `5000000000n`. **Mutation-tested** (service re-reads
the registry row's scale → the pair test fails `5000000000n` → `1n`; reverted).

**Queued item (loose-scalar pairing) — CLOSED by the same change.**
`calculateCentsFromX402Amount` took `caip2Network` / `asset` / `decimals` as
three independent scalars, so nothing stopped one asset's identity being priced
with another's scale. It now takes `{ pair, amount }`, where `pair` is an
`X402PricedPair` that `X402ReadySource` satisfies structurally — identity and
scale from one row, and the only value that fits is the one the node vouched
for. Both call sites (pay + listing) pass `readySource` whole.

**Expired bearer headers were stored forever.** `xPaymentHeader` was written at
VERIFIED and never cleared, making every verified row a permanently stored bearer
credential long after its authorization could settle. `validBefore` was already
stored and `@@index([status, validBefore])` already existed; nothing swept them.
New `/sync/task-x402-payment-headers-purge` (hourly, `vercel.json`), following
the existing sync surface: `routes/sync/task-x402-payment-headers-purge/get.ts` +
`services/task-x402-payment.purge.ts`. Nulls the header on rows whose
`validBefore` has elapsed and keeps the row, status, amount, asset, network,
payer, nonce and both transaction links — only the credential goes. Filtered by
EXPIRY, not status: VERIFIED is the only status that writes a header today, but a
step-6 goodwill refund can move such a row to REFUNDED with the header attached,
and a status-scoped sweep would strand exactly those. The schema comment assigned
this to the unbuilt reconciler; it does not need one, because expiry is knowable
from a stored, indexed column. Comment updated. **Mutation-tested** (three
mutations — no-op `data`, dropped expiry predicate, `status: "VERIFIED"` scope —
each killed by a distinct test; reverted).

**Route body limit.** `X402_MAX_ENCODED_PAYLOAD_LENGTH` (256 KiB) bounded only
the base64 header branch, and its own doc named this route's `bodyLimit` as the
JSON-body companion — which did not exist. `paymentRequired` is `z.unknown()`, so
Hono parsed the whole body and `stripPrototypePollutingKeys` walked it before any
per-field cap applied (Vercel's 4.5 MB platform limit capped production only; a
self-hosted `@hono/node-server` has none). Added `bodyLimit` as
`X402_PAY_MAX_BODY_BYTES = X402_MAX_ENCODED_PAYLOAD_LENGTH` — the same number, so
the pair cannot drift — with both constants now naming each other, a 413 response
on the OpenAPI route, and a regenerated web client snapshot.

**Parsing and config reads left the serializable transaction.** `normalizeOrThrow`
(base64 decode, `JSON.parse`, sanitizer walk, BigInt conversions — attacker-sized
work, no DB access) ran inside the open SERIALIZABLE snapshot, and the
transaction also read the `SyncMetadata` readiness row and the whole `CreditCost`
table, making the readiness cron and any admin price edit a serialization-conflict
partner for every concurrent payment (spurious 409s). All three hoisted above the
transaction and passed in; `X402ReplayInput` now carries `normalized` +
`readySources`. **The trade:** both values are read a few milliseconds before the
charge commits. No guarantee weakens — neither is trusted on its own, each is
re-validated against THIS demand, and a stale read fails closed.
`findX402ReadySource` must still match the demanded pair pre-debit, and a pair
that has since stopped being ready is caught by the node refusing the sign (a
provable non-200, refunded synchronously); readiness is already last-known-value
and deliberately never expired on age, so milliseconds are indistinguishable from
the minutes the design already accepts. `calculateCentsFromX402Amount` still
fails closed on a missing/non-positive row and `maxCredits` still fences the
computed cents; SERIALIZABLE never made the price "current" either — it turned a
concurrent price edit into a 40001 the caller retried into the new price, so the
change is 409-then-retry versus charging at the price live microseconds earlier.
Atomicity of debit + task event + PENDING row, the atomic status claims, the sign
lease and the refund doctrine are all untouched. One accepted cost: a replay now
also reads `CreditCost` (one small config SELECT; only new failure mode is an
EMPTY table, a state in which the agent listing already 500s). One ordering
change: a malformed 402 now 422s before the task-collaboration check — it
discloses nothing, the message derives purely from the caller's own payload and
the coworker-agent actor gate has already run.

**`findRegisteredMatch` did not trim.** `source.payTo` and `candidate.unit` were
lowercased but not trimmed, while `source.network` one line up was — which is
what made the omission look accidental. Ingestion stores whitespace verbatim
(`agent-sync.projection.ts` copies `payTo` through; `normalizeMasumiPaymentUnit`
lowercases, never trims) and the 402 normalizer emits trimmed lowercase, so a
padded registry row LISTED cleanly (the listing canonicalizes) but could never be
paid — a wasted agent call and an unactionable 422. Both sides now trim.
**Mutation-tested** (each trim dropped independently; both killed the test).
**Ingestion trim: NOT done.** The read side has to tolerate padded rows
regardless, because every already-stored row keeps its whitespace until the next
registry sync rewrites it — so ingestion trimming adds no safety on top, while
`buildPaymentSourceRows` has no direct test coverage and is shared with the
Cardano path. Recorded as cleanup, not a gap.

**Non-deterministic `amounts` ordering in the pay lookup.** `findListedX402Agent`
ordered `paymentSources` by `sourceIndex` but loaded `amounts` with a bare
`include: true`, so the matcher's `find` resolved against Postgres heap order.
Mirrored the listing's `orderBy: [{unit: "asc"}, {id: "asc"}]`. **Not** a unique
on `(paymentSourceId, unit)`, as a reviewer suggested: ingestion explicitly
permits duplicate units within one source (it zips decimals positionally because
"assets are not guaranteed unique within one source's fixed amounts"), so the
constraint would break the registry sync. Premise re-verified in the projection
before rejecting the suggestion.

**Two test defects.** (1) `masumi-payment.client.x402.test.ts` sent
`paymentIdentifier: "task_1:pay_1"` — 13 chars and a colon, against the pinned
node spec's `minLength: 16` / `^[a-zA-Z0-9_-]+$`. Production was already fixed to
join with `_` because the node 400s a colon and the pay flow refunds a 400 as a
refusal; the fixture modelled the rejected shape and taught the bug back. Now a
realistic `${taskId}_${paymentId}` uuid(7) pair. (2)
`x402-payment-verify.test.ts` pinned `demand.payTo === PAY_TO.toUpperCase()`, an
asymmetry with `caip2Network` and `asset` that survived only because two
downstream layers `.toLowerCase()`-guard it. Removed the asymmetry rather than
testing it: `payTo` is lowercased on the returned demand (what SIGNS is `entry`,
forwarded verbatim), and the test now pins both halves.

### Step-5 hardening verification

- `pnpm --filter core test` — 369 files / 3487 passed (6 skipped), incl. the new
  `task-x402-payment.purge.test.ts` (6) and 3 new sync-route cases.
- `pnpm --filter @sokosumi/masumi test` — 17 files / 330 passed.
- `pnpm typecheck` all workspaces (exit 0); `pnpm check` clean.
- Web Core-client snapshot regenerated (413 on the pay route only).
- File sizes: `task-x402-payment.service.ts` 721, `task-x402-payment.replay.ts`
  440, `task-x402-payment.purge.ts` 57, `helpers/x402-payment-verify.ts` 191,
  `helpers/x402-pricing.ts` 141 — all under the 750 ceiling.

### Step-5 settleability pass (same branch) — 2026-08-12

A second security review re-verified the previous pass by mutation and found 8
residual defects, each reproduced with a probe test. Every fix below was written
test-first; F1, F2 and F3 were additionally mutation-tested (mechanism reverted,
red confirmed, restored, green confirmed).

**Extraction first.** `task-x402-payment.service.ts` sat at 722 of the 750-line
ceiling, so `finalizeVerifiedTaskX402Payment`, `heldPendingSignOutcome` and
`ChargedX402Demand` moved to a sibling `task-x402-payment.finalize.ts` — matching
the existing `.replay`/`.refund`/`.purge` split — before anything was layered on.
Pure move, no test change. The service is now 516 lines.

**Double-charge via a zero-padded node amount (F1).** Finalize asserted the
node's `amount` against the charge as BigInt — correctly, since `"0250000"` is a
legal node spelling of `"250000"` — and then stored the node's spelling.
`assertReplayMatchesStoredDemand` compares that column as a STRING, so the row
became unreachable by its own idempotency key: the exact case idempotency exists
for (a 200 lost in transit) replayed as 409 "use a new idempotencyKey", and
following that advice mints a SECOND debit for a header that already exists.
Probed end-to-end: the replay really does answer 409.

The review prescribed `chargedAmount.toString()`. **That premise is wrong**, and
the fix is `charged.amount` instead. `normalizeAmount` passes a 402's amount
through VERBATIM (no zero-stripping), so a 402 that itself says `"0250000"`
charges and creates the row with that spelling — re-canonicalizing at finalize
would strand the key from the *other* direction. A second test pins that mirror
case, and the prescribed fix was mutation-tested against it: it goes red.
`charged.amount` is both the value already on the row and the value the replay
re-derives, so the write restates rather than rewrites.

**Payer stored in the node's casing (F5).** The assert had just compared
`authorization.from` against `signed.payer.toLowerCase()`, then wrote
`signed.payer`. `@@unique([caip2Network, asset, payerAddress, payloadNonce])` is
a byte comparison mirroring the chain's one-settlement-per-(payer, nonce)
guarantee, so an EIP-55 spelling and its lowercase twin both insert — two credit
debits behind one settleable transfer. `caip2Network` and `asset` in the same
write were already folded; this was the odd one out.

**The header was never checked for whether it can settle (F3).** The largest of
the eight. `parseSignedX402Authorization` read neither `payload.signature` nor
the envelope `scheme`/`network`, and finalize never looked at the validity
window. A header with no signature, one bound to Base mainnet against a Base
Sepolia charge, one declaring `upto`, and one already expired all describe the
charged transfer perfectly — so all four passed every who/how-much assertion and
were written VERIFIED, the one status `refundRefusedTaskX402Payment` explicitly
refuses. The credits ended up behind an instrument that can never move a cent,
recoverable only by an operator.

Split by layer. The parse now requires signature, scheme and network as hard
failures alongside `to`/`value`/`from`; finalize owns the policy (scheme against
`X402_SUPPORTED_SCHEMES`, network against the charged chain, window against the
clock). Expiry deliberately does NOT live in the parse: the future reconciler
exists precisely to read authorizations that ARE expired.

Two calibrations that keep the fence from causing the harm it prevents. The
envelope network folds through the 402's own normalizer — exported as
`normalizeX402NetworkId` so both sides share one dialect map — because comparing
spellings would hold a good payment whenever a node answers `base-sepolia` for
`eip155:84532`. And timestamps stay best-effort: unreadable is unknown, not
invalid, so drifted observation fields still store null and still return 200.
`validAfter` gets a one-sided 60 s skew tolerance (the x402 client already
backdates it 600 s); `validBefore` gets none.

Doctrine unchanged and load-bearing here: the node DID sign, so every one of
these holds PENDING via `heldPendingSignOutcome` and NEVER refunds inline. The
envelope `network` is the only chain cross-check available — the EIP-712 domain
that truly binds the signature (`chainId`, `verifyingContract`) is not in the
header at all.

Two test fixtures were themselves wrong: `signature: "0xsig"` is not hex (19
tests had been passing on a header with a placeholder signature), and
`validBefore` was a frozen literal that had already elapsed four months ago. The
signature is now realistic and `validBefore` derives from the run clock, so it
cannot rot into an expired-header test.

**Double sign onto a VERIFIED row was silent (F4).** The FAILED/REFUNDED sibling
calls itself the backstop for a lease that expired under a stalled holder and
pages loudly; this branch is the same backstop from the other side. Reaching it
with a *different* `attemptId` means two node signs happened and a live EIP-3009
authorization is being discarded. Money-safe (one header per record, always the
stored one), which is exactly why it was invisible. Now paged in the sibling's
shape — attemptId and nonce, never the header. Same `attemptId` is one result
re-finalizing, and stays quiet.

**The ambiguous 502 echoed the raw node message (F6).** `extractNodeErrorMessage`
falls back to `JSON.stringify` of the whole node response body, so the one
sanitized answer re-leaked what the refusal branch a few lines up deliberately
withholds. Now `heldPendingSignOutcome()`'s generic sentence; the Sentry capture
already carried the raw text.

**Replay narrowing was untested (F7).** Replacing `narrowOrThrow` with a bare
`return normalized` left all in-scope tests green. The same-pair fence covers the
poisoned sibling; the residual the narrowing exists for is a sibling for a
DIFFERENT, unregistered asset on the same chain, which conflicts with nothing.
Twins added at the helper and the route, both confirmed red by mutation.

**Purge bypass (F2).** The predicate required `validBefore: { not: null }`, but
`readValidBefore` is deliberately best-effort, so the sweep never covered the
rows that tolerance creates — they kept their bearer credential forever. Added a
second arm aging them out on an absolute bound.

Measured from `updatedAt`, **not** `createdAt` as the review prescribed —
**second wrong premise**. `createdAt` is the CHARGE time, and a PENDING record
stays replayable with the same key, so its header can be signed days later; a
createdAt-based cutoff would null a header that is still settleable. `updatedAt`
moves with the VERIFIED write that stores the header, and `maxTimeoutSeconds` is
capped, so `updatedAt + cap + 1 h` of clock slack is a true upper bound. The
prescribed variant was mutation-tested and goes red.

**Purge scan and write (F8).** The `where` has no `status`, but the only index
mentioning `validBefore` led with `status`, so there was no seek. The review
prescribed `@@index([validBefore])` plus id-cursor batching; measured on 200 000
rows those two are **mutually defeating as specified** — `ORDER BY id` forces a
pkey scan, and even without it the planner declined the plain index and
seq-scanned (1709 shared buffers), because `validBefore <= now()` matches
essentially every historical row forever.

The condition that actually selects is `xPaymentHeader IS NOT NULL`, so the index
is PARTIAL on it. Rows still holding a credential are a small bounded working set
— this sweep is what empties it — so the partial predicate both makes the index
worth reading and keeps it small. Same query, same data: 202 buffers, and it is
still chosen under the `ORDER BY id` the cursor scan uses, so both review goals
hold together once the index is partial. The unbounded `updateMany` became an
id-cursor batch loop that re-checks `abortSignal` between batches. By-expiry-
not-by-status is preserved, as the tests pin deliberately: branch 6 can move a
header-bearing row to REFUNDED and a status-scoped sweep would strand exactly
those.

### Step-5 settleability verification

- `pnpm --filter core test` — 369 files / 3511 passed (6 skipped); +30 over the
  previous pass.
- `pnpm --filter @sokosumi/masumi test` — 17 files / 330 passed.
- `pnpm typecheck` all workspaces (exit 0); `pnpm check` clean.
- Migration `20260811180000_task_x402_payment_header_purge_index` validated
  against local Postgres 18.4: `prisma migrate deploy` from an empty database
  (all 265 migrations), hand re-apply of the new file (`IF NOT EXISTS` skip),
  a second `migrate deploy` reporting no pending migrations, and
  `prisma migrate diff` showing **no x402 drift** — the only diff output is 6
  pre-existing `chat_room` partial-unique-index artifacts untouched by this work.
- File sizes: `task-x402-payment.service.ts` 516 (was 722),
  `task-x402-payment.finalize.ts` 382, `task-x402-payment.replay.ts` 440,
  `task-x402-payment.purge.ts` 136, `helpers/x402-settlement.ts` 264 — all under
  the 750 ceiling.

### Step-5 residual-defect pass (same branch) — 2026-08-12

Sixth review of the money path. Six residuals, all reproduced first.

**A far-future `validBefore` escaped BOTH purge arms (F1).** The expiry fence
had only a lower bound. Probed against the real parser, `"99999999999"` (year
5138) and `"253402300799"` (year 10000) both build valid Dates and were stored
verbatim at VERIFIED; only past ~8.64e12 seconds does the Date overflow and
fall back to null. Such a row is not `lte: now` (arm 1 misses) and not null
(arm 2 missed), so the bearer credential was retained on every pass, forever,
while permanently blinding `@@index([status, validBefore])` for the reconciler.

Fixed on both sides, because either alone is a half-fix. `firstUnsettleable
Reason` gained an upper fence at `X402_MAX_TIMEOUT_SECONDS` plus the clock-skew
tolerance — the node signs `validBefore = signTime + maxTimeoutSeconds` and
that input is schema-capped — routed to the PENDING hold like every other
unsettleable reason. And the purge's second arm dropped its `validBefore: null`
condition: it was re-deriving the bound from the very column it exists to
distrust. The absolute arm cannot null a live header — the cap guarantees death
by `updatedAt + 1 h` against a 2 h cutoff — and that is now a test, to the
millisecond, alongside the year-5138 case.

The purge tests stopped asserting only the `where` object and now run rows
through the predicate. Asserting the object proves which predicate was written;
it cannot prove which rows it selects, and this defect was precisely a row
nobody realised the predicate missed.

**A VERIFIED replay after the purge returned a bare 500 (F2).** The purge nulls
`xPaymentHeader` on VERIFIED rows, so `buildStoredSignedResponse`'s "unreachable
by construction" comment became false the moment that sweep shipped. Now a 409
`x402_payment_header_expired`, deliberately distinct from the consumed-key 409
because nothing was refunded — the charge stands and bought a header that was
spendable for its whole window. It sits AFTER the demand re-verification so a
reused key still reports itself as one, and that ordering is pinned by a test.

**No pre-charge floor on `maxTimeoutSeconds` (F3).** The schema allowed 1, and
`verifyX402DemandAgainstAgentSources` never read the field. A listed agent
publishing `maxTimeoutSeconds: 1` charged credits on every payment, held PENDING
with no inline refund (correct doctrine — F3's expiry fence is right to give
`validBefore` no skew tolerance), burned all five sign attempts and died at
`x402_payment_sign_attempts_exhausted`. One operator ticket per payment,
repeatable at will.

**Floor chosen: 60 s.** Three bounds, and 60 satisfies all of them. The hard
floor is `TASK_X402_SIGN_REQUEST_TIMEOUT_MS` (20 s) — a window shorter than the
call cannot survive even a successful one. The window must also outlive the
coworker presenting the header to the resource server, which is the instrument's
whole purpose and which no bound in this repo covers. And research 001 §2
records 60–3600 s across live Bazaar listings, so 60 is the observed minimum of
the real distribution: 3× the sign timeout, rejecting nothing ever seen. Only
the MATCHED entry is checked, which is sufficient because the payload is
narrowed to that one entry before the node sees it.

**Gateway statuses were classified `"refused"` (F4).** `status !== 200` implies
"no header issued" only for the node's OWN statuses; the spec declares 400/402/
500 and no others. A 502/503/504/408 from a reverse proxy is indistinguishable
by number and can be raised AFTER the node signed, so it triggered the
synchronous refund and a terminal FAILED against a live, undelivered
authorization — then the same-key replay 409'd the coworker onto a new key, for
a second charge and a second signature. A refusal now requires the node's
documented `{ error: { message } }` envelope; everything else falls through to
ambiguous, which holds PENDING and never refunds. Erring toward ambiguous is the
doctrine-aligned direction.

**Two soft spots in the settleability fence (F5).** The envelope `scheme` was
folded with `.trim().toLowerCase()` before the supported-scheme comparison, but
a facilitator reads it verbatim — so `"Exact"` cleared Soko's fence and settles
against nothing, i.e. the fence was checking a string that exists nowhere
downstream. The 402 side was already strict; the signed side now is too.
`EVM_SIGNATURE_PATTERN` accepted `0xdeadbeef` and odd-length hex, making "there
is a signature here" satisfiable by a placeholder; it now requires whole bytes
and at least 32 of them, with no exact width pinned (ERC-1271 signatures are
variable-length, and a plain ECDSA one is 65 bytes).

**Echo asymmetry on a node 400 (F6).** The verbose 400 branch interpolated
`signResult.error.message`, built on `extractNodeErrorMessage`, whose fallback
is a JSON dump of the whole node body — leaking exactly the wallet/budget
internals the 402/500 sibling withholds, from the one branch that answers in
detail. It now echoes only `X402PayFailure.nodeMessage`, the node's own
sentence, sliced to the existing echo ceiling because that text is unbounded and
repeats an attacker-authored 402.

**Mutation results.** F1 arm: restoring `validBefore: null` on the second purge
arm reddens 3 tests including the row-level year-5138 case. F1 fence: deleting
the upper fence reddens the route test (200 instead of 502). F2: disabling the
header-null branch returns the bare 500 the fix removed. F4: dropping the
envelope requirement reclassifies both gateway cases as `refused`; dropping
`nodeMessage` propagation reddens the echo test. One F4 mutation — sourcing
`nodeMessage` from `extractNodeErrorMessage` instead of `readNodeErrorMessage` —
SURVIVED, and is a genuine equivalent mutant: behind the envelope gate the two
provably return the same string.

**No premise from the review turned out wrong this round.** All six reproduced
as described, including the exact parser boundary quoted for F1.

### Step-5 residual-defect verification

- `pnpm --filter core test` — 367 files / 3529 passed (6 skipped); +18 over the
  previous pass.
- `pnpm --filter @sokosumi/masumi test` — 17 files / 333 passed.
- `pnpm typecheck` all workspaces (exit 0); `pnpm check` clean (3166 files).
- **No migration and no DDL change.** The only `schema.prisma` edit is a doc
  comment. Validated anyway against local Postgres (Homebrew, `pg_isready` ok):
  `prisma migrate deploy` from an empty database applied all migrations, a
  second deploy reported "No pending migrations to apply", and
  `prisma migrate diff` from the deployed datasource to the schema shows **no
  x402 drift** — the only output is the same 6 pre-existing `chat_room`
  partial-unique-index artifacts the previous pass recorded.
- Purge plan re-measured on 200 000 rows with a 400-row credential-holding tail:
  the absolute arm still uses the partial index
  (`task_x402_payment_validBefore_updatedAt_idx`, 404 shared hits, 2.4 ms), and
  the plan and buffer count are IDENTICAL to the previous `validBefore IS NULL`
  predicate. It reads the partial index in full rather than seeking, which is
  bounded and cheap for the same reason the partial predicate is worth having:
  the index only ever holds rows still carrying a credential.
- File sizes: `task-x402-payment.service.ts` 530,
  `task-x402-payment.replay.ts` 465, `task-x402-payment.finalize.ts` 418,
  `masumi-payment-x402.ts` 386, `helpers/x402-settlement.ts` 279,
  `helpers/x402-payment-verify.ts` 213, `task-x402-payment.purge.ts` 159 — all
  under the 750 ceiling.

### Step-5 confirmation pass — unasserted controls (same branch) — 2026-08-13

A confirmation review declared the branch clean: no security defect, 33 of 34
mutations caught. What it left were three low-severity items — one stale
comment and two controls that are correct but not pinned by any test — plus two
notes to record rather than fix. Nothing about the refund doctrine, the atomic
status claims, the sign lease, the purge's by-expiry-not-by-status property, or
debit+row atomicity moved this round.

**The purge index migration's comment still described the old second arm.** It
said the backstop "seeks the same index at `validBefore IS NULL` (Postgres
btrees index NULLs) and takes its range from the second column". That arm lost
its `validBefore` predicate when it was made absolute (`updatedAt <= cutoff`, so
it subsumes null, drifted and far-future expiries alike) and now reads the
partial index in FULL. `schema.prisma` was corrected when the arm changed; the
migration was not, so the two disagreed about the plan the previous pass had
already measured. Comment only — the DDL is one `CREATE INDEX` and is
unchanged.

**The purge's write guard was the one surviving mutant (F7).** The batch
`updateMany` re-guards on `xPaymentHeader: { not: null }` on top of the id list,
and deleting it left all 14 purge tests green. The ids come from a predicate
evaluated at READ time, and `updateMany` reports rows MATCHED, not rows changed
— so a row cleared by a concurrent pass between the read and the write is
counted a second time and the reported `purged` total overstates the
credentials actually removed. Metrics-only: no credential, money or audit
consequence, which is exactly why nothing noticed. The batching test now asserts
the guard on every write.

**The fence↔purge coupling was correct by coincidence (F8).**
`X402_MAX_PLAUSIBLE_VALIDITY_MS` (finalize) bounds how far ahead a stored
`validBefore` may sit — `X402_MAX_TIMEOUT_SECONDS` + the 60 s clock-skew
tolerance = 3 660 000 ms. `X402_UNDATED_HEADER_TTL_MS` (purge) is the absolute
cutoff at `X402_MAX_TIMEOUT_SECONDS` + 1 h = 7 200 000 ms. The purge must stay
strictly beyond the fence or the sweep nulls a header still inside its window;
the margin today is 3 540 000 ms. The two are derived independently, in two
modules, from the same cap, and the only assertion was the weaker
`TTL > X402_MAX_TIMEOUT_SECONDS * 1000` — so raising
`X402_CLOCK_SKEW_TOLERANCE_MS` past an hour would invert the relationship
silently. Money-safe if it ever happened (the coworker already holds the
header), but the replay of that row would answer 409
`x402_payment_header_expired` against a live authorization. The fence constant
is now exported for this one purpose and the ordering is pinned by a test.

**`narrowOrThrow`'s doc claim was off by a statement order.** It said the throw
lands "BEFORE the charge on the fresh path". It is actually evaluated after the
debit, the task event and the record insert — but inside the SAME
`serializableTransaction` as all three, so a throw rolls the charge back with
them and the effect matches the claim. Wording corrected; no behaviour involved.

#### Recorded, deliberately not fixed

- **Node-clock skew is an ops hazard, not a code defect.** The fence tolerates
  60 s of node-clock-ahead skew. A node running more than ~60 s + RTT ahead of
  Soko, quoting a legitimate `maxTimeoutSeconds: 3600`, yields
  `validBefore > now + 3 660 000 ms` on EVERY payment → `expiry_implausible` →
  PENDING hold → 5 replays burned → `x402_payment_sign_attempts_exhausted`.
  Structurally the same wedge the 60 s pre-charge floor removed, except the
  trigger is Soko's own infrastructure rather than a listed agent. Widening the
  tolerance is the wrong lever (it is what the purge ordering above constrains);
  the remedies are NTP discipline plus alerting on the
  `task_x402_payment_unsettleable_header` Sentry tag with
  `reason: expiry_implausible`, and the operator `resolve` lever landing on the
  next branch. Worth handing to whoever operates this.
- **Over-long nonce → 500 → PENDING → header discarded, repeatably.**
  Pre-existing and already declared intended in the schema comment.
  `parseSignedX402Authorization` accepts any non-empty `nonce` string while
  `TaskX402Payment.payloadNonce` is `VarChar(66)`, so a 67+ char nonce fails the
  VERIFIED write with a bare 500, holds the record PENDING, and discards the
  header — identically across all 5 replays. Node-controlled only: a real
  EIP-3009 nonce is exactly 66 chars. Unchanged.

### Step-5 confirmation verification

- **Red-then-green, both items.** F8 first: the new ordering test failed with
  `TypeError: expected value must be number or bigint, received "undefined"`
  (the constant was module-private), green after exporting it. F7 next: with the
  guard present the suite is green, and MUTATING it away — deleting
  `xPaymentHeader: { not: null }` from the batch `updateMany` — reddens
  "walks the matches in id-cursor batches instead of one unbounded write" with
  `AssertionError: expected undefined to deeply equal { not: null }`. Guard
  restored; `git diff` on `task-x402-payment.purge.ts` is empty, so the
  restoration is byte-for-byte.
- `pnpm --filter core test` — 368 files / 3534 passed (2 files, 6 tests
  skipped); +1 test over the previous pass, the purge suite going 14 → 15.
- `pnpm --filter @sokosumi/masumi test` — 17 files / 353 passed.
- `pnpm typecheck` all 9 workspaces, exit 0; `pnpm check` clean (3171 files).
- **No Postgres re-validation, and none needed.** The migration edit is a
  comment inside the `-- …` header block; the `CREATE INDEX IF NOT EXISTS`
  statement is untouched, so the applied DDL is byte-identical to what the
  residual-defect pass already validated (deploy from empty, idempotent second
  deploy, `migrate diff` showing no x402 drift, and the 200 000-row plan
  measurement). `schema.prisma` was not touched at all this round — the
  migration comment was brought INTO line with it. No new migration.
- File sizes: `task-x402-payment.service.ts` 530,
  `task-x402-payment.replay.ts` 468, `task-x402-payment.finalize.ts` 427,
  `task-x402-payment.purge.test.ts` 363, `task-x402-payment.purge.ts` 159 — all
  under the 750 ceiling.
## Sub-component 6 — admin surface (`x402-6-admin`) — 2026-08-11

**Branch:** `x402-6-admin`, cut from `x402-5-pay` (clean tree). Two feature
commits (the goodwill refund lever, then the admin routes) plus this log entry.
Mirrors the admin task-payment-claims surface exactly (same admin gate, same
route/schema/service split, same self-guard-plus-parent-guard authz shape).

### Admin refund lever — `refundVerifiedTaskX402Payment`

- Lives next to the automated refusal refund in
  `services/task-x402-payment.refund.ts` (the seam step 5 split out for §5). It
  writes the FIRST `TaskX402PaymentAction` rows (`action: "refund"`, the step-2
  reservation was until now unused). Flip + compensating refund + audit row are
  ONE `$transaction`.
- **Refundable statuses (decided + documented):** VERIFIED → yes — the
  "paid but bad result" case §5 targets (Soko accepts the node-side cost of a
  header the coworker may already hold; the credits go back regardless).
  FAILED / REFUNDED with `refundTransactionId` set → `already_refunded` → 409
  (the automated refusal refund already compensated FAILED atomically). PENDING
  → `not_refundable` → 409, directing to coworker replay / the unbuilt
  reconciler — the admin lever deliberately never touches the crash window.
  Missing row → `not_found` → 404.
- **Idempotent:** the VERIFIED→REFUNDED flip is an `updateMany` claim; a second
  call claims nothing (`count === 0`) and returns `already_refunded`, so no
  double refund is ever minted — the exact `claimed.count === 0` guard shape the
  refusal path uses.
- **Refund shape deduped:** the refund-transaction creation (non-expiring REFUND
  bucket `task-x402-payment:{id}`, org-aware) is extracted to a shared
  `attachCompensatingRefund(tx, payment)` reused by both the refusal path and
  the goodwill path — one refund shape, one place to change. The refusal path's
  behavior and its mutation-tested tests are unchanged.
- The live `xPaymentHeader` is intentionally left stored on a goodwill refund:
  nulling Soko's copy would not revoke the coworker's copy, and the reconciler
  NULLs it at `validBefore` expiry.

### List — `GET /v1/admin/task-x402-payments`

- Platform-admin only (`requireAdminAuthContext`, the same gate the claims
  routes use), self-guarded in the handler AND under the admin router's
  `requireAdmin` middleware.
- **`xPaymentHeader` excluded at the SELECT level, not just the mapping**
  (step-5 finding 7). The query lists columns explicitly — never `include` /
  whole-row — and never requests `xPaymentHeader` or the raw signed-payload
  fields (`payerAddress`, `payloadNonce`, `paymentPayloadHash`). An explicit
  test asserts BOTH that the Prisma `select` has no `xPaymentHeader` key and
  that no response object carries it; mutation-tested (add `xPaymentHeader: true`
  to the select → that test fails → reverted).
- Fields: id, status, taskId, agentId, caip2Network, asset, amount (base
  units), payTo, `creditsCharged` (the linked debit via `convertCentsToCredits`),
  failureReason, attemptId, signAttemptCount, validBefore, timestamps,
  taskEventId, and the refund linkage (transactionId + refundTransactionId).
  Filters: status / agentId / caip2Network, cursor-paginated. For the
  per-agent rollup that drives the whitelist-disable decision, see
  *Per-endpoint aggregation* below.

### Per-endpoint aggregation — `GET /v1/admin/task-x402-payments/aggregate`

- The §5 dashboard signal that feeds the whitelist-disable decision. Two
  groupBys, both leaning on `@@index([agentId, status])`: `by:
  [agentId, status]` for the per-status rollup, and `by: [agentId]` filtered on
  `refundTransactionId: { not: null }` for the money-returned `refundCount`
  (the step-5 handoff's exact definition). Returns per agent: total, per-status
  counts, `failureCount` (= FAILED), and `refundCount`. Optional `agentId` /
  `caip2Network` filters so it is queryable per agent; sorted bleeding-first.

### Resolve / force-fail lever — deliberately NOT built

> **Superseded 2026-08-12** — see "PR 1 — x402-6-admin: the `resolve` lever"
> below. The premise held here ("PENDING records are the reconciler's domain")
> was true only if the reconciler existed; it does not, so the block on account
> deletion was unbounded with no operator remedy.

§5 names exactly two levers (admin refund + per-endpoint aggregation); it does
NOT call for a claim-style resolve/force-fail. PENDING x402 records are the
reconciler's domain (the node signs locally, so a stale PENDING is refund-safe
without consulting the node). The admin refund routes a PENDING record to 409
with that message. The auto-refund reconciler over stale PENDING rows
(`@@index([status, validBefore])`) remains **reconciler-PR work**.

### Verification

- `pnpm --filter core test` (full) — 364 files / 3385 passed (2 files, 6 tests
  skipped), incl. new `task-x402-payments.routes.test.ts` (14) and the extended
  `task-x402-payment.refund.test.ts` (9: 4 refusal + 5 goodwill).
- `pnpm typecheck` all 9 workspaces (exit 0); `pnpm format` (wrapping-only on 2
  files) + `pnpm check` clean (3158 files).
- **Mutation-tested** (mutate → dedicated test fails → revert → clean tree): the
  goodwill idempotency guard (`if (claimed.count === 0)` → `if (false)` → 3
  refund tests fail), and the header exclusion (`xPaymentHeader: true` added to
  the list select → the exclusion test fails).
- File sizes: schema 167, refund service 253, list route 104, aggregate route
  108, refund route 70, index 12, routes test 372, refund test 234 — all under
  the 750 ceiling.

### No migration, no client regen

The `TaskX402Payment` / `TaskX402PaymentAction` models and every column this
surface reads (incl. `signAttemptCount`, `xPaymentHeader`) already shipped in
steps 2 / 5. This step is API + service only — no schema change, no Prisma
migration, no masumi client change.

## PR 1 — BUILD COMPLETE

The Bazaar coworker x402 payment surface (PR1-SPEC) is fully built across six
branches, stacked in build order:

1. `x402-1-spec-refresh` — pinned specs confirmed byte-identical to the deployed
   x402 node surface; provenance note only.
2. `x402-2-model` — `TaskX402Payment` + `TaskX402PaymentAction` (+ the
   `[taskId, idempotencyKey]` dedupe unique, `[agentId, status]` and
   `[status, validBefore]` indexes) and the user-deletion guard.
3. `x402-3-helpers` — CAIP-19 pricing, the 402 dialect normalizer, and buy-side
   readiness composition (framework-agnostic).
4. `x402-4-listing` — readiness sync wiring + `GET /v1/agents/x402`
   (fail-closed, per-agent).
5. `x402-5-pay` — `POST /v1/tasks/{taskId}/x402-payments`: verified proxy of the
   node's `POST /x402/pay`, charge-then-sign, synchronous refund on refusal,
   idempotent replay, sign-attempt cap; plus the header column and the
   settlement-observation fields.
6. `x402-6-admin` — this branch: the §5 admin surface (list, per-agent
   aggregation, goodwill refund + audit).

**Deferred, named, not in this stack (later PRs):**

- **The phased-settlement reconciler** — an auto-refund sweep over stale PENDING
  rows (`@@index([status, validBefore])`) that refunds provably-unpaid held
  charges without consulting the node, checks EIP-3009 `authorizationState`
  after `validBefore`, and NULLs `xPaymentHeader` once it expires. Until it
  ships, held PENDING charges page via `Sentry.captureMessage` as the interim
  manual signal (step-5), account deletion blocks + pages on a PENDING x402, and
  the admin refund routes PENDING to support.
- **Shared-helper extraction** — SHOULD-1 (a shared readiness-sync helper) and
  SHOULD-3 (a shared Cardano/x402 refund helper): both touch the merged Cardano
  readiness / claim-refund code, out of scope for the x402-only stack. Within
  x402, the refund shape is already deduped via `attachCompensatingRefund`.
- **Error-kind centralization** — the pay flow's inline `kind`s
  (`x402_payment_key_reused`, `…_key_consumed`, `…_key_in_flight`,
  `…_sign_attempts_exhausted`, `x402_pay_refused`, `x402_pay_outcome_unknown`)
  are still defined at throw sites, not in a shared registry like
  `CORE_API_ERROR_KINDS` (NICE-6). Consolidating them is a follow-up; the money
  paths were deliberately not churned to do it.
- **Carryover:** `agent-sync.service.ts` is 974 lines — over the 750 ceiling; do
  not append, extract when next touched.

## PR 1 — x402-6-admin review fixes (3 findings)

Three review findings on the §5 admin surface, each landed with a test that
exercises production reality (the original reds were masked by wrong-sign /
coincidental fixtures — the lesson below).

### 1. List `creditsCharged` was negative on real data → 500 (sign bug)

`GET /v1/admin/task-x402-payments` mapped `creditsCharged:
convertCentsToCredits(transaction.amount)`, but the debit transaction is stored
NEGATIVE (`createTaskEventTransaction` writes `amount: input.cents * -1n`; the
refund guard `refundAmount = amount * -1n; if (refundAmount <= 0n) throw`
confirms it). A real row (`amount = -30_000_000_000n`) yielded `-3`, which the
`creditsCharged: z.number().nonnegative()` schema rejects → ZodError-500. The
whole list — §5's primary observability surface — was dead on any deployment
with real data. Fixed by negating: `convertCentsToCredits(-transaction.amount)`.

**Fixture-masking lesson:** exactly ONE fixture was wrong-signed —
`verifiedPaymentRow`'s `transaction.amount` was POSITIVE `30_000_000_000n`, so
the green suite never saw the production sign. Flipped it to the real negative
`-30_000_000_000n`; the list test now 500s if the negation is reverted
(mutation-checked).

### 2. Aggregate metric redefined: goodwill refunds, not lumped refunds

`refundCount` counted every row with `refundTransactionId != null`, lumping
automated node-refusal refunds (status FAILED, user-safe, node-budget-only) with
operator goodwill refunds (the actual §5 quality signal) — and it was the
PRIMARY sort key, so a high-node-refusal endpoint falsely ranked as
quality-bleeding. Redefined to `goodwillRefundCount = count of status ===
REFUNDED` (the admin VERIFIED→REFUNDED lever; the automated refusal refund leaves
status FAILED). This dropped the second `refundTransactionId`-predicate groupBy
entirely — the rollup now derives the signal from the single `[agentId, status]`
groupBy. `goodwillRefundCount` is the primary sort key (then `failureCount`, then
`agentId`). Schema field, doc comments, route description, and tests updated. No
consumer read the old field name (verified: no web generated-client or snapshot
references).

### 3. "Bleeding endpoints first" sort now has a real disagreement test

The old aggregate test's money-rank coincided with alphabetical order, so
stripping the money tiebreakers still passed. Added a 3-agent test where
money-rank and alphabetical FULLY disagree (`zzz` highest goodwill, `aaa`
lowest; `mmm`/`aaa` tie on goodwill and split on failures). Mutation-checked:
replacing the comparator with pure `agentId.localeCompare` returns
`[aaa, mmm, zzz]` and the test fails on the asserted `[zzz, mmm, aaa]`; dropping
the `failureCount` tiebreak also fails it.

**Verification:** `pnpm --filter core test` (3386 passed / 6 skipped incl. the
15-test x402 admin suite), `pnpm typecheck`, `pnpm format`, `pnpm check` — all
clean. Both mutation checks performed and reverted; tree clean.

## PR 1 — x402-6-admin: the `resolve` lever — 2026-08-12

Reverses "Resolve / force-fail lever — deliberately NOT built" above. A PR 2
security review flagged (MEDIUM, deferred to this branch) that a PENDING
`TaskX402Payment` wedges an account permanently: `prepareTasksForUserDeletion`
blocks `DELETE /user` on any PENDING x402 row and tells the user to contact
support, but support had no lever — coworker replay exhausts
`TASK_X402_MAX_SIGN_ATTEMPTS` (5) and never resets, the settlement reconciler is
explicitly not in this stack, and `refundVerifiedTaskX402Payment` only claims
VERIFIED (PENDING → 409). A GDPR Art. 17 erasure request could therefore stall
forever behind an internal money record, and the guard's "contact support"
message was false. `TaskX402PaymentAction.action` already documented
`"refund" | "resolve"`; only the second half was missing.

### `POST /v1/admin/task-x402-payments/{id}/resolve`

Mirrors the goodwill-refund route exactly — same `requireAdminAuthContext`
in-handler guard (not just the parent router's), same `required: true` JSON body
with a mandatory `reason` (`min(1).max(500)`, matching the audit column), same
`ok()` envelope, same 401/403/404/409/422 taxonomy. Service:
`resolvePendingTaskX402Payment` in `task-x402-payment.refund.ts` (the levers
share `attachCompensatingRefund`, so both mint one refund shape).

- **Claim:** `updateMany where { id, status: PENDING, OR: [processingAt null,
  processingAt <= leaseCutoff] }`, then branch on `count`. Never read-then-write.
- **`count === 0` taxonomy:** FAILED/REFUNDED with a refund attached →
  `already_resolved` (409, idempotent); still PENDING → `sign_in_flight` (409);
  VERIFIED → `not_resolvable` (409); missing row → `not_found` (404).
- **Never VERIFIED.** That row carries a live X-PAYMENT header that may still
  settle; only the goodwill refund may reverse it, and only deliberately.
- **Audit row:** `action: "resolve"` with all seven NOT NULL money facts.
  `cents` is the debit MAGNITUDE (the charge `Transaction.amount` is negative),
  and `reason` is sliced at `TASK_X402_MAX_ACTION_REASON_LENGTH` (500 —
  `@db.VarChar(500)`), not the 2000-char `failureReason` bound. Extracted
  `writeOperatorActionAudit` + `OPERATOR_ACTION_SELECT` so refund and resolve
  cannot drift into different audit shapes.

### Why refunding a PENDING row cannot double-pay (ticket 011 Q1)

Case analysis over every path that leaves a row PENDING: node refused → already
FAILED, not PENDING; malformed / unreadable / ambiguous 200 → the coworker got a
502 and no header; signed-tuple mismatch → Soko received a valid header,
deliberately discarded it, returned 502; crash before the node call → nothing
signed. In all of them the authorization is unsettleable by the only party who
could present it.

### Sign-lease interaction — resolve REFUSES a leased row

PR 5's `processingAt` lease is honoured, as part of the claim predicate rather
than a read-then-check. Reasoning: a leased row is not wedged — a node
round-trip is in flight and the row leaves PENDING within
`TASK_X402_SIGN_LEASE_MS` (30s) on its own. Claiming it is not a double-refund
risk (`finalizeVerifiedTaskX402Payment` claims `status: PENDING` and would lose
the race, so credits go back exactly once), but it manufactures the state the
pay flow itself calls the worst it can reach —
`task_x402_payment_signed_after_close`: a real EIP-3009 authorization Soko
signed and then discarded — and fires that error-level page for an action an
operator took on purpose, making the one signal that distinguishes a genuine
lease-expiry bug unreadable. Waiting costs the operator seconds. The 409
therefore carries `retryAfter` (ISO instant the lease lapses) and
`retryAfterSeconds`, both echoed in the message. An EXPIRED lease resolves
normally — the lease is self-expiring, never a lock, so a crashed holder cannot
wedge the lever that exists to unwedge accounts.

### Deletion guard now promises something real

`user-deletion-tasks.ts`: blocking behaviour unchanged (still 400
`TASK_X402_PAYMENT_PENDING`, still pages Sentry at error level). The comment no
longer says the block is unbounded pending a reconciler; the user message is
"contact support to have it resolved, then delete your account again"; and the
Sentry `extra` now carries
`resolveEndpoint: "POST /v1/admin/task-x402-payments/<id>/resolve"` so whoever
the page wakes does not have to go find the lever.

### Verification

- `pnpm --filter core test` — 370 files / 3526 passed (2 files, 6 tests
  skipped); the admin routes suite is 23 tests, the refund/resolve service suite
  20.
- `pnpm typecheck` all 9 workspaces (exit 0); `pnpm format` + `pnpm check` clean
  (3172 files).
- **Mutation-tested** (mutate → dedicated test fails → revert → green):
  1. authorization — `requireAdminAuthContext` → a bare `authContext` cast:
     "keeps the resolve handler admin-only without its parent router guard"
     fails (404 instead of 403);
  2. atomic claim — drop `status: PENDING` from the claim `where`: 3 tests fail
     (idempotent second call, VERIFIED refusal, FAILED already-compensated), all
     with `{ status: 'resolved' }` where a refusal was required;
  3. lease predicate — drop the `processingAt` branch: the lease-held test fails.
  The resolve service tests drive a behavioural in-memory row (`rowMatchesWhere`
  evaluates the `where` the way the database would) precisely so a weakened
  predicate changes an OUTCOME, not just the arguments a mock recorded.
- **Client regen:** `pnpm --filter web generate:core:snapshot` run and committed.
  Web does not call this admin surface, but the client is generated from the
  whole v1 OpenAPI document, and the snapshot was stale — it was missing the
  x402 admin list / aggregate / refund routes added earlier in this branch too.
  The diff is purely additive x402 admin content plus the 5 rewritten barrel
  lines.
- File sizes: refund service 530, resolve route 73, schema 191, deletion helper
  265, refund test 626, routes test 554 — all under the 750 ceiling (tests are
  exempt anyway).

### For the reconciler PR

`resolve` is a manual lever, not a substitute for the phased-settlement
reconciler. When that ships, the auto-refund sweep over stale PENDING rows
should take the same lease predicate and the same `updateMany` claim, and its
own action string (not `"resolve"`, which means "an operator decided").

## PR 1 — x402-6-admin security review round 2 — 2026-08-12

Four fixes and two recorded findings from a security review of the admin
surface. Every fix landed test-first (red captured, then green); findings 1 and
3 were mutation-tested (revert the mechanism, confirm red, restore, confirm
green).

### 1. `resolve` was corrupting the rollup's headline quality signal (MEDIUM)

`goodwillRefundCount` was `count(status === REFUNDED)` and is the PRIMARY sort
key. That definition was chosen deliberately (`7d77ede79`) because the automated
node-refusal refund leaves the row FAILED, so REFUNDED meant "operator goodwill
refund". The `resolve` lever added later in this same branch also writes
REFUNDED — from PENDING — and nothing in the rollup told them apart.

Concretely: an agent whose coworker integration produces ambiguous 200s and node
timeouts accumulates wedged PENDING rows; support clears 20 of them with
`resolve`; the aggregate then reports `{agentId: "A", goodwillRefundCount: 20}`
and ranks A first as the worst quality-bleeding endpoint, so an operator
disables a healthy agent. A hostile coworker can drive this deliberately against
a competitor: wedge PENDING rows, force operator resolves, competitor ranks
worst. It is the same false ranking `7d77ede79` removed for FAILED rows,
reintroduced by the resolve lever.

**Discriminator: an explicit `refundKind` column, not the implicit
`attemptId`.** An implicit discriminator did already exist — a goodwill-refunded
row always came from VERIFIED so always carries `attemptId != null`, while a
resolve-refunded row came from PENDING and always carries `attemptId == null`
(`attemptId` is written only in the VERIFIED update,
`task-x402-payment.finalize.ts`). Rejected. That invariant is a fact about where
finalize happens to write `attemptId` today, it is nowhere near the metric that
depends on it, and nothing would tell the next writer who changes when
`attemptId` is set that they had just silently redefined a money metric and its
ranking. The cost of the alternative is one migration
(`20260812100000_task_x402_payment_refund_kind`) adding an enum type and a
nullable column with no default and no backfill — a non-rewriting ALTER, on the
top branch of the stack, editing no parent branch's migration. Cheap; the
fragility was not.

`TaskX402PaymentRefundKind` is `NODE_REFUSAL | OPERATOR_GOODWILL |
OPERATOR_RESOLVE`, written by `attachCompensatingRefund` in the same UPDATE that
mints the refund transaction. The parameter is mandatory, and every refund in
the system is minted through that one function, so a refund cannot be created
without a label and the label cannot drift from the money it describes.

The rollup groups by `(agentId, status, refundKind)` — still ONE groupBy —
counts only `OPERATOR_GOODWILL` as the quality signal, and reports
`operatorResolveCount` beside it because the operator needs both numbers.
Resolves are deliberately absent from the comparator. A REFUNDED row with a NULL
kind is counted as NEITHER: guessing it into the ranking is the conflation the
column exists to remove, and `refunded - goodwillRefundCount -
operatorResolveCount` makes the unknowns visible. `refundKind` is on the list
row too — without it a REFUNDED payment is just as ambiguous on the operator's
screen as it was in the rollup.

The old test locked in the wrong semantics, including a comment ("agent-a has 1
REFUNDED (a real goodwill refund)") that stopped being true when `resolve`
landed in the same branch; it now carries `refundKind` and is joined by a test
whose resolve-produced REFUNDED rows must keep `goodwillRefundCount` at 0.

### 2. `required: true` on the refund/resolve body: a real control, no test

Verified empirically: with `required: true`, a POST carrying no content-type and
no body → 422 and the service is not called. Without it, @hono/zod-openapi skips
body validation entirely → **200**, and the money lever runs with no recorded
operator rationale. (It then 500s inside the transaction when `reason.slice()`
throws, so no money moves — but that is a downstream accident, not a route-level
guarantee.) Deleting the line left all 43 tests green.

One test per route now asserts 422 **and** that the service mock was not called.

### 3. The claim predicates omitted `refundTransactionId: null` — and the documented safety net does not exist

The previously accepted reasoning was that an anomalous PENDING-row-with-a-refund
would fail inside `attachCompensatingRefund` and roll back. **That premise is
false.** On this relation shape (`Parent.childId String? @unique` → optional
`Child?`, both optional) the nested create SUCCEEDS on Prisma 7.9.1: it
re-points the FK and orphans the prior child. So in the anomalous state either
lever would mint a second refund `Transaction` plus a second non-expiring REFUND
`CreditBucket`, orphan the first, and write a complete audit row asserting the
operator moved money once — silently.

Not reachable through app code today (`refundTransactionId` is only ever set
inside the same transaction as a terminal status flip, and nothing writes
`status: PENDING` back onto a row; `user-deletion-tasks.ts` already notes nothing
DB-level forbids it). But the stated justification was false, so it would not
have survived the next writer.

`refundTransactionId: null` is now part of the claim on both operator levers
**and** on the automated refusal claim, which had the identical hole (beyond the
review's scope, same file, same class — an anomalous row there now throws and
pages instead of silently double-refunding). Each lever names the anomaly rather
than falling through to a misleading branch: the goodwill lever used to answer
"cannot be refunded in status VERIFIED" (the one status it does refund), the
resolve lever answered with a fabricated sign-lease retry instant, and the
automated path said "could not be refunded (status PENDING)".

The review's related untested guard is closed too: dropping the
`payment.refundTransactionId !== null` conjunct from the `already_refunded` /
`already_resolved` guards left all 43 tests green, yet without it a terminal row
whose refund never landed is reported to the operator as "already compensated"
(409) while the user's credits are still gone.

Both operator levers' service tests now run on the behavioural in-memory row
(`rowMatchesWhere`, hoisted to module scope), not `mockResolvedValue({ count })`
— under a stub every predicate in the claim can be deleted without an assertion
noticing.

### 4. Unbounded filter strings

`agentId` / `caip2Network` / `id` were bare `z.string()`. No injection (Prisma
parameterises, equality only) and a bogus cursor returns empty rather than
erroring, so this is hardening, not a defect: `.max(64)` on `caip2Network` (its
column is `VarChar(64)`), `.max(128)` on `agentId` and `id`.

### `creditsCharged` on a sign-anomalous row — commented, not flagged

The list surfaces the debit's MAGNITUDE, so a row with an anomalous POSITIVE
`transaction.amount` displays as "3 credits charged", indistinguishable from a
real debit. Kept: the alternative is a negative value that fails the
`nonnegative()` parse and 500s the operator's entire view over one bad row. The
test now says so explicitly, and says the row is NOT flagged — the anomaly stays
recoverable from `transactionId` when a dispute needs it.

### Recorded, not fixed

**(a) The admin surface hides the one fact `resolve`'s safety argument turns
on.** A PENDING row can still correspond to a successful node sign: the
signed-tuple-mismatch path in `task-x402-payment.finalize.ts` receives a VALID
header and deliberately discards it, and a DB failure at the VERIFIED update
strands a good sign. `attemptId`, `validBefore`, `payerAddress` and
`payloadNonce` are all written only at VERIFIED, so the list shows them null for
every PENDING row and the operator cannot tell "never signed" from "signed and
discarded". User credits are correct either way — only Soko's managed wallet is
exposed — so this is not a defect in `resolve`. **Follow-up:** record the sign
outcome on the row (a nullable `signOutcome` / discarded-header marker written
by the finalize paths that currently return 502 while holding the row PENDING)
and surface it on the admin list, so an operator resolving a wedged charge knows
whether a real authorization is loose. Spans PR 5's finalize paths, so it does
not belong in this branch.

**(b) `requireAdminAuthContext` accepts any `actor: "user"` context.** That
includes a Better Auth API key and an OAuth access token bearing `sokosumi:api`
that belongs to an admin user — so a third-party OAuth client an admin consented
to can call these money levers. Pre-existing and true of every `/v1/admin/*`
route; out of scope here.

### Verification

- `pnpm --filter core test` — 370 files / 3579 passed (2 files, 6 tests
  skipped). Admin routes suite 30 tests, refund/resolve service suite 25.
- `pnpm typecheck` all 9 workspaces, exit 0; `pnpm check` clean (3173 files).
- **Mutation results.**
  1. Finding 1, rollup mechanism — count every REFUNDED row as goodwill again:
     2 tests fail, and the false ranking is visible in the diff (agent-a first
     with `goodwillRefundCount: 20` against agent-b's real 1). Restored → green.
  2. Finding 1, write side — resolve labels its refund `OPERATOR_GOODWILL`: the
     resolve service test fails (`expected 'OPERATOR_GOODWILL' to be
     'OPERATOR_RESOLVE'`). Restored → green.
  3. Finding 2 — delete `required: true` from both routes: both new tests fail,
     `expected 200 to be 422`. Restored → green.
  4. Finding 3a — drop `refundTransactionId: null` from both operator claims:
     3 tests fail; the two anomaly tests return `refunded` / `resolved`, i.e.
     the second refund is minted. Restored → green.
  5. Finding 3b — drop the `refundTransactionId !== null` conjunct from both
     already-compensated guards: both new tests fail
     (`already_refunded` / `already_resolved` returned for a terminal row whose
     refund never landed). Restored → green.
- **Migration validated against local Postgres 16** (Homebrew, `pg_isready` ok),
  on a throwaway `x402_migration_check` database: deploy-from-zero applied all
  266 migrations including this one; `migrate deploy` again reported "No pending
  migrations"; re-running the migration's SQL directly re-applied cleanly
  (`CREATE TYPE` guarded by the `duplicate_object` DO block, `ADD COLUMN IF NOT
  EXISTS` → notice + `ALTER TABLE`); the enum has exactly the three labels and
  the column is present. `prisma migrate diff --from-config-datasource
  --to-schema` reports **no x402 drift** — its only output is the pre-existing
  `chat_room` / `chat_room_guest_invitation` partial-unique-index entries that
  `migrate diff` does not round-trip.
- **Client regen:** `pnpm --filter web generate:core:snapshot`, committed as
  generated output. Additive only: `refundKind` on `AdminTaskX402Payment` and
  `operatorResolveCount` on `AdminTaskX402PaymentAgentAggregate`.
- Nothing weakened: both claims are still `updateMany` with a status predicate
  branching on `count`, the sign-lease refusal is still inside the resolve
  claim, action+audit still share one transaction, and `xPaymentHeader` is still
  absent from every admin select and schema.
- File sizes: refund service 610, aggregate route 125, schema 221 — under the
  750 ceiling (test files exempt).

## PR 1 — x402-6-admin final review remediation — 2026-08-14

Two review findings closed before the final clean pass.

### Empty filters fail closed

`agentId=` and `caip2Network=` previously passed the optional string schemas.
The list and aggregate handlers then treated the empty string as absent and
broadened the query to every payment. Both filters now trim and require at
least one character before reaching Prisma. Route tests pin empty and
whitespace-only values to 422 and prove no list or aggregate query runs.

### Audit reasons are codes, never narratives

`TaskX402PaymentAction` is FK-free and survives account deletion, so its
`reason` must not retain names, email addresses, support-case prose, or other
personal data. The refund route now accepts only
`agent_output_quality | duplicate_charge | support_adjustment`; the resolve
route accepts only
`account_deletion_blocked | node_unreachable | sign_attempts_exhausted |
unsettleable_authorization`. Service input types derive from those request
schemas, keeping future typed callers on the same closed vocabulary. Narrative
route tests return 422 before either money service runs.

The generated web Core client was regenerated, so both request DTOs expose the
same literal unions.

### Verification

- Targeted Core suite: 75 tests passed across admin routes, refund/resolve
  service, and user-deletion guard.
- Core and Web typechecks passed.
- Biome checks and `git diff --check` passed.

## PR 1 — temporary x402 gallery cards — 2026-08-14

The authenticated Agents gallery now renders payable x402 entries in a
dedicated temporary rail above the standard catalog. Each non-hireable card is
explicitly tagged `x402` and `Preview`, shows the first network, payment-route
count, and lowest credit price, and labels the current access path as Coworker
access. It does not link to the standard agent detail or hire flow because
those routes still support Standard entries only.

`GET /v1/agents/x402` now accepts an authenticated user actor in addition to a
direct coworker-agent context. User actors include sessions, Better Auth API
keys, and OAuth tokens; delegated coworkers and orchestrators remain rejected,
and `POST /v1/tasks/{taskId}/x402-payments` remains coworker-only. The web
loader follows every candidate cursor even when fail-closed filtering returns
an empty intermediate page. Its private cache retains results during browser
navigation; server renders still crawl all candidate pages. Gallery search matches x402 names,
descriptions, and the `x402` tag. Existing readiness, pricing, network, status,
and `isShown` curation gates are unchanged.

Dynamic-price previews are also returned to direct coworker-agent callers.
They remain explicitly `isPayable: false`; the task payment endpoint still
requires a registered fixed-price source.

Prices use significant-digit formatting, so positive sub-cent prices never
render as zero. `PR1-SPEC.md` records the temporary gallery and expanded listing
auth contract explicitly.

### Verification

- Core suite: 369 files / 3590 tests passed (2 files, 6 tests skipped).
- Web suite: 496 files / 3212 tests passed (1 test skipped).
- Root Biome check and all-workspace typecheck passed on Node 24.14.0.
- Mock-only component harness rendered three cards for visual review; the
  harness was removed after capture.

### Review remediation

- The x402 catalog includes both X402-manifest and OpenAPI registry entry
  shapes. Settlement capability comes from EVM `SupportedPaymentSources`, so
  both shapes pass through the same pricing, network, readiness, and curation
  gates. Non-x402 sources on multi-rail OpenAPI entries are excluded before
  those gates.
- Registry sync now uses a projection-versioned cursor key. Old and new
  binaries cannot advance the same cursor during a rolling deployment, so
  dynamic-pricing backfill starts from the beginning without a migration race.
- Positive prices down to the platform floor retain significant digits instead
  of rendering as zero; the component test covers `1e-10` credits.
- The authenticated all-page x402 load uses a private Next.js cache during
  browser navigation. Server renders still repeat the database crawl, keeping
  session-bound Core access out of shared caches.
- Core route docs and `PR1-SPEC.md` now state that `actor: "user"` includes
  sessions, Better Auth API keys, and OAuth tokens.
- Focused verification passed: 5 Web tests and 16 Core route tests. Root Biome
  check and all-workspace typecheck passed again on Node 24.14.0.
- Core OpenAPI snapshot/client regeneration completed. Production build was
  attempted, but this execution environment denied Turbopack's local subprocess
  port binding before source compilation completed.

## PR 1 — dynamic x402 gallery previews — 2026-08-15

Registry `Dynamic` pricing is now persisted as `PricingType.DYNAMIC` instead of
being collapsed into `UNKNOWN`. Authenticated user actors receive those agents
as temporary gallery cards with `pricingType: "dynamic"` and
`isPayable: false`; cards show `Dynamic pricing` and `Preview only` without an
amount. Direct coworker listings remain fixed-price-only, and the x402 payment
endpoint still verifies fixed registered amounts before signing or charging.

Dynamic previews require an online, visible X402 agent whose sources all use
dynamic pricing, exact scheme, valid EVM recipients, and an environment-allowed
network. They do not require buy-side asset readiness because no payment is
offered.

The enum migration is followed by a one-time agent-sync cursor reset. Existing
dynamic sources had already been persisted as `UNKNOWN` by older Core builds;
an incremental sync cannot revisit unchanged registry entries. Replaying the
registry backfills them from source-of-truth without guessing which historical
`UNKNOWN` rows were dynamic.

Authenticated operators can now request the same safe replay directly with
`GET /sync/agents?replay=true`. Scheduled calls without that flag remain
incremental, avoiding a full registry scan every five minutes.

## PR 1 — dynamic x402 coworker payments — 2026-08-15

Dynamic registry sources now enter the coworker task-payment flow. Their
runtime 402 supplies the asset and amount, while the registered source still
pins exact scheme, network, and recipient. The demanded asset must be
buy-side ready and have a configured CAIP-19 credit price. `maxCredits` is
mandatory for every fresh dynamic payment, so the agent-authored quote cannot
debit beyond the coworker's independent task budget ceiling.

Dynamic payments reuse the fixed flow's serializable charge, idempotency,
single-entry node request, signed-tuple verification, synchronous refusal
refund, PENDING replay lease, attempt cap, and admin reconciliation records.
When no priced ready asset exists on an advertised network, the agent remains
discoverable with `isPayable: false`; otherwise dynamic cards advertise
coworker access without inventing a static amount.

## PR 1 — gallery preview disabled — 2026-08-17

The August 14–15 gallery work remains in the tree behind a disabled constant.
The Agents page does not call the x402 loader. It passes no x402 rows to card
rendering or catalog search. The standard Core catalog also retains its
`type: STANDARD` filter. The dedicated authenticated x402 discovery route
remains available for API clients.

## PR 6 — durable x402 admin outcome metrics — 2026-08-17

Admin lifecycle totals still describe retained payment rows. Failure,
goodwill-refund, and operator-resolve counters now come from the FK-free action
ledger, so account deletion cannot erase agent-quality history or change the
ranking. Automated first-attempt refusals write `action: "failure"` with the
reserved `system:x402` actor and full financial snapshot.

A forward migration backfills surviving FAILED payments, enforces one failure
outcome per payment, and installs an idempotent trigger. The trigger covers old
binaries during rolling deploys; new binaries use duplicate-safe insertion and
converge on the same partial unique index.

Final rollout hardening installs every compatibility trigger before its
backfill while holding payment/action write locks in an explicit transaction.
Legacy PENDING rows receive a conservative risk window from their latest
stored timestamp. Old operator writers have their final charge/refund
correlation filled by a database trigger.

Account deletion now locks the User row first and performs the User delete in
the same transaction as payment/task cleanup. Better Auth's following adapter
delete is intentionally a not-found no-op. This removes the prior unlocked gap
where a coworker charge could add a RESTRICT child after cleanup.

## Scan close-out — remaining findings — 2026-08-17

Four verification passes over the scan fix pass confirmed 15 of 20 findings
fixed with pinning tests. This round closes the remainder.

Curated exposure no longer survives a discovery-identity move. The endpoint
guard is extracted into `agent-sync.revision-guard.ts` and extended: any sync
update that changes a row's entry type or its type-specific discovery URL
(x402 resources index, OpenAPI document) unpublishes the row and pages, even
without a revision promotion, because the projection rewrites those fields on
every update. Gaining a first discovery URL keeps the endpoint guard's
add-carve-out.

The listing response schema now enforces what the route guarantees: discovery
URLs are `z.httpUrl()` (absolute HTTP/S) rather than free strings, so a future
producer bypassing the route gate fails parse. The pay contract text no longer
claims "never signs twice"; it states the true invariant — never charges
twice, re-signs only an attempt whose outcome is unknown. PR1-SPEC §2 now
documents the full shared listing predicate (discovery-URL gate, exact/EVM
payTo, FIXED amount rows at node decimals, conflicting-price drop) instead of
a five-item subset. The metadata-getter tests dropped by the agent-metadata
merge-back are restored in `agent.test.ts`.

## Vercel webhook miss on the convergence fix — 2026-08-17

The push of the trigger drop/recreate migration fix reached origin and GitHub
CI went fully green, but Vercel created no deployment for it in any of the
four projects — the push webhook was silently missed, so the branch's latest
Vercel state stayed the two failed core preview builds from the prior commit.
This commit exists to re-fire the webhook with a regular push; it carries this
log entry and no code changes.

## PR 2 quality review round (xhigh, stacked-review pass 1) — 2026-08-18

Full ten-angle review of PR 2 (model) verified against the stack tip, findings
fixed on `x402-6-admin`. Landed:

- **finalize stores `charged.payTo`, not the node's casing** (`payTo` column
  stayed canonical-lowercase; node spelling had leaked into the VERIFIED
  update and the response). Pinning test added.
- **Deletion sweep polarity inverted, fail-closed**: one
  `SWEEPABLE_X402_STATUSES` list drives the unresolved guard (`notIn`), the
  foreign-charge detector and the sweep (`in`). A future enum member now
  blocks deletion with a page (`TASK_X402_PAYMENT_UNRESOLVED`) instead of
  being hard-deleted or leaking to a RESTRICT-FK 500.
- **Deletion transaction gets an explicit `{ maxWait: 5s, timeout: 30s }`**:
  the default 5 s budget predated the x402 locks/sweeps; P2028 escaped the
  conflict mapping as a deterministic 500 for heavy accounts.
- **Payment lock query rewritten as three UNIONed index-served arms**: the
  OR across charge/refund/task joins could not use any index and scanned the
  payments join per deletion while holding the user/task locks.
- **Conflict error renamed `ACCOUNT_DELETION_CONCURRENT_CHANGE`**: the catch
  wraps the whole transaction; claim sweeps and the user-row lock conflict
  too, so an x402-specific code misdirected support.
- **Foreign-charge page now states the repair is manual** — refund/resolve
  only move status and every terminal status stays in the detector's
  predicate, so no admin endpoint clears the block.
- **Agent consolidation repoints x402 rows**: `taskX402Payment` and the
  FK-free action ledger both carry a denormalized `agentId`; a parked
  rollback-era duplicate would otherwise split the admin refund-rate rollup.
- **Test hardening**: convergence suite now pairs the nonce/payer CHECK name
  with its exact predicate (disjoint-count matching could be satisfied by
  vacuous spellings), takes enum truth from the generated Prisma enum with
  wide SQL captures, and shares `schema-fixtures.ts` with the catalog-index
  suite; subsumed sweep-shape test folded into the predicate test.
- **Doc corrections**: purge comments no longer describe the removed
  best-effort `validBefore` parser as current; deletion docblock no longer
  claims the PENDING block is unbounded (the resolve lever bounds it);
  schema comments scope the "deletion resolves payments first" guarantee to
  the self-service path, cross-reference the claim-action sibling table, and
  warn the future reconciler off status-only expiry scans.

Documented, not fixed: the frozen base migration's FK `ADD CONSTRAINT`s take
SHARE ROW EXCLUSIVE on `task`/`Transaction`/`Agent`/`taskEvent` with no
`lock_timeout` — the file is byte-pinned and already applied everywhere the
stack deploys, and no migration in this repo sets lock timeouts. Deploy the
merge during a quiet window; future x402 migrations that FK hot tables should
carry `SET LOCAL lock_timeout`.

## PR 2 fresh re-review (round 2) — 2026-08-18

Fresh-eyes pass over the PR 2 diff, all candidates verified against the stack
tip. One finding survived: the live-authorization deletion guard was
status-scoped to [VERIFIED, REFUNDED] while the header purge on the same rows
is deliberately status-unscoped ("a credential-retention control must not
depend on writer discipline"). Unreachable today — every FAILED writer
provably precedes header issuance — but a header-bearing row in another
sweepable status would have slipped past the guard and been hard-deleted with
its authorization live. The guard now drops the status filter and keys on
`xPaymentHeader` + `validBefore` alone, matching the purge's principle; rows
without a live header never match, so nothing legitimate changes. Predicate
pinned exact-match in the test. PR 2 is otherwise clean.

## PR 3 quality review round (xhigh, stacked-review pass 1) — 2026-08-18

Ten finder angles over the PR 3 helpers diff (vs `x402-2-model`), every
candidate verified against the `x402-6-admin` tip; fixes land on the tip, no
child rebases. Commit `5d42bfc0f`.

**Fixed (10):**

- **CAIP-2 pattern anchored** — `CAIP2_EVM_NETWORK_PATTERN` and the CAIP-19
  key pattern accepted leading-zero / >32-digit chain ids, and
  `normalizeX402NetworkId` passes matches through verbatim, so
  `eip155:08453` was emitted as "canonical" — a second spelling for chain
  8453, the exact thing the unit-key design promises can never exist. Chain
  references now match `(0|[1-9]\d{0,31})`; regression pins in the caip19
  and normalizer suites.
- **Readiness read poisons duplicate pairs** — the compose side keys its
  output on (network, asset) but the READ side trusted cache order, so a
  legacy/hand-edited row respelling the same pair rode alongside the
  canonical one and `findX402ReadySource`'s first-match picked the signer
  wallet and charge scale. Read now mirrors the compose rule: exact repeats
  collapse, disagreeing repeats drop the pair entirely.
- **Alert latch can no longer disarm silently** — a failed cleanup of the
  readiness failure marker was warn-only; the stale marker makes every later
  failure streak's `createMany` latch report count=0, so the next real
  outage would page nobody. Cleanup failure now pages
  (`x402_readiness: marker_cleanup_failed`).
- **Zero amounts refused per entry** — `normalizeAmount` accepted `"0"`, so
  a zero-amount entry won selection and died downstream at pricing instead
  of skipping to a payable sibling.
- **Pricing 422 echo bounded** — `Invalid x402 amount:` reflected the raw
  amount unbounded; now `truncateEcho`d like every other echo on the path.
- **api-key-status memoized per client instance** — budgets and admin
  wallets each fetched it per call (two identical round-trips per sync
  cycle); the resolution is now memoized per instance (failures and thrown
  fetches never memoized), and the sync shares ONE client per cycle.
- **Shadow-key set derived from the schema shape** — the recognized-entry
  keys were listed three times; the lowercase set now derives from
  `wildRequirementShape`, so a new dialect field can never silently become
  forwardable in shadow spellings.
- **`getAgentCost` passthrough collapsed**; **dead `X402SupportedScheme`
  deleted**; **limits `export *` narrowed** to the five names apps consume.

**Documented, not fixed:**

- **Merge-gap PR5→PR6**: PR 3's normalizer forwards `extra.name`/`version`
  (the EIP-712 domain) verbatim, and pricing's duplicate-unit 500 guard
  arrived later — the trusted-domain gate (`X402_TRUSTED_EXACT_EVM_DOMAINS`)
  and the CreditCost multi-match 500 exist only in PR 6. Merging PR 5
  without PR 6 ships a pay route where a hostile 402 defines the domain the
  managed wallet signs under. The stack must merge through PR 6; PR 5's
  description carries the warning.
- **Structural refactors deferred to follow-ups** (chips filed): shared
  readiness-sync engine + cached-read scaffold (x402 copy duplicates the
  Cardano copy — the marker-cleanup gap arose exactly from lockstep-patch
  drift); one `canonicalizeEvmAddress` owner (~6 re-implementations); a
  pricing-convention discriminant where CreditCost rows are LOADED rather
  than per-site string fences; one shared EVM-network registry (core
  allowlists vs masumi v1-name map are hand-kept twins).
- **Test placement** (core x402 tests colocated next-to-source vs AGENTS.md
  `__tests__/`): consistent with the dominant de-facto core practice; not
  churned.
- **Moot**: `isX402SourceReady` dead wrapper — deleted later in the stack
  (PR 4).

## PR 3 fresh re-review (round 2) — 2026-08-18

Three independent reviewers over the PR 3 diff, verified against the tip: a
fresh full-diff pass (returned clean), an adversarial audit of the round-1
fix commit, and a second-tier gap sweep. Five findings survived; all fixed
in `523df5432`.

- **The round-1 pattern anchor had narrowed the Cardano pricing fence.**
  `isCaip19AssetKey` is used NEGATIVELY in `agent-cost.ts` — to keep
  eip155 units OUT of the per-smallest-unit path — and anchoring the
  pattern meant a misspelled key (leading-zero chain id) escaped the fence
  and could be priced per smallest unit against a whole-token
  `centsPerUnit`. New `isEvmNamespacedUnit` fences the whole `eip155:`
  namespace; the canonical pattern remains the positive gate. The two
  directions now have two named tools, each documented against the other.
- **The balance-eligibility sweep now uses compose's own chain gate**
  (`computeEnabledPricedNetworks`, extracted): previously a hand-copied
  subset without the trusted-domain check or duplicate poisoning, so a
  chain compose would refuse still had wallets balance-fetched — and one
  flaky balance read there failed the whole check, keeping a stale ready
  pair served exactly when the node state would delist it.
- **isEnabled contradictions poison the chain** (either arrival order),
  same doctrine as the decimals conflict.
- **Code-unit comparison replaces localeCompare** in the wallet tie-break
  and the ready-source sort: the serialized array is the change-detection
  key and must not depend on the host's ICU build.
- **The shared api-key-status fetch runs signal-less**; each caller races
  its own signal (`raceWithAbort`), so one caller's abort cannot fail a
  concurrent caller or poison the memo. Failures are cleared at the
  source, not by whichever caller happens to await.

Verified clean by the same round: zod 4.4.3 looseObject+refine behavior
after the shape extraction (probed empirically), truncateEcho surrogate
handling, prototype-pollution paths, BigInt comparisons, the Map dedup's
ordering after the allowlist re-filter, and the new tests' mock hygiene.

## PR 3 fresh re-review (round 3) — 2026-08-18

Two reviewers over the current tip: an adversarial audit of the round-2 fix
commit (3 findings) and a second-tier gap sweep (5). Eight findings, all
fixed or documented.

Fixed:

- **Pre-aborted callers now reject before the shared api-key-status fetch
  fires or memoizes.** The round-2 abort isolation raced the signal only
  AFTER populating the memo, so a caller arriving with an already-aborted
  signal still spent a request; the test's "before any request" title was
  aspirational. `resolveApiKeyStatus` early-rejects on `signal.aborted`
  now, and the test pins that neither node mock is called.
- **Far-side error text is bounded before paging.** `checkError` joins up
  to three endpoint errors plus one per balance-fetched wallet, each
  potentially `extractNodeErrorMessage`'s stringify of an entire proxy
  body — unbounded, the Sentry SDK's own truncation dropped every error
  after the first fat one. Per-item cap (200) keeps later errors visible;
  total cap (2000) mirrors the pay path's `MAX_NODE_MESSAGE_ECHO_LENGTH`.

Documented as accepted:

- **Lock-steal straggler writes** (audit + sweep, same mechanism): the
  agents-sync lock is stealable after LOCK_TIMEOUT, and the readiness DB
  writes deliberately take no abort signal and no ownership re-check. A
  ~LOCK_TIMEOUT-stalled holder can commit one stale cursorId (pay
  re-verifies against the node — money-safe) or mute/spur one failure
  page for a cycle. Fencing every write on ownerToken is sync-lock-wide
  work; accepted and documented at `syncX402BuySideReadiness`'s doc.
- **isEnabled-duplicate poisoning can delist a chain an operator meant to
  rotate** (duplicate row + disable): deliberate — availability plus a
  page, never a mischarge. Documented at `computeEnabledPricedNetworks`;
  operators must delete replaced rows, not leave them disabled.
- **Multi-pair compose/sort is untestable today** — compose refuses every
  chain outside the one-entry allowlist, so no input reaches the
  comparator with two pairs. Noted at the comparator: whoever grows the
  allowlist adds multi-pair tests in the same change.
- **The test file's `composeX402ReadySources` wrapper shadows the real
  export and fabricates funded wallet states** — a future author could
  assert against wrapper-synthesized bindings believing they hit the real
  default. A warning doc now sits on the wrapper.
- **Route-level poison coverage**: the listing route test feeds only
  well-formed rows, but it mocks nothing below `getX402ReadySources`, so
  the helper unit tests cover the identical code path the route runs. No
  action.
- **Cardano rail readiness lacks the localeCompare fix and the
  cleanup-failure page** the x402 rail now has — out of this PR's scope;
  spun off as a follow-up task.

## PR 3 fresh re-review (round 4) — CLEAN — 2026-08-18

Two reviewers: a fresh full-diff pass with no knowledge of prior rounds
(returned NO FINDINGS after verifying the whole PR 3 surface against the
tip — CAIP-19 canonicalization, both pricing-convention fences, the 402
normalizer stack, the client's self-scoped budgets and abort semantics,
the readiness cache and sync, cross-file wiring, and all 265 x402 tests)
and an adversarial audit of the round-3 fix commit. The audit surfaced
one test-coverage gap: the readiness error line's 2000-char TOTAL cap was
unpinned — the integration test's inputs could not exceed it after
per-item slicing, so a partial revert kept every suite green. Fixed in
`627413821` by extracting `boundCheckErrorForLogging` and pinning both
halves of the bound directly. PR 3 declared review-clean after four
rounds.

## PR 4 listing quality review (round 1) — 2026-08-18

Ten-angle review of the PR 4 diff (x402-4-listing vs x402-3-helpers,
verified at the x402-6-admin tip): 35 raw candidates, 28 after dedup,
every survivor verified by a dedicated agent. Ten fixed, the rest
refuted or documented as deliberate.

Fixed:

- **The duplicate-CreditCost misconfiguration now pages instead of
  masquerading as "unpriced".** `CreditCost.unit` is unique on the RAW
  string, so a case/whitespace variant coexists with the canonical row;
  `calculateCentsFromX402Amount` correctly 500s on it, but both listing
  builders swallowed that throw as `unpriced_asset` — and for fixed
  agents the pay path re-runs the listing gate, so NO loud surface
  existed anywhere. Both catches now classify 500-class `HTTPException`s:
  `Sentry.captureException` plus a dedicated `pricing_misconfigured` drop
  reason on the fixed path, Sentry plus fail-closed non-payability on the
  dynamic probe. Tests pin both paths.
- **One identity gate instead of two verbatim copies.** The fixed and
  dynamic builders each carried the payTo/scheme/network gate sequence;
  extracted as `gateX402SourceIdentity`, shared by both.
- **One scheme allowlist instead of three spellings.**
  `X402_SUPPORTED_SCHEMES` (masumi) is now imported by the listing gate
  and the pay-side `sourceIdentityMatches`; the private listing constant
  and the matcher's `"exact"` literal are gone. Its doc now names all
  four enforcement points and what growing it additionally requires.
- **One row type for the listing/pay twins.** `X402VerifiableSourceRow`
  duplicated `X402AgentPaymentSourceRow` field-for-field; the matcher now
  imports the listing's type, so a column added to one side's select
  cannot silently keep the other compiling on the old shape.
- **Untrusted-domain readiness gap now has a signal.** An enabled, priced
  chain whose asset is missing from `X402_TRUSTED_EXACT_EVM_DOMAINS` was
  silently recorded unready — indistinguishable from node state. Compose
  now warns naming the exact pair and the map; the zero-pairs Sentry
  remediation text names the trusted-domain map and the CAIP-2 allowlist.
- **Route reads run concurrently** (`getX402ReadySources` +
  `creditCost.findMany` under `Promise.all`), the `total` field's
  candidate-not-payable semantics are documented in the OpenAPI
  description, and `?cursor=` (empty string) now counts as the unfiltered
  first page for the all-dropped warn (`!cursor`, not `=== undefined`) —
  with a test.
- **Smaller literals**: the sync route's two 10s timeouts share
  `READINESS_SYNC_TIMEOUT_MS`; the route fixture uses
  `X402_BUY_SIDE_READINESS_KEY` instead of a hardcoded key; three stale
  comments corrected (the catch's "exact set" claim, the "never trims"
  note, the deleted early-out reference, the impossible abort-throw
  example).

Refuted: the scheme filter's listed-but-unpayable asymmetry is
spec-ratified (non-x402 rails are excluded first, and the query filters
`scheme: { not: null }` on both listing and pay paths — symmetric);
abort noise cannot reach the sync route's Sentry catch (the sync catches
aborts internally); `normalizeEvmAddress` is not a drop-in for the gate's
sites (they deliberately differ on trim-vs-validate order).

Documented as deliberate: the fixed builder's unreachable empty-`listed`
drop (schema guard), the dead registry-decimals comparison in the
conflict check (invariant guard), the standalone pricingType re-checks in
both builders (each builder is a contract on its own), and
`findReadySource`'s re-normalization (defense in depth). Deferred with
existing chips/notes: network-alias divergence, per-request CreditCost
fetch, serial readiness syncs (~7% of the lock budget), and the
sync-route orchestration pattern.

## PR 4 fresh re-review (round 2) — 2026-08-18

Two reviewers: a fresh full-diff pass with no knowledge of round 1
(returned NO FINDINGS after verifying the whole PR 4 surface against the
tip — it chased and killed the schema-parse URL divergence, listed⇒payable
select drift, falsy-zero decimals, BigInt notation, dedupe-key collision,
mount-order capture, and log hygiene) and an adversarial audit of the
round-1 fix commit `53dcd0058`. The audit confirmed the fixes faithful
(scheme fold-then-membership semantics identical, drop-reason order
preserved, no stale type or literal copies, every new test fails under a
revert of its fix) but surfaced three defects in the NEW code, all fixed:

- **The misconfiguration capture was unthrottled on a request-serving
  path.** @sentry/node 10.x ships no dedupe integration, so one lingering
  duplicate CreditCost row let any authenticated caller loop
  `GET /v1/agents/x402?limit=100` into per-request Sentry volume — the
  opposite policy of the route's own traffic-independent warn gating.
  Captures now dedupe once per process per distinct error
  (`reportX402PricingMisconfiguration`, capped set), with the drop reason
  still reported on every call.
- **Non-HTTPException throws were still folded into `unpriced_asset`.**
  The classifier's misconfiguration branch is now the ELSE arm — only the
  pricing helper's own 422s read as unpriced; a future TypeError or
  foreign-hono HTTPException surfaces as misconfiguration instead of
  recreating the silent swallow.
- **The dynamic probe's `.some()` short-circuit was order-dependent.** A
  healthy pair sorted before a misconfigured pair on the same network
  masked the misconfiguration's only pre-pay signal. The probe now scans
  every matching pair (compose caps one pair per chain today, so the
  exhaustive scan is free) while payability still needs only one healthy
  pair. Tests pin the once-per-process dedupe, the healthy-first probe
  order, and all four classifier arms.

## PR 4 fresh re-review (round 3) — 2026-08-18

Two reviewers again. The adversarial audit of `63d731f79` confirmed the
round-2 fixes faithful and surfaced four hardening findings, fixed in
`e9346dfb9`: the dedupe key is now error NAME plus message (two classes
with one coincidental message stay two Sentry events) and its derivation
can no longer throw on an exotic non-Error value (a secondary throw
inside the builders' catch would have 500'd the whole listing); cap
overflow now CLEARS the set — mirroring `reportUnknownPurchaseValue` —
instead of abandoning dedupe for every error past the cap; and the
broadened classification is pinned AT THE BUILDER with a poisoned
CreditCost getter, killing the mutant where a re-guarded catch folds
TypeErrors back into unpriced_asset while classifier unit tests stay
green.

The fresh full-diff pass (at tip `63d731f79`) found nothing
CONFIRMED-severity and two plausible gaps, both fixed:

- **Ready-but-unpriced dynamic previews were silent everywhere.** A
  missing CAIP-19 CreditCost row on a buy-side-ready pair flipped every
  dynamic agent to `isPayable: false` with no log, no Sentry, no tally —
  while the identical operator error on a fixed agent tallies as
  `unpriced_asset` and the sync side records the pair READY. The dynamic
  builder now flags "ready but unpriced is WHY this source is not
  payable" (`hasUnpricedReadyPair`, set only when no healthy pair rescued
  the source), and the route tallies it as `unpriced_dynamic_preview`
  through the existing per-request drop pipeline.
- **Dynamic sources were advertised without dedupe.** A registry entry
  repeating one (payTo, network) source at distinct sourceIndex values
  produced N identical preview entries, inconsistent with the fixed
  builder's triple dedupe. The dynamic builder now dedupes on the
  case-folded pair before probing (a duplicate's probe outcome is
  identical by construction, so payability and the unpriced flag are
  unaffected).

Tests pin the tally (route + builder), the healthy-pair-suppresses-flag
rule, and the pair dedupe at both levels.

## PR 4 fresh re-review (round 4) — 2026-08-18

Fresh full-diff pass at tip `bddff477a`: NO FINDINGS (verified gate
integrity, four-layer allowlist enforcement, the dedupe latch, probe
semantics, pagination, log hygiene; empirically ruled out the
isValidHttpUrl/z.httpUrl divergence on 15 adversarial URLs). The
adversarial audit of the round-3 commits confirmed the dedupe-before-
probe soundness, the flag invariant, the tally's warn-safety, and the
schema surface, and surfaced two confirmed mutation-test gaps plus five
hardening/doc items — all addressed:

- **Both dedupe tests' case-fold fixtures were vacuous** (PAY_TO is all
  digits, so its uppercase respelling was byte-identical). Fixtures now
  use letters-bearing checksummed addresses at both the builder and the
  route level, so removing the fold genuinely fails them.
- **The dynamic-arm flag propagation is now pinned** through
  `buildX402AgentPricingListing`; the MIXED arm's propagation is
  provably dead while the per-environment allowlist holds one network (a
  listed fixed source implies a priced ready pair on the only network
  the dynamic sources can share) — documented at the arm, propagated
  anyway so allowlist growth cannot silently lose the tally.
- **The overflow test now kills the cap-deletion mutant**: after
  overflow, a pre-overflow key re-reports once (clear ⇒ re-capture; an
  unbounded set would still dedupe it).
- **The key derivation is throw-proof on BOTH arms** (a hostile
  `name`/`message` accessor on an instanceof-Error value is caught, not
  just ToPrimitive failures), and the all-exotics-share-one-key collapse
  is documented as accepted.
- **Flag semantics docs corrected** ("no probe succeeded and at least
  one threw the 422" — a sibling misconfigured pair may ALSO fire
  Sentry; the signals are independent) with a composition test pinning
  the double-signal case.
- **The debug line no longer claims previews were "dropped"**: it reads
  "non-payable agents by reason"; the warn keeps "dropped" because the
  non-drop tally provably implies a listed agent.

## PR 4 fresh re-review (round 5) — 2026-08-18

The adversarial audit of `fa5e5ff75` verified all six of its claims
(fixtures genuinely letters-bearing, warn-line drop-only property proven,
overflow arithmetic walked, composition single-capture traced) and
surfaced four gaps, fixed in `370bdfad6`: the hostile-Error-accessor
guard and the hardcode-TRUE dynamic-arm flag mutant were both untested
(now pinned); the never-throw contract still had two attackable reads
(the pre-derivation `status` getter and the fallback's Symbol.toStringTag
— the classifier now carries its own outer catch as THE floor, capture
included); and the mixed-arm unreachability proof silently leaned on
cache canonicality (the probe now normalizes its network compare like
`findX402ReadySource`, with a padded-spelling test).

The fresh full-diff pass (218 targeted tests green at tip) found one
plausible defect, fixed in `58efea6b1`: **budget-backed readiness is
admin-only in practice, and the docs promised otherwise.** Budget rows
bind to wallets in the admin-only listing (a deliberate money-safety
gate: never mark a pair ready without verifying live wallet balances),
but `getX402AdminPurchasingWallets` returns an empty list for non-admin
keys — so a deployment with a capable-looking non-admin key gets three
green node checks, funded budgets, and a permanently empty readiness
cache, while two doc comments claimed non-admin keys "remain
budget-gated". The binding is kept (fail closed, never a mischarge);
the contradicting docs in compose and the masumi client now state the
admin-key requirement, compose warns by name when funded budgets meet an
empty wallet listing, and the zero-pairs Sentry remediation leads with
the canAdmin check. A test pins the warn.

## PR 4 fresh re-review (round 6) — 2026-08-18

The fresh full-diff pass came back clean: NO FINDINGS, with 227
targeted tests and a core typecheck run at tip `2fe26b395`, and every
dismissed candidate chased to ground (probe-amount safety, zod URL
parity, listed⇒payable symmetry, triple-enforced environment allowlist).

The adversarial audit of `370bdfad6` + `58efea6b1` found four defects,
fixed in `cd879502f` — including a correction OF round 5's fix: **the
"non-admin trap" warn described an unreachable scenario.** The node
admin-gates `GET /x402/budgets` itself, so a plain non-admin key fails
the readiness sync's check step before compose ever runs — it surfaces
as a failed check, never as funded budgets meeting an empty wallet
listing. The states that actually reach the warn are an admin key whose
listing yields no usable Purchasing wallet, or a version-skewed
`api-key-status` withholding `canAdmin` while budgets still serve. The
warn, compose docstring, admin-fallback comment, masumi client doc, and
zero-pairs Sentry remediation now diagnose those reachable states
(remediation leads with the Purchasing wallet, not the key). Also fixed:
the classifier's outer catch captured to Sentry un-deduped — a
persistent hostile thrower would have re-opened the per-request volume
hole the keyed set exists to close (now throttled by a once-per-process
flag, pinned with a non-interference test); the stale test name "keeps
non-admin access budget-gated" kept the corrected-away claim alive; and
the warn had no silence complements (bound-budget and no-budget cases
now pinned, killing the dropped-conjunct mutant).

## PR 4 fresh re-review (round 7) — 2026-08-18

The fresh full-diff pass came back clean for the second consecutive
round: NO FINDINGS at tip `036f067d9` (191 tests across seven in-scope
suites plus typecheck), with the money-path invariants re-verified —
listed ⇒ payable symmetry through the shared row type and identical
gates, registry decimals never pricing anything, the three-layer
environment allowlist, warn/Sentry volume boundedness, dedupe-key
collision-freedom, and no credential material in any log path.

The adversarial audit of `cd879502f` confirmed the corrected
admin-gating narrative against client and sync code and found two
defects, fixed in `7342cabc8` — again a sharpening OF the previous
round's fix: **the rewritten remediation over-claimed warn coverage.**
A funded budget referencing an absent or retired wallet while a
DIFFERENT funded Purchasing wallet is listed on the same chain composes
zero pairs silently: the listing is non-empty so the empty-listing warn
stays down, the configured pair also blocks the admin fallback, and the
remediation's first instruction passes. A per-budget warn now names the
failing binding (gated on a non-empty listing so the empty-listing case
never double-reports), the docstring and remediation are scoped to both
warns, and the unreachable "missing ids" cause is dropped (zod fails
such rows at the check step). Second: the commit's non-interference
claim was only half-pinned — a mutant arming the hostile-capture flag
from the KEYED path survived the suite; a keyed-first-then-hostile test
now kills it (both mutants verified killed empirically).

## PR 4 fresh re-review (round 8) — 2026-08-18

Both reviewers surfaced real findings this round; fixed in `8f1561fd1`
and `713858eea`.

The adversarial audit of `7342cabc8` caught round 7's fix over-reaching:
**the per-budget warn fired at row level**, so a healthy deployment
carrying a stale second budget row (multi-budget pairs are an explicitly
supported state — the most-funded wallet wins) warned every sync that a
listed, payable pair "cannot be buy-side ready". Failing rows are now
collected and warned only when their pair ends the compose unready — the
pair-level claim is true by construction, and the row-level mutant fails
the new sibling-binds tests in both row orders. The audit also caught
the exhausted-budget silent state (a spent budget passes every
wallet-side checklist item; it now gets its own deferred warn and a
remediation checklist item) and the warn's `evmWalletId` contradicting
the file's own logging doctrine (doctrine rewritten: wallet ids are
opaque infrastructure identifiers named deliberately for remediation;
the Sentry summary keeps its boolean reduction).

The fresh full-diff pass verified the money-path invariants clean again
and found the remaining two: the route test "drops an agent whose
advertised asset has no CreditCost row" never exercised the pricing gate
(its asset was untrusted, so the agent dropped at the readiness gate —
deleting the unpriced_asset path left it green; the fixture now uses the
trusted ready asset with a non-empty credit_cost table and pins the
tally reason), and the readiness service had grown to 834 lines, past
the 750-line ceiling — split in `713858eea` along the concern boundary
into compose (pure, 511) and sync machinery (337), tests and shared
fixtures split alongside, external importers untouched.

## PR 4 review-clean (round 9) — 2026-08-18

Round 9 returned clean on both sides, closing the PR 4 loop. The
adversarial audit of `8f1561fd1` + `713858eea` verified the split
byte-pure (the only diff is two justified `export` keywords; no
re-export shims; 50 tests mapped 1:1 across the split), the deferred
warn pass sound (pair-level finality holds by construction; the two
warn families are provably mutually exclusive; both mutants killed
empirically), the fixtures file inert in production builds, the
repaired route test load-bearing (the misrouting mutant fails exactly
it), and every doc claim true at tip — NO FINDINGS. The fresh
full-diff pass independently confirmed the money-path invariants
(listing↔pay symmetry through shared query and row type, node-only
decimals provenance, the allowlist enforced four times, fail-closed on
every ambiguity, bounded Sentry/log volume, no credential leakage) and
chased every remaining candidate to ground — NO FINDINGS.

PR 4 stands review-clean after nine rounds: 24 findings fixed across
`53dcd0058`, `63d731f79`, `e9346dfb9`, `bddff477a`, `fa5e5ff75`,
`370bdfad6`, `58efea6b1`, `cd879502f`, `7342cabc8`, `8f1561fd1`, and
`713858eea`, each fix itself adversarially audited in the following
round until a round found nothing.

## PR 5 in-depth review (round 1) — 2026-08-18

The PR 5 (`x402-5-pay` vs `x402-4-listing`) xhigh pass ran ten finder
angles over the full diff, deduplicated 39 candidates to 28, verified
them under seven grouped verifiers with quoted-line verdicts (17
CONFIRMED, 4 PLAUSIBLE, 5 REFUTED — 26 verdicts, two of which each
covered a same-mechanism candidate pair), and swept for gaps (3 more). Everything actionable is fixed or
documented in this round's commit; the notable items:

**Money-path correctness.** The registry consolidation parks a
duplicate agent under `legacy-v2:<id>:<original>` and repoints its
payments at the canonical row — a coworker replaying its original
`agentId` then hit 409 `key_reused`, whose remediation ("use a new
key") advises a second charge. Replay identity now resolves the
supplied id through the parked alias to the canonical agent and accepts
the replay iff it lands on the stored one; an unrelated agent still
409s. Two adjacent time holes closed alongside: a VERIFIED replay could
hand back a header with near-zero remaining life (now 409
`header_expired` under the same 30s floor finalize enforces on fresh
signs), and the post-commit node dispatch could start after the
commit-stamped `processingAt`/`signRiskExpiresAt` fences had eaten
their slack — a new 10s dispatch guard withholds the node call
entirely (page + held-PENDING 502; the same-key replay re-stamps fresh
fences). The refused-refund path also no longer routes its "refund
crashed" 502 through a boolean flag that a later edit could desync,
and the demand-verify catch narrowed to 422-only so a verifier crash
surfaces as itself instead of relabeling as key reuse.

**Derivation over coincidence.** The purge's undated-header TTL is now
computed from finalize's `X402_MAX_PLAUSIBLE_VALIDITY_MS` plus one hour
(the cross-module pin test died as tautological); the wire schema's
`paymentHeader` shape is pinned mutually assignable to the settlement
descriptor type; the masumi client's network/address regexes import the
canonical CAIP patterns; scheme matching compares the demand's own
scheme against the source (growing the allowlist can no longer split
listing from pay).

**Structure.** Terminal (FAILED/REFUNDED/VERIFIED) replays resolve
from the preflight read before the serializable transaction opens —
those rows are immutable, so the tx bought nothing but conflict
surface. The guarded task-status update was extracted to
`applyGuardedTaskStatusUpdate` and shared with the events route; five
page-then-hold sites collapsed into `pageAndHoldPending`; dead
`normalizeOrThrow` deleted; the finalize persistence-failure capture
now scrubs non-Prisma errors down to name-only before Sentry (the raw
object can embed header text).

**Documented, not changed.** The node client's 500-as-refusal doctrine
now cites the node-source-verified contract in NODE-QUESTIONS.md
(Answers item 1, with its 2026-08-17 safety correction) rather than
asserting it bare; the credit-refund mint triplication across the two
Cardano rails and x402 is recorded as deliberate scope control with an
all-three-sites rule; the purge's two round trips stay (Prisma's
`updateMany` takes `limit` but not `orderBy`; raw SQL against the
bearer-credential table is a worse trade). The route's 409/422/502
descriptions now enumerate every `kind` with its retry guidance, and
the web client snapshot is regenerated on top.

Five REFUTED candidates died against quoted lines: the string-vs-BigInt
amount compare is the byte-exact fingerprint working as designed;
user deletion removes payment, task, and owner in one transaction (no
orphaned preflight row); the sync writers run READ COMMITTED and were
never serialization-conflict partners — that hoist comment now states
the real rationale (shorter serializable snapshot window).

## PR 5 fresh re-review (round 2) — 2026-08-19

A fresh xhigh review of `x402-5-pay` on top of the round-1 commit
surfaced two findings, and the self-audit that verified round 1's
fixes surfaced six more. All eight are fixed in this round's commit;
nothing was documented-away.

**The reviewer's primary (CONFIRMED): 409 on catalog evidence.** The
PENDING replay path answered two catalog-state failures — agent no
longer listed, and demand no longer verifying (a 422 from
`verifyX402DemandAgainstAgentSources`) — with 409 `key_reused`, whose
remediation ("use a new idempotencyKey") is double-charge advice. The
stored fingerprint plus the supplied 402 is enough to PROVE demand
identity without any catalog read, so the resolver now runs that
catalog-free reproduction proof (`suppliedDemandReproducesStored`)
FIRST: a real mismatch still 409s as proven key reuse, but every
catalog-state failure after the proof — unlisted agent, 422
re-verification, entry-tuple drift, pair unready — routes through one
`pendingReplayHeld` builder: Sentry page plus a held-PENDING 502 with
its own API kind `x402_pay_pending_held` ("retry the SAME key later
or contact support; a new key would charge twice"). The evidence
boundary is now structural: `reusedKeyConflict` speaks only on proof,
`pendingReplayHeld` on catalog state.

**The reviewer's secondary (CONFIRMED): the risk fence ignored the
dispatch delay it permits.** `calculateX402SignRiskExpiresAt` summed
timeout + maxTimeoutSeconds + skew but not the ≤10s commit-to-dispatch
delay the round-1 dispatch guard explicitly allows, so at stacked
maxima the fence could clear up to 10s before the authorization was
actually dead. The formula now carries a
`TASK_X402_MAX_SIGN_DISPATCH_DELAY_MS` term, the lease slack derives
from the same constant, and `TASK_X402_MAX_SIGN_RISK_MS` names the
whole worst case — budget and invariant agree by construction.

**Audit findings.** (1) The parked-alias canonical lookup matched
`blockchainIdentifier` byte-exact while consolidation matches
duplicates case-insensitively — rollback-era parked rows store the
registry spelling verbatim, so a casing difference broke the alias
chain; the lookup is now `mode: "insensitive"`. (2) The route's 409
description omitted `concurrency_conflict` (serializable-transaction
retry exhaustion) and the held-PENDING 502 had no `kind`; both
descriptions are extended and the web client snapshot regenerated.
(3) The wire-schema pin comment claimed optional descriptor fields
trip the mutual-assignability pin — they don't (optional properties
block neither direction), so the comment now states the KNOWN LIMIT:
whoever adds an optional descriptor field must extend the schema by
hand. (4) `task-x402-payment.replay.ts` had grown to 884 lines,
past the 750 ceiling; it is split along the evidence boundary —
`task-x402-payment.replay.ts` keeps WHEN a record may reach the node
(caps, lease, fences, the resolver), new
`task-x402-payment.replay-demand.ts` owns WHAT the replay must match
(fingerprint, identity, catalog verification, the two answer
builders), with shared fixtures in
`task-x402-payment.replay.fixtures.ts` and the demand suite moved to
its own test file. (5) The scheme-compare test comment overclaimed —
with a single-entry allowlist the old and new compares are
behaviorally equivalent, so the test pins the shape, not a behavior
change; the comment now says so. (6) The round-1 log entry's verdict
arithmetic (17+4+5 ≠ 28 candidates) is corrected: 26 verdicts, two of
which each covered a same-mechanism candidate pair.

The audit also re-verified round 1's fixes clean: dispatch-guard
`signStartedAt` provenance on both paths, the min-life floor at both
exits, refund callee semantics, terminal pre-tx safety (the
PENDING→terminal race is covered by the in-tx re-read), the 422-only
catch narrowing, the purge TTL growth direction, and the Sentry
scrub claim all held under quotation.
