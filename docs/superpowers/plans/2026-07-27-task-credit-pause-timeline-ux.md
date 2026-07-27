# Task Credit Pause + Timeline UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist attempted charge amounts on mid-run `OUT_OF_CREDITS` pause events, expose them in 422 extensions, and fix task timeline/share copy for credit-only and attempted vs settled charges.

**Architecture:** On insufficient mid-run balance, keep pause control flow but store attempted `cents` with `transactionId: null`. Web distinguishes settled (`transactionId` set) vs attempted (`credits` set, `transactionId` null). No Prisma migration; `task.credits` aggregate stays transaction-based.

**Tech Stack:** Hono/Zod OpenAPI (Core), Vitest, Next.js task UI, next-intl.

**Spec:** `docs/superpowers/specs/2026-07-27-task-credit-pause-timeline-ux-design.md`

## Global Constraints

- No auto-settle after top-up (requested status still dropped on pause)
- Do not change `masumiPayment` / `credits` mutual exclusivity
- Do not change coworker context-header charge auth
- No new DB columns / migrations
- Failed attempts must not inflate `task.credits`
- `transactionId` already on `TaskEvent` OpenAPI — no hand-edit of generated clients; regen only if OpenAPI 422 shape changes and web needs it (coworker-facing; web UI uses GET task events)
- Update all locale files when adding keys (`en.json` + real translations)
- Branch: `cursor/task-credit-pause-timeline-ux-4bb2`

## File map

| File | Responsibility |
|------|----------------|
| `apps/core/src/routes/v1/tasks/[id]/events/post.ts` | Return attempted `cents` on pause; pass 422 extensions |
| `apps/core/src/helpers/response.ts` | Allow optional top-level fields on `unprocessableWithData` |
| `apps/core/src/routes/v1/tasks/[id]/events/post.test.ts` | Expect `cents` + extensions on pause |
| `apps/web/src/app/(app)/tasks/components/task-activity.tsx` | Action + charged/tried copy |
| `apps/web/src/app/share/components/shared-task-view.tsx` | Same copy rules |
| `apps/web/src/app/(app)/tasks/components/__tests__/task-activity.test.tsx` | UI tests |
| `apps/web/src/app/share/[token]/page.test.tsx` | Share view tests |
| `apps/web/messages/*.json` | `actionTriedChargedCredits` (+ wire existing charged key) |

---

### Task 1: Core — persist attempted cents on pause (TDD)

**Files:**
- Modify: `apps/core/src/routes/v1/tasks/[id]/events/post.ts` (`settleTaskEventCharge` pause returns)
- Modify: `apps/core/src/routes/v1/tasks/[id]/events/post.test.ts`

**Interfaces:**
- Consumes: `chargeTaskCreditsOrMarkOutOfCredits`, `convertCreditsToCents`, masumi Amounts → cents
- Produces: pause result `{ cents: bigint; transactionId: null; eventStatus: OUT_OF_CREDITS; chargedMasumiPayment: false }` for both `credits` and `masumiPayment` branches

- [ ] **Step 1: Update failing expectations in existing pause tests**

In `post.test.ts`, for each case that currently expects `cents: undefined` on OUT_OF_CREDITS pause, change to expect the attempted cents value.

At minimum update these tests (search `cents: undefined` in this file):

- `auto-sets OUT_OF_CREDITS when COMPLETED credits are insufficient` → `cents: convertCreditsToCents(2)`
- `auto-sets OUT_OF_CREDITS when CANCELED credits are insufficient` → matching requested credits
- `auto-sets OUT_OF_CREDITS when masumiPayment charge is insufficient on RUNNING` → cents from Amounts conversion used in that test
- `auto-sets OUT_OF_CREDITS when masumiPayment charge is insufficient` → same
- `auto-sets OUT_OF_CREDITS on credit-only when balance is insufficient mid-run` → matching credits

