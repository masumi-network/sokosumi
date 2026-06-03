---
name: Enterprise Contracts Phased
overview: Implement SOK-535 as six incremental PR-sized phases on `main`, building a contract-driven enterprise entitlement system on top of the completed SOK-536 seat model. Internal admin is Core API only; org-facing billing summary comes last.
todos:
  - id: phase-1-schema
    content: "Phase 1: Prisma models, migration, period schedule helpers + unit tests"
    status: completed
  - id: phase-2-lifecycle
    content: "Phase 2: activate/cancel/grants/exclusivity guard helpers + integration tests"
    status: completed
  - id: phase-3-cron
    content: "Phase 3: Daily scheduler service, sync route, vercel.json cron entry"
    status: completed
  - id: phase-4-admin-api
    content: "Phase 4: Core admin CRUD/activate/cancel/preview routes + OpenAPI tests"
    status: completed
  - id: phase-5-entitlements
    content: "Phase 5: Plan resolution, pool consumption, exclusivity guards, seat capacity wiring"
    status: completed
  - id: phase-6-billing-ui
    content: "Phase 6: Org billing page contract summary + i18n across locales"
    status: pending
isProject: false
---

# Enterprise Contracts (SOK-535) — Phased Implementation Plan

## Context

- **Linear:** [SOK-535](https://linear.app/masumi/issue/SOK-535/enterprise-contracts-sokosumi-managed-entitlements) — contract-driven org entitlements, out-of-band payment, shared monthly credit pool, plan exclusivity.
- **Blocker cleared:** [SOK-536](https://linear.app/masumi/issue/SOK-536) (purchased vs assigned seats) is **Done** — reuse `Member.seatAssignedAt`, `[member.repository.ts](packages/database/src/repositories/member.repository.ts)`, and `[organization-seats.ts](packages/database/src/helpers/organization-seats.ts)`.
- **Current state:** Phases **1–3 complete** on feature branch `sok-535-enterprise-contracts-sokosumi-managed-entitlements`:
  - **Phase 1:** schema + [`enterprise-contract.ts`](packages/database/src/helpers/enterprise-contract.ts) schedule helpers
  - **Phase 2:** [`enterprise-contract-lifecycle.ts`](packages/database/src/helpers/enterprise-contract-lifecycle.ts), grants, exclusivity guards
  - **Phase 3:** [`enterprise-contract-scheduler.ts`](packages/database/src/helpers/enterprise-contract-scheduler.ts) + [`enterprise-contract-sync.service.ts`](apps/core/src/services/enterprise-contract-sync.service.ts) + `GET /sync/enterprise-contracts-renewal` (daily cron)
  - **Phase 4:** Core admin API under `/v1/enterprise/contracts` (admin middleware on `/v1/enterprise`); no org member read route — web uses Prisma + `resolveOrganizationBillingPlan()`
  - **Phase 5 ✅:** 5a plan resolution, 5b assigned-only enterprise pool consumption + API breakdown, 5c subscription exclusivity + free-grant skips (top-ups/coupons remain available).
  - Existing primitives to reuse:
  - `CreditBucket.activatesAt` + `[creditBucketActivatesAtOrBefore()](packages/database/src/helpers/credit.ts)` (spec’s `activeFrom` maps to this field — **do not add a duplicate column**)
  - Per-period pre-create pattern in `[subscription.ts](packages/database/src/helpers/subscription.ts)` and `[free-subscription-sync.service.ts](apps/core/src/services/free-subscription-sync.service.ts)`
  - Admin auth via `[requireAdminAuthContext()](apps/core/src/middleware/auth.ts)` (same as credit-costs routes)
  - Sync/cron wiring via `[apps/core/src/routes/sync/](apps/core/src/routes/sync/)` + `[apps/core/vercel.json](apps/core/vercel.json)`
- **Out of scope (follow-ups):** SOK-542 (Stripe OTC), SOK-543 (auto-cancel on activate), SOK-544 (amendments), internal web admin UI (your choice: **API only**).
- **Naming (explicit non-goal):** Do **not** rename `[free-subscription-sync.service.ts](apps/core/src/services/free-subscription-sync.service.ts)` as part of SOK-535. That service is specific to local *free* tier renewal (`plan = "free"`, no `stripeSubscriptionId`); enterprise contracts get their own `enterprise-contract-sync.service.ts` in Phase 3. A future rename to `local-free-subscription-sync.service.ts` could align with `LOCAL_FREE_`* helpers but is unrelated churn — defer unless tackled separately.

## Architecture (target)

```mermaid
flowchart TB
  subgraph commercial [Commercial Layer]
    EC[EnterpriseContract]
    ECP[EnterpriseContractPeriod]
  end

  subgraph entitlements [Entitlements Layer]
    CB_PERIOD["CreditBucket ENTERPRISE_PERIOD"]
    CB_TOP_UP["CreditBucket ENTERPRISE_TOP_UP"]
    Seats["Member.seatAssignedAt via SOK-536"]
  end

  subgraph ops [Operations]
    AdminAPI["Core admin API"]
    Cron["Daily sync cron 0 0 UTC"]
  end

  AdminAPI -->|activate/cancel| EC
  EC --> ECP
  EC -->|period 1 inline| CB_PERIOD
  Cron -->|pre-create + catch-up| CB_PERIOD
  EC -->|optional| CB_TOP_UP
  Seats -->|assigned members only| CB_PERIOD
  Seats --> CB_TOP_UP
```



**Key design choices (from spec):**

- One **org-level shared pool** per period (`organizationId` set, `userId` null), full monthly grant every period (no proration). Stored as **`centsPerMonth`** / **`centsToGrant`** in DB; exposed as credits at API boundaries.
- **`periodCount`** — commercial term length (number of full rolling monthly grant periods). **No stored `endDate`**; contract end is derived via `deriveEnterpriseContractEndDate()` or the last materialized period row.
- **`activatedAt`** — set on activation; anchors the rolling monthly period schedule and commercial term (no separate `startDate`; activate on go-live day). Each period runs **one calendar month** from its `periodStart` (same rolling-month rules as `getNextMonthlyPeriodEnd()` in `subscription.ts` — e.g. Jan 31 + `periodCount: 2` → two full months, not calendar-month boundaries).
- `contract.seats` = purchased capacity for seat assignment (not member-count gate).
- Activation blocked if org/members have paid subs with consumable buckets (list offenders; no auto-cancel until SOK-543).
- Extract `activateEnterpriseContract(contractId, { paymentReference, activatedAt })` as a callable helper for future SOK-542 webhook reuse.

---

## Phase 1 — Database schema and period math ✅

**Goal:** Persist the domain model and validate schedule generation without side effects.

**Delivered** (migration `20260602140000_add_enterprise_contracts`, `[enterprise-contract.ts](packages/database/src/helpers/enterprise-contract.ts)`, unit tests):

1. **Prisma models** in `[schema.prisma](packages/database/prisma/schema.prisma)`:
  - `EnterpriseContract` (org-scoped, status enum, commercial fields, `paymentReference`, `notes`, `externalReference`)
    - **`id`** `@default(uuid(7)) @db.Uuid` — native PostgreSQL UUID (same as `Workspace`, `Conversation`)
    - **`activatedAt`** `DateTime?` — set on activation; anchors period schedule and consumable window (draft = null)
    - **`periodCount`** `Int` — commercial term length (number of full rolling monthly grant periods); **no `endDate` column** — contract end is derived from the last materialized period (or `deriveEnterpriseContractEndDate()`)
    - **`centsPerMonth`** `BigInt` — monthly grant size in cents
    - **`oneTimeCents`** `BigInt?` — optional lump-sum org grant on activation (cents)
    - **No `billingAnchorDay` column** — rolling month derived from `activatedAt` via `getNextMonthlyPeriodEnd()`
    - **No audit/event table** — deferred; contract `status` + timestamps suffice for MVP
    - **No `createdByUserId`** — admin identity not stored on contract row
  - `EnterpriseContractPeriod` (materialized schedule + status enum)
    - **`centsToGrant`** `BigInt` — snapshot copied from `contract.centsPerMonth` (full amount every period; no proration)
  - Partial unique index: at most one `active` contract per `organizationId`
  - Extend `CreditBucketReferenceType` with `ENTERPRISE_PERIOD`, `ENTERPRISE_TOP_UP`
2. **Helpers** (`enterprise-contract.ts`):
  - `buildEnterpriseContractPeriodSchedule({ activatedAt, periodCount, ... })` — exactly **`periodCount`** full rolling months via `getNextMonthlyPeriodEnd()`
  - `deriveEnterpriseContractEndDate(activatedAt, periodCount)` — last period end (for consumable window / completion checks)
  - `previewEnterpriseContractPeriods()` — **`activatedAt` required** (no implicit `new Date()`)
  - `isEnterpriseContractConsumable()` — `status === active`, `activatedAt` set, and `now` not past derived commercial end
  - `validateMinEnterpriseCreditsPerMonth()` / `validateEnterprisePeriodCount()` — for API boundary
3. **Tests** cover: rolling month (incl. Jan 31), leap year, full grant / no proration, `periodCount: 1`, invalid `periodCount`, preview at `activatedAt`, consumable window including after last period.

**Suggested PR title:** `feat(database): add enterprise contract schema and period schedule`

### Period schedule rules (authoritative — carry into Phase 2+)

Each period runs **one calendar month from its `periodStart`**, using the same logic as local-free subscriptions (`getNextMonthlyPeriodEnd(periodStart, activatedAt)`):

- **Not** calendar-month boundaries and **not** “roll to 1st of next month when day missing”.
- **Term length:** `periodCount` full periods — e.g. `activatedAt = Jan 31`, `periodCount = 2` → Jan 31–Feb 28, then Feb 28–Mar 31 (both full grants).
- **No tail-clamp / partial final period** — every period is a full rolling month; total grants = `periodCount × centsPerMonth`.
- **Contract end** for completion/cron: last row’s `periodEnd`, or `deriveEnterpriseContractEndDate(activatedAt, periodCount)`.

---

## Phase 2 — Lifecycle: activate, cancel, and credit grants ✅

**Goal:** Callable domain routines that materialize periods and buckets; safe to unit/integration test in isolation.

**New helpers in `packages/database/src/helpers/`:**


| Module                               | Responsibility                                                                                                                                                                          |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `enterprise-contract-grants.ts`      | `createEnterprisePeriodCreditBucket()`, `createEnterpriseTopUpCreditBucket()`, `expireCreditBucketsNow()` — idempotent via `@@unique([referenceId, referenceType])` on `CreditBucket`; reference types `ENTERPRISE_PERIOD`, `ENTERPRISE_TOP_UP` |
| `enterprise-contract-exclusivity.ts` | `findPaidSubscriptionsBlockingEnterpriseActivation()` — org + member paid subs with consumable buckets                                                                                  |
| `enterprise-contract-lifecycle.ts`   | `activateEnterpriseContract()`, `cancelEnterpriseContract()`, `completeEnterpriseContractsAfterLastPeriod()` (or similar), `EnterpriseContractActivationError` with blocking subscription list           |


**Phase 2 must-dos (from Phase 1 review):**

- **Set `activatedAt` on activate** before materializing periods or grants; schedule and buckets anchor at that timestamp.
- **Reuse `buildEnterpriseContractPeriodSchedule()`** for materialization; do not reimplement period boundaries.
- **Period idempotency:** delete draft preview rows on activate, then insert schedule once; grants via stable `referenceId` + bucket unique constraint. Optional hard guard: `@@unique([contractId, periodStart])` on `EnterpriseContractPeriod` (code-first is enough for MVP).
- **Period status:** `scheduled`, `active`, `expired`, `void` only — `skipped` was never added to the enum.
- **No event/audit writes** — activation/cancel update contract + period status only.

**Activation behavior (spec-critical):**

1. Guard → reject with blocking subscriptions if any
2. Stamp **`activatedAt`** (server time on activate)
3. Materialize full schedule via `buildEnterpriseContractPeriodSchedule({ activatedAt, periodCount, centsPerMonth, purchasedSeats: seats })`; persist periods with `status = scheduled` (period 1 → `active` after bucket created)
4. Create period-1 bucket inline: **`activatesAt = activatedAt`**, `expiresAt = periodEnd`, flip period → `active`
5. Optional top-up org bucket on activation: **`activatesAt = activatedAt`**, `ENTERPRISE_TOP_UP`

**Contract start (entitlements + exclusivity):** **`status === active`** with **`activatedAt` set** drives seat capacity and `enterprise_contract` billing mode. **Consumable** entitlements (pool spend, subscription exclusivity in 5c) use `isEnterpriseContractConsumable()` (within commercial term, not past `deriveEnterpriseContractEndDate`). **Post-term** while row is still `active`: `isConsumable` false → self-serve allowed; cron sets **`completed`** on next pass.

**Cancellation behavior:**

- `expiresAt = now` on current + top-up buckets (reuse existing expiry path)
- Void (`status = void`) all **`scheduled`** periods
- Void future **`active`** periods whose bucket `activatesAt > now` (Phase 3 must always set non-null `activatesAt` on enterprise buckets — see Phase 3 **`activatesAt` requirement**)

**Period status reference:**

| Status | Meaning |
|--------|---------|
| `scheduled` | Future period; bucket not yet created |
| `active` | Period has a bucket row; includes **current** period and **pre-created** future periods (may overlap — spendability is bucket `activatesAt` / `expiresAt`, not status alone) |
| `expired` | Period ended normally (or late catch-up audit grant after `periodEnd`) |
| `void` | Invalidated by cancel — never grants |

**Tests:** Transaction-level tests with Prisma test doubles (mirror `[subscription.test.ts](packages/database/src/helpers/subscription.test.ts)` patterns): activation idempotency, top-up grant idempotency, cancel voids future buckets, activation guard lists blockers, `activatedAt` persisted on activate.

**Deliverable:** Package-level lifecycle fully tested; still no HTTP surface. **Delivered** in [`enterprise-contract-lifecycle.test.ts`](packages/database/src/helpers/__tests__/enterprise-contract-lifecycle.test.ts).

**Suggested PR title:** `feat(database): enterprise contract activate and cancel lifecycle`

---

## Phase 3 — Daily scheduler cron ✅

**Goal:** Automated period bucket pre-creation, catch-up, and period close-out.

**Delivered:**

- `runEnterpriseContractSchedulerPass()` and helpers in [`enterprise-contract-scheduler.ts`](packages/database/src/helpers/enterprise-contract-scheduler.ts) (keeps lifecycle focused):
  1. **Expire** `active` periods whose `ENTERPRISE_PERIOD` bucket `expiresAt <= now` → `expired`
  2. **Catch-up** `scheduled` periods with `periodStart <= now` and no bucket → grant with `activatesAt = now` (or `periodStart` when `now > periodEnd`, so `activatesAt <= expiresAt`); flip → `active`, or → `expired` when `now > periodEnd` (audit grant only)
  3. **Pre-create** `scheduled` periods with `now < periodStart <= now + 24h` and no bucket → grant with `activatesAt = periodStart`, flip → `active`
  4. **Complete** contracts past commercial term (`completeEnterpriseContractsAfterLastPeriod`) — **last**, so catch-up still runs on the final pass while the contract is `active`
- `ENTERPRISE_CONTRACT_PRECREATE_LOOKAHEAD_MS` (24h) in [`enterprise-contract.ts`](packages/database/src/helpers/enterprise-contract.ts)

**`activatesAt` requirement (cancel correctness):** Phase 2 cancel voids future **`active`** periods using **bucket `activatesAt > now`** (see Phase 2 cancellation behavior). `CreditBucket.activatesAt` is nullable globally (`null` = immediately active), so **Phase 3 must never create enterprise buckets with a null `activatesAt`**. All scheduler and grant paths must set it explicitly:

| Path | `activatesAt` |
|------|----------------|
| Pre-create (period not yet started) | `periodStart` |
| Catch-up (missed period, still in window) | `now` |
| Catch-up (missed period, after `periodEnd`) | `periodStart` (audit grant; bucket already expired); period → `expired` |
| Phase 2 activation (already implemented) | `activatedAt` |

After the bucket row exists with non-null `activatesAt`, flip period status: **in-window catch-up** and **pre-create** → `active`; **late catch-up** (`now > periodEnd`) → `expired` (audit grant only). Do not add a `periodStart` fallback in cancel for MVP — enforce the invariant at creation instead.

**Transaction scope (MVP):** The sync service runs the **entire pass in one** `prisma.$transaction`. One org failure (e.g. no members for grant) rolls back all orgs in that run. Acceptable for low volume; see **Deferred** for per-org isolation follow-up.

- [`apps/core/src/services/enterprise-contract-sync.service.ts`](apps/core/src/services/enterprise-contract-sync.service.ts) — thin wrapper (mirror free-subscription sync)
- Route: `GET /sync/enterprise-contracts-renewal` mounted in `[routes/sync/index.ts](apps/core/src/routes/sync/index.ts)`
- Cron entry in `[apps/core/vercel.json](apps/core/vercel.json)`: `"schedule": "0 0 * * *"`

**Tests:** 12 scheduler tests — pass order, pre-create window, catch-up (in-window + late), expire transition, catch-up-before-complete, contract completion. Assert non-null `activatesAt` on every created `ENTERPRISE_PERIOD` bucket.

**Note:** No audit/event writes on scheduler pass — only period status + bucket create/expire.

**Deliverable:** Cron runnable locally via sync endpoint; periods 2+ grant automatically.

**Suggested PR title:** `feat(core): enterprise contract daily renewal cron`

---

## Phase 4 — Admin Core API (API-only MVP) ✅

**Goal:** Internal ops can manage contracts end-to-end without Stripe.

**Delivered:** `apps/core/src/routes/v1/enterprise/contracts/`, schemas, API mappers, OpenAPI contract tests; mounted at `/v1/enterprise` with `requireAdminAuthContext` on the parent router (handlers do not duplicate the check). Cancel returns **200** with updated contract (no `empty()` helper in core). **Removed:** `GET /v1/organizations/{id}/enterprise-contract` — billing UI resolves entitlements server-side via `resolveOrganizationBillingPlan()`.

**New routes under `apps/core/src/routes/v1/enterprise/contracts/`** (admin-only via `/v1/enterprise` middleware):


| Method | Path                                              | Purpose                                                           |
| ------ | ------------------------------------------------- | ----------------------------------------------------------------- |
| POST   | `/enterprise/contracts`                           | Create draft (required `periodCount`; API field may be named `periods`) |
| GET    | `/enterprise/contracts`                           | List/filter by org, status                                        |
| GET    | `/enterprise/contracts/{id}`                      | Detail + periods                                                |
| PATCH  | `/enterprise/contracts/{id}`                      | Edit draft only                                                   |
| POST   | `/enterprise/contracts/{id}/activate`             | Body: `paymentReference`; 409 with blocking subs on guard failure |
| POST   | `/enterprise/contracts/{id}/cancel`              | Cancel active contract                                            |
| GET    | `/enterprise/contracts/{id}/periods/preview`    | Preview schedule for draft                                        |


**Validation at API boundary (Zod + `422`):** keep schedule helpers pure; reject bad input before DB writes.

| Field | Rule |
|-------|------|
| `creditsPerMonth` | `validateMinEnterpriseCreditsPerMonth()` (≥ 60_000 credits) |
| `seats` | integer ≥ 1 |
| `periodCount` (API: `periods`) | integer ≥ 1 (`validateEnterprisePeriodCount`) |
| `oneTimeCredits` | optional; if set, ≥ 0 |
| Preview query | **`activatedAt` required** (hypothetical activation time); never rely on server “now” implicitly |

**Preview endpoint:** call `previewEnterpriseContractPeriods({ activatedAt, periodCount, centsPerMonth, purchasedSeats })` — map response `creditsToGrant` from `centsToGrant`; include derived `contractEnd` from `deriveEnterpriseContractEndDate(activatedAt, periodCount)` in response (not stored).

**Product decision (document in PR):** **multiple `draft` contracts per org are allowed** for MVP (iterate on terms before activate). Only one `active` per org (DB partial unique). Revisit one-draft-per-org later if admin UX needs it.

**Implementation notes (do not reimplement domain logic in routes):**

- **Activate:** call `activateEnterpriseContract(contractId, { paymentReference, activatedAt }, tx)` inside `prisma.$transaction`. Map `EnterpriseContractActivationError` → `409 conflict` with blocker list from `findPaidSubscriptionsBlockingEnterpriseActivation`. Use server `activatedAt = new Date()` unless preview/simulation passes explicit timestamp.
- **Cancel:** call `cancelEnterpriseContract(contractId, tx, now)` inside transaction.
- **Preview:** call `previewEnterpriseContractPeriods()` only — no DB writes.
- **Create / patch draft:** direct Prisma on `EnterpriseContract`; validate with Zod + `validateMinEnterpriseCreditsPerMonth` / `validateEnterprisePeriodCount` before persist.
- **Do not** reimplement period schedule materialization or bucket grants in Core — that stays in `@sokosumi/database/helpers`.

**Supporting files:**

- `[apps/core/src/schemas/enterprise-contract.schema.ts](apps/core/src/schemas/enterprise-contract.schema.ts)` — Zod + OpenAPI; **request/response fields in credits** (`creditsPerMonth`, `oneTimeCredits`, period preview `creditsToGrant`); map to/from DB **`centsPerMonth`**, **`oneTimeCents`**, **`centsToGrant`** at route boundary
- `[apps/core/src/helpers/enterprise-contract-api.ts](apps/core/src/helpers/enterprise-contract-api.ts)` — response mappers (`convertCentsToCredits` on all stored cent fields)
- Mount in `[apps/core/src/routes/v1/index.ts](apps/core/src/routes/v1/index.ts)`
- OpenAPI contract tests (mirror credit-costs / coworkers admin patterns)

**Org billing read (web, not Core):** `resolveOrganizationBillingPlan(organizationId, prisma)` in [`organization-billing-plan.ts`](packages/database/src/helpers/organization-billing-plan.ts). No stored `Organization.type`; `plan: "enterprise"` is **not** a Stripe/Better Auth plan.

**Deliverable:** Full admin lifecycle via Core API + OpenAPI; web billing/seats use the resolver (Phase 5a complete).

**Suggested PR title:** `feat(core): enterprise contract admin API`

---

## Phase 5 — Entitlements, consumption, and plan exclusivity

**Goal:** Make enterprise contracts enforceable in production — this phase must land before activating customer contracts.

### 5a. Plan resolution ✅

**Delivered:**

- [`organization-billing-plan.ts`](packages/database/src/helpers/organization-billing-plan.ts) — `resolveOrganizationBillingPlan()`, `parseSelfServeSubscriptionPlanName()` (legacy `Subscription.plan === "enterprise"` → `null`)
- **Commercial vs consumable:** return `enterprise_contract` for any `active` contract with `activatedAt`; expose `isConsumable` via `isEnterpriseContractConsumable()` for entitlement/checkout guards (Phase 5c)
- **Helpers:** `isEnterpriseContractPastCommercialTerm()`, `isEnterpriseContractConsumable()` in [`enterprise-contract.ts`](packages/database/src/helpers/enterprise-contract.ts)
- **Web wiring:** [`organization-seat.service.ts`](apps/web/src/lib/services/organization-seat.service.ts), [`billing/page.tsx`](apps/web/src/app/(app)/billing/page.tsx), [`organization-subscription-section.tsx`](apps/web/src/components/billing/organization-subscription-section.tsx) (`isEnterpriseContract`), [`onboarding-dialog-loader.tsx`](apps/web/src/app/(app)/components/onboarding-dialog-loader.tsx)
- Self-serve Stripe catalog: no `enterprise` plan type
- Tests: [`organization-billing-plan.test.ts`](packages/database/src/helpers/__tests__/organization-billing-plan.test.ts)

**Not in 5a (moved to 5c):** subscription checkout blocks and skipping local-free grants — see 5c.

### 5b. Credit consumption (shared org pool, assigned-only) ✅

Update scope in [`credit-bucket-scope.ts`](packages/database/src/helpers/credit-bucket-scope.ts) (used by [`credit-bucket.repository.ts`](packages/database/src/repositories/credit-bucket.repository.ts)):

- Include `ENTERPRISE_PERIOD` / `ENTERPRISE_TOP_UP` org-level buckets for **assigned** members only
- Exclude enterprise pool buckets for unassigned members and for orgs without active contract
- **Spendability:** filter with [`creditBucketActivatesAtOrBefore(now)`](packages/database/src/helpers/credit.ts) and `expiresAt > now` — **not** period status alone (multiple `active` periods can exist when period N+1 is pre-created)

Update `[apps/core/src/helpers/subscription.ts](apps/core/src/helpers/subscription.ts)` credit breakdown to surface enterprise pool balance separately from per-member subscription credits.

### 5c. Suppress conflicting entitlements (subscriptions only) ✅

While contract is **consumable** (`isEnterpriseContractConsumable()` / `billingPlan.isConsumable`):

- **Block** org **subscription** purchase/change in `[subscription/action.ts](apps/web/src/lib/actions/subscription/action.ts)` + `[organization-subscription.service.ts](apps/web/src/lib/services/organization-subscription.service.ts)`
- **Block** personal **subscription** purchase for members of enterprise orgs
- **Skip** local-free / unassigned-member free grants (`[webhook-handlers.ts](apps/web/src/lib/stripe/webhook-handlers.ts)`, `[organization-subscription.service.ts](apps/web/src/lib/services/organization-subscription.service.ts)`) for enterprise orgs
- **Unassigned members:** zero entitlements (no free-tier fallback) — enforced primarily in **5b** (credit scope)

**Explicitly not blocked:** org credit **top-ups** (`purchaseCredits`) and **coupons** remain available for enterprise organizations.

### 5d. Seat assignment capacity ✅ (implemented; verify in tests)

[`resolveOrganizationBillingPlan()`](packages/database/src/helpers/organization-billing-plan.ts) supplies `contract.seats` as `purchasedSeats` for `enterprise_contract`; [`organization-seat.service.ts`](apps/web/src/lib/services/organization-seat.service.ts) passes that into `memberRepository.assignSeat`. Self-serve subscription credit grants on assign/unassign are skipped for enterprise orgs.

**Tests:** Exclusivity guards, assigned-only pool consumption, unassigned member gets zero balance, seat assign respects contract capacity, exclusivity lifts on cancel/complete.

**Deliverable:** Safe to activate production contracts.

**Suggested PR title:** `feat(billing): enterprise contract entitlements and exclusivity`

---

## Phase 6 — Org billing UI summary

**Goal:** Org admins see contract status on the billing page (internal admin remains API-only).

**Changes in `[apps/web](apps/web)`:**

- Fetch active contract via Core client or server-side Prisma/repository (prefer generated Core client if available post Phase 4 OpenAPI regen)
- New component e.g. `enterprise-contract-summary.tsx` in billing section — pool balance, period expiry, next bucket activation
- i18n keys in all locale files per [translations rules](apps/web/.cursor/rules/translations.mdc)
- Subscription UI: enterprise-only while `isConsumable`; self-serve again post-term until cron marks contract `completed` (already wired in `organization-subscription-section.tsx`)

**Deliverable:** Meets final acceptance criterion for org-admin billing visibility.

**Suggested PR title:** `feat(web): enterprise contract summary on billing page`

---

## Cross-cutting conventions

- **Credits vs cents:** Database stores **cents only** (`centsPerMonth`, `oneTimeCents`, `centsToGrant`, `CreditBucket.amount`). API request/response and validation minimums use **credits**; convert at the boundary with `convertCreditsToCents()` / `convertCentsToCredits()` ([credits-api rule](apps/core/.cursor/rules/credits-api.mdc)). Do not name Prisma columns `creditsPerMonth` — that would contradict `CreditBucket`, `Transaction.amount`, and `CreditCost.centsPerUnit`.
- **Contract term:** `periodCount` is the commercial source of truth (API may expose as `periods`). No stored `endDate` — use `deriveEnterpriseContractEndDate()` or the last materialized `EnterpriseContractPeriod.periodEnd` for completion/cron/display.
- **Contract start:** **`activatedAt` on activate** replaces `billingAnchorDay` / optional future `startDate`. Ops activate on go-live day; buckets use `activatesAt = activatedAt`. Commercial term = `periodCount` rolling months from `activatedAt`.
- **Period schedule:** One calendar month per period via `getNextMonthlyPeriodEnd()` — exactly `periodCount` full periods; see **Period schedule rules** under Phase 1.
- **Audit trail:** No `EnterpriseContractEvent` table in MVP — rely on contract/period status and timestamps; add event log in a follow-up if ops need it.
- **Bucket reference types:** `ENTERPRISE_PERIOD` (monthly pool), `ENTERPRISE_TOP_UP` (optional lump-sum on activation).
- **Errors:** Use Core error helpers (`conflict`, `unprocessableEntity`, etc.) — never raw `c.json`.
- **Transactions:** Activation and cancel run inside `prisma.$transaction`. Scheduler MVP runs the **full pass** in one transaction (see Phase 3); optional follow-up: per-org transactions in the sync service.
- **Branch:** Linear suggests `sok-535-enterprise-contracts-sokosumi-managed-entitlements`; one phase ≈ one PR off `main`.
- **Verification per phase:** `pnpm --filter @sokosumi/database test`, `pnpm core:test`, `pnpm web:test` (as applicable), `pnpm check`.

## Deferred / out of scope (track separately)

| Item | Recommendation |
|------|----------------|
| Per-org scheduler transactions | Phase 3 review: isolate cron failures per org (one `$transaction` per contract/org) before high enterprise volume |
| `EnterpriseContractEvent` audit log | Follow-up if ops need history beyond status + timestamps |
| `createdByUserId` | Not in MVP; admin auth is session/API-key only |
| `skipped` period status | Omitted from initial migration; `void` covers cancel |
| `@@unique([contractId, periodStart])` | Optional DB guard; code idempotency sufficient for MVP |
| DB check constraints (`seats > 0`, etc.) | API validation in Phase 4 |
| One draft per org | Allow multiple drafts for MVP |
| SOK-542 / SOK-543 / SOK-544 | Stripe OTC, auto-cancel on activate, amendments |
| Internal web admin UI | Core API only |
| Linear issue copy | Sync enum names, `periodCount` model (no `endDate`), and period rules when closing Phase 1 PR — **done (SOK-535 updated 2026-06-02)** |

## Recommended merge order and checkpoints


| Phase | Merge when                            | Safe to activate real contracts?   |
| ----- | ------------------------------------- | ---------------------------------- |
| 1–2   | Schema + lifecycle tests green        | No (no API/cron)                   |
| 3 ✅   | Delivered — cron + scheduler tests    | No (no enforcement)                |
| 4     | Admin API tested via OpenAPI/CLI      | **No** (entitlements not enforced) |
| 5     | Exclusivity + consumption tests green | **Yes**                            |
| 6     | UI verified on billing page           | Yes (full MVP)                     |


## Dependency diagram

```mermaid
flowchart LR
  P1[Phase1 Schema] --> P2[Phase2 Lifecycle]
  P2 --> P3[Phase3 Cron]
  P2 --> P4[Phase4 Admin API]
  P3 --> P5[Phase5 Entitlements]
  P4 --> P5
  P5 --> P6[Phase6 Billing UI]
```



Phases 3 and 4 can be developed in parallel after Phase 2; Phase 5 depends on both.