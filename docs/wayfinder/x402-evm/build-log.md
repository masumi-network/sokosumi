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

**Branch:** `x402-4-listing`, cut from `x402-3-helpers` (clean tree). Three
feature commits (refactor split, sync wiring, listing route) plus this log
entry.

### Readiness wiring

`syncX402BuySideReadiness` now runs in `/sync/agents`
(`apps/core/src/routes/sync/agents/get.ts`), after the Cardano readiness
refresh and before the registry replay, with the identical
`AbortSignal.any([cron signal, AbortSignal.timeout(10_000)])` treatment.
Imported from `@/services/agent-sync.x402-readiness` directly — NOT through
`agentSyncService` (the service file is over the ceiling; nothing was added
to it beyond a one-line import split from the refactor). Decision: an x402
readiness change does **not** reset the registry cursor — the listing reads
`getX402ReadySources` at request time, nothing readiness-dependent is baked
into agent rows (Cardano readiness differs: it feeds the projected
availability filters). `routes/sync/index.test.ts` mock extended; new tests
pin the sequencing, the abort signal, and the no-reset decision.

### `agent.ts` split (750 ceiling)

The metadata-override getter block moved to
`apps/core/src/helpers/agent-metadata.ts`: `getAgentImage/Icon/Name/
Description/AuthorImage/ApiBaseUrl`, `toMasumiAgent`, `toMasumiAgentForJob`,
`getJobDetailsAgentOverrideFields`. `agent.ts` lands at 622 lines. Imports
repointed repo-wide (16 sites incl. `schemas/agent.schema.ts`, which breaks
the old schemas↔helpers/agent import cycle); test mocks for
`@/helpers/agent` in the agents route suites were split so getter mocks now
target `@/helpers/agent-metadata`. Tests moved to `agent-metadata.test.ts`
plus new direct getter coverage.

### Listing endpoint — `GET /v1/agents/x402`

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
  `type: X402, status: ONLINE, isShown: true` (curation whitelist identical
  to the catalog — preprod "lists all" via `SHOW_AGENTS_BY_DEFAULT`, not a
  gate bypass); per agent `buildX402AgentPaymentSources`
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
  `agent-metadata.test.ts` (13), extended sync suite (35).
- `pnpm --filter @sokosumi/masumi test` — 14 files, 251 passed.
- `pnpm typecheck` all workspaces; `pnpm format` + `pnpm check` clean.
- Mutation-tested (disable → watch fail → restore → green): readiness-pair
  gate, network allowlist, unpriced-asset drop (catch→continue), readiness
  fail-closed early return, authz gate, `isShown` curation filter. Each
  killed by a dedicated test.
- File sizes: `agent.ts` 622, `agent-metadata.ts` 152, route 111, helper
  110, schema 68 — all under 750.

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