Also assert response body still has `kind: insufficient_balance` and `data.status === OUT_OF_CREDITS`.

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm --filter core test src/routes/v1/tasks/\[id\]/events/post.test.ts
```

Expected: FAIL — create still called with `cents: undefined`.

- [ ] **Step 3: Implement pause cents retention**

In `settleTaskEventCharge` inside `post.ts`, change **both** pause early-returns (masumi branch ~249–255 and credits branch ~279–285) from `cents: undefined` to `cents` (the computed bigint for that attempt):

```typescript
if (charge.eventStatus != null) {
  return {
    cents,
    transactionId: null,
    eventStatus: charge.eventStatus,
    chargedMasumiPayment: false,
  };
}
```

Do not create a ledger transaction on pause (still `transactionId: null`). Do not change `OUT_OF_CREDITS_PAUSE_STATUSES` or terminal hard-fail behavior.

- [ ] **Step 4: Re-run tests**

```bash
pnpm --filter core test src/routes/v1/tasks/\[id\]/events/post.test.ts
```

Expected: PASS for the updated pause expectations (extensions assertions come in Task 2).

- [ ] **Step 5: Commit**

```bash
git add apps/core/src/routes/v1/tasks/\[id\]/events/post.ts apps/core/src/routes/v1/tasks/\[id\]/events/post.test.ts
git commit -m "fix(core): persist attempted cents on OUT_OF_CREDITS pause events"
```

---

### Task 2: Core — 422 extensions `attemptedCredits` + `requestedStatus` (TDD)

**Files:**
- Modify: `apps/core/src/helpers/response.ts`
- Modify: `apps/core/src/routes/v1/tasks/[id]/events/post.ts`
- Modify: `apps/core/src/routes/v1/tasks/[id]/events/post.test.ts`

**Interfaces:**
- Consumes: `CORE_API_ERROR_KINDS.INSUFFICIENT_BALANCE`, mapped pause event
- Produces: 422 JSON with top-level `attemptedCredits: number` and `requestedStatus: TaskStatus | null` beside existing `data` / `kind`

- [ ] **Step 1: Write failing extension assertions**

Add/extend one representative pause test (e.g. COMPLETED + credits insufficient) to assert:

```typescript
expect(body.attemptedCredits).toBe(2);
expect(body.requestedStatus).toBe(TaskStatus.COMPLETED);
```

For credit-only insufficient mid-run:

```typescript
expect(body.attemptedCredits).toBe(/* credits in body */);
expect(body.requestedStatus).toBeNull();
```

- [ ] **Step 2: Run test — expect fail**

```bash
pnpm --filter core test src/routes/v1/tasks/\[id\]/events/post.test.ts
```

Expected: FAIL — `attemptedCredits` / `requestedStatus` undefined.

- [ ] **Step 3: Extend `unprocessableWithData`**

Replace options typing so optional top-level fields can be merged (keep `meta` last):

```typescript
export function unprocessableWithData<T>(
  c: Context,
  data: T,
  options: {
    message: string;
    kind: string;
    attemptedCredits?: number;
    requestedStatus?: string | null;
  },
) {
  const { message, kind, attemptedCredits, requestedStatus } = options;
  return c.json(
    {
      error: getErrorName(422),
      message,
      kind,
      data,
      ...(attemptedCredits !== undefined ? { attemptedCredits } : {}),
      ...(requestedStatus !== undefined ? { requestedStatus } : {}),
      meta: {
        timestamp: new Date().toISOString(),
        requestId: c.var.requestId,
        path: c.req.path,
        method: c.req.method,
      },
    },
    422,
  );
}
```

- [ ] **Step 4: Pass extensions from the events route**

In `post.ts` pause return (~761–765), derive values from the **original request body** and the committed event:

```typescript
if (pausedForInsufficientBalance) {
  return unprocessableWithData(c, parsedEvent, {
    message: "Insufficient balance",
    kind: CORE_API_ERROR_KINDS.INSUFFICIENT_BALANCE,
    attemptedCredits: parsedEvent.credits ?? undefined,
    requestedStatus: body.status ?? null,
  });
}
```

Prefer `parsedEvent.credits` (from persisted attempted cents) so Amounts-derived masumi pauses also surface the converted credit number.

Update OpenAPI 422 schema in the same file to document the new fields via `errorResponseWithExtensionsSchema`:

```typescript
errorResponseWithExtensionsSchema({
  data: taskEventSchema.optional(),
  attemptedCredits: z.number().optional().openapi({ example: 2 }),
  requestedStatus: z.enum(TaskStatus).nullable().optional(),
}),
```

(Import/`TaskStatus` already available in this module.)

- [ ] **Step 5: Re-run tests**

```bash
pnpm --filter core test src/routes/v1/tasks/\[id\]/events/post.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/core/src/helpers/response.ts apps/core/src/routes/v1/tasks/\[id\]/events/post.ts apps/core/src/routes/v1/tasks/\[id\]/events/post.test.ts
git commit -m "feat(core): add attemptedCredits and requestedStatus on task pause 422"
```

---

### Task 3: Web i18n — tried-to-charge copy

**Files:**
- Modify: `apps/web/messages/en.json`
- Modify: `apps/web/messages/de.json`
- Modify: `apps/web/messages/es.json`
- Modify: `apps/web/messages/fr.json`
- Modify: `apps/web/messages/it.json`
- Modify: `apps/web/messages/pt.json`
- Modify: `apps/web/messages/pt-BR.json`
- Modify: `apps/web/messages/ja.json`
- Modify: `apps/web/messages/zh-Hans.json`

**Interfaces:**
- Produces key `App.Tasks.Detail.actionTriedChargedCredits` next to existing `actionChargedCredits`

- [ ] **Step 1: Add English key**

In `apps/web/messages/en.json` under `App.Tasks.Detail` (beside `actionChargedCredits`):

```json
"actionTriedChargedCredits": "tried to charge {credits, plural, =1 {# credit} other {# credits}}"
```

- [ ] **Step 2: Add real translations in every locale** (same key path)

Suggested meanings (adjust to match existing credit wording in each file):

| Locale | Value |
|--------|--------|
| de | `versucht, {credits, plural, =1 {# Credit} other {# Credits}} zu berechnen` |
| es | `intentó cobrar {credits, plural, =1 {# crédito} other {# créditos}}` |
| fr | `a tenté de facturer {credits, plural, =1 {# crédit} other {# crédits}}` |
| it | `ha cercato di addebitare {credits, plural, =1 {# credito} other {# crediti}}` |
| pt | `tentou cobrar {credits, plural, =1 {# crédito} other {# créditos}}` |
| pt-BR | `tentou cobrar {credits, plural, =1 {# crédito} other {# créditos}}` |
| ja | `{credits, plural, =1 {# クレジットの課金を試行} other {# クレジットの課金を試行}}` |
| zh-Hans | `尝试扣除 {credits, plural, =1 {# 积分} other {# 积分}}` |

- [ ] **Step 3: Commit**

```bash
git add apps/web/messages/*.json
git commit -m "feat(web): add tried-to-charge i18n for task activity"
```

---

### Task 4: Web — task activity charge/action copy (TDD)

**Files:**
- Modify: `apps/web/src/app/(app)/tasks/components/task-activity.tsx`
- Modify: `apps/web/src/app/(app)/tasks/components/task-detail-view.tsx` (only if new label prop must be passed)
- Modify: `apps/web/src/app/(app)/tasks/components/__tests__/task-activity.test.tsx`

**Interfaces:**
- Consumes: `event.credits`, `event.transactionId`, `event.comment`, `event.status`
- Produces: correct action verb + optional secondary charge line

Rules:

1. Charge phrase:
   - `credits != null && transactionId != null` → `actionChargedCredits`
   - `credits != null && transactionId == null` → `actionTriedChargedCredits`
2. Action verb:
   - comment → commented
   - else if status → updated status
   - else if charge phrase → use charge phrase as action
   - else → updated status (should not happen for valid API events)
3. Secondary charge line under the row: show only when there is a comment and/or status **and** a charge phrase (avoid duplicating the action on credit-only rows).

- [ ] **Step 1: Extend `createEvent` helper + write failing tests**

In `task-activity.test.tsx`, ensure `createEvent` accepts `credits` / `transactionId` and puts them on the event object (today defaults `transactionId: null` and may omit `credits`).

Add tests:

```typescript
it("uses charged credits as action for credit-only settled events", () => {
  // event: no comment, no status, credits: 5, transactionId: "txn_1"
  // mock t("actionChargedCredits") → `charged ${values.credits} credits`
  // expect screen text "charged 5 credits"
  // expect no "updated status"
});

it("shows tried to charge for pause events with credits and no transaction", () => {
  // status OUT_OF_CREDITS, credits: 3, transactionId: null
  // expect "tried to charge 3 credits" (secondary or in body)
});

it("shows charged line under comment when both present", () => {
  // comment + credits + transactionId
  // expect "commented" and "charged …"
});
```

Wire `useTranslations` mock for `actionTriedChargedCredits` like existing `actionChargedCredits` if the component calls `t(...)` directly; if labels are props from `task-detail-view`, pass new prop `actionTriedChargedCreditsLabel` the same way as `actionUpdatedStatusLabel`.

- [ ] **Step 2: Run tests — expect fail**

```bash
pnpm --filter web test src/app/\(app\)/tasks/components/__tests__/task-activity.test.tsx
```

Expected: FAIL on credit-only / tried copy.

- [ ] **Step 3: Implement in `task-activity.tsx`**

Replace the current:

```typescript
const action = event.comment
  ? actionCommentedLabel
  : actionUpdatedStatusLabel;
const chargedLabel =
  event.credits != null
    ? t("actionChargedCredits", { credits: formatCreditsForDisplay(event.credits) })
    : null;
```

with logic matching the rules above (prefer `t("actionTriedChargedCredits")` / `t("actionChargedCredits")` inside the component if translations are already loaded there; otherwise pass both labels from parent).

Pass any new props from `task-detail-view.tsx` if that is the established pattern.

- [ ] **Step 4: Re-run tests**

```bash
pnpm --filter web test src/app/\(app\)/tasks/components/__tests__/task-activity.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/\(app\)/tasks/components/task-activity.tsx apps/web/src/app/\(app\)/tasks/components/task-detail-view.tsx apps/web/src/app/\(app\)/tasks/components/__tests__/task-activity.test.tsx
git commit -m "fix(web): show settled vs attempted task credit charges in activity"
```

---

### Task 5: Web — share view parity (TDD)

**Files:**
- Modify: `apps/web/src/app/share/components/shared-task-view.tsx`
- Modify: `apps/web/src/app/share/[token]/page.test.tsx`

**Interfaces:**
- Same display rules as Task 4 (share already mocks `actionChargedCredits`)

- [ ] **Step 1: Write failing share tests**

Extend `page.test.tsx` mocks:

```typescript
if (key === "actionTriedChargedCredits") {
  return `tried to charge ${values?.credits ?? 0} credits`;
}
```

Add cases:

- credit-only settled → “charged …” visible, not “changed status to”
- `OUT_OF_CREDITS` + credits + null transactionId → “tried to charge …”

- [ ] **Step 2: Run — expect fail**

```bash
pnpm --filter web test src/app/share/\[token\]/page.test.tsx
```

- [ ] **Step 3: Mirror Task 4 logic in `shared-task-view.tsx`**

Use `tTaskDetail("actionTriedChargedCredits")` / `actionChargedCredits` and the same action/secondary-line rules.

- [ ] **Step 4: Re-run — expect pass**

```bash
pnpm --filter web test src/app/share/\[token\]/page.test.tsx
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/share/components/shared-task-view.tsx apps/web/src/app/share/\[token\]/page.test.tsx
git commit -m "fix(web): mirror attempted credit copy on shared task view"
```

---

### Task 6: Verification + PR update

**Files:** none new

- [ ] **Step 1: Run focused suites**

```bash
pnpm --filter core test src/routes/v1/tasks/\[id\]/events/post.test.ts
pnpm --filter web test src/app/\(app\)/tasks/components/__tests__/task-activity.test.tsx src/app/share/\[token\]/page.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Lint/typecheck touched packages**

```bash
pnpm check
pnpm --filter core typecheck
pnpm --filter web typecheck
```

Expected: clean.

- [ ] **Step 3: Optional sanity — aggregate still ignores attempts**

If not already covered, add or rely on existing helper/route coverage that `task.credits` sums only negative transaction amounts (attempt-only `cents` without tx do not add). Spot-check `mapTaskBase` in `apps/core/src/helpers/task.ts` — no code change expected.

- [ ] **Step 4: Push + update PR body**

```bash
git push -u origin cursor/task-credit-pause-timeline-ux-4bb2
```

Update PR #3433 description to summarize Core pause cents + 422 extensions + web copy fixes; link the design + this plan.

- [ ] **Step 5: Final commit only if verification required drive-by fixes**

---

## Spec coverage checklist

| Spec requirement | Task |
|------------------|------|
| Persist attempted `cents`, null `transactionId` on mid-run pause | Task 1 |
| Masumi pause also keeps converted `cents` | Task 1 (both settle branches) |
| Task status still → `OUT_OF_CREDITS` | unchanged; covered by existing tests |
| 422 `attemptedCredits` + `requestedStatus` | Task 2 |
| `task.credits` ignores attempts | Task 6 sanity / existing aggregate |
| Timeline settled vs tried copy | Task 4 |
| Credit-only action = charge phrase | Task 4 |
| Share parity | Task 5 |
| i18n all locales | Task 3 |
| No masumi API reshape / no auto-settle / no auth change | Global constraints |

## Out of scope (do not implement)

- Auto-complete after top-up
- Requiring `credits` alongside `masumiPayment`
- Linear issue for Masumi conversion verification
- Exposing cents in API (credits only)
