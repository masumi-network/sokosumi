# Dynamic Type Layout Audit (SOK-730) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align every header-offset viewport shell in `apps/web` to rem (`4rem` = `h-16`) so Dynamic Type at the 1.25× cap does not overflow chat or other app chrome.

**Architecture:** Header uses rem (`h-16` → 4rem). Shells that still subtract fixed `64px` (or paired `96px`) overflow at root 20px. Replace those offsets with rem app-wide; keep chat height constants named; add a static guard so `100svh-64px` / `100svh-96px` cannot return. Secondary dense `px` boxes only if smoke shows real clip.

**Tech Stack:** Next.js App Router (`apps/web`), Tailwind arbitrary values, Vitest, Biome. No new npm dependencies.

**Spec:** `docs/superpowers/specs/2026-08-05-dynamic-type-layout-audit-design.md`  
**Issue:** [SOK-730](https://linear.app/masumi/issue/SOK-730/audit-and-fix-layouts-for-dynamic-type-125-cap)

## Global Constraints

- Cap remains **1.25×** / max root **20px** (do not raise)
- Header height unit: **`4rem`** (`h-16`); never reintroduce shell math with raw **`64px`** for header offset
- Jobs paired shell: **`96px` → `6rem`**
- Prefer `min-h` + wrap/scroll; never shrink type below Dynamic Type size
- No new product-UI fixed `px` font sizes (existing guard stays green)
- Web layout/CSS only; no Core / schema / Dynamic Type plumbing changes
- Conventional Commits; branch from Linear `gitBranchName` when creating feature branch
- Default root (16px): `4rem` ≡ `64px` → visual no-op required

## File map

| File | Responsibility |
| --- | --- |
| `apps/web/src/app/(app)/chat/components/chat-mobile-tab-registry.ts` | Chat height-shell constants (`100svh-4rem`) |
| `apps/web/src/app/(app)/chat/components/__tests__/chat-mobile-tab-registry.test.ts` | Assert shells use rem, not `64px` |
| `apps/web/src/app/(app)/components/authenticated-app-frame.tsx` | Main `md` min/max height shell |
| `apps/web/src/app/(app)/components/app-shell-loading-frame.tsx` | Loading shell parity |
| `apps/web/src/app/(app)/agents/[agentId]/layout.tsx` | Agent fullbleed min-height |
| `apps/web/src/app/(app)/agents/[agentId]/jobs/layout.tsx` | Jobs sticky column + outer height (`4rem` / `6rem`) |
| `apps/web/src/app/(app)/agents/[agentId]/jobs/@right/page.tsx` | Jobs empty right min-height |
| `apps/web/src/components/jobs/job-details/job-details-view.tsx` | Job details aside min-height |
| `apps/web/src/app/share/layout.tsx` | Share main min-height |
| `apps/web/src/app/share/components/shared-task-view.tsx` | Share aside min-height |
| `apps/web/src/app/globals.css` | Hermes comment: document `4rem` |
| `apps/web/src/lib/utils/__tests__/no-header-offset-px-shell.test.ts` | Static scan: ban `100svh-64px` / `100svh-96px` in product sources |
| Secondary only if smoke fails | `tasks-view.tsx` / `tasks-loading-view.tsx` (`150px`); badges / auth heights |

**Do not change (already rem-safe):** chat tab-bar clearance (`4rem`), dialogs `100svh-2rem`, kanban `100svh-8.5rem`.

---

### Task 1: Chat height shells (TDD)

**Files:**
- Modify: `apps/web/src/app/(app)/chat/components/chat-mobile-tab-registry.ts`
- Modify: `apps/web/src/app/(app)/chat/components/__tests__/chat-mobile-tab-registry.test.ts`

**Interfaces:**
- Consumes: existing `chatMobileHeightShellClass` / path surface classification
- Produces:
  - `CHAT_MOBILE_HEIGHT_SHELL_CLASS = "h-[calc(100svh-4rem)] max-md:h-full"`
  - `CHAT_MOBILE_HEIGHT_SHELL_NO_TAB_BAR_CLASS = "h-[calc(100svh-4rem)]"`

- [ ] **Step 1: Write failing assertions for rem shells**

Append to the existing describe (keep route selection tests):

```typescript
  it("uses rem header offset (not fixed 64px) so Dynamic Type can scale", () => {
    expect(CHAT_MOBILE_HEIGHT_SHELL_CLASS).toContain("100svh-4rem");
    expect(CHAT_MOBILE_HEIGHT_SHELL_CLASS).not.toContain("64px");
    expect(CHAT_MOBILE_HEIGHT_SHELL_NO_TAB_BAR_CLASS).toBe(
      "h-[calc(100svh-4rem)]",
    );
    expect(CHAT_MOBILE_HEIGHT_SHELL_NO_TAB_BAR_CLASS).not.toContain("64px");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web test src/app/\(app\)/chat/components/__tests__/chat-mobile-tab-registry.test.ts`

Expected: FAIL — constants still contain `64px` / missing `4rem`.

- [ ] **Step 3: Update constants**

In `chat-mobile-tab-registry.ts`:

```typescript
export const CHAT_MOBILE_HEIGHT_SHELL_CLASS =
  "h-[calc(100svh-4rem)] max-md:h-full" as const;

export const CHAT_MOBILE_HEIGHT_SHELL_NO_TAB_BAR_CLASS =
  "h-[calc(100svh-4rem)]" as const;
```

Keep comments; optionally note that `4rem` matches app `Header` `h-16`.

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm --filter web test src/app/\(app\)/chat/components/__tests__/chat-mobile-tab-registry.test.ts`

Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add \
  apps/web/src/app/\(app\)/chat/components/chat-mobile-tab-registry.ts \
  apps/web/src/app/\(app\)/chat/components/__tests__/chat-mobile-tab-registry.test.ts
git commit -m "fix(chat): rem-align room height shells for Dynamic Type"
```

---

### Task 2: App frame main shells

**Files:**
- Modify: `apps/web/src/app/(app)/components/authenticated-app-frame.tsx`
- Modify: `apps/web/src/app/(app)/components/app-shell-loading-frame.tsx`

**Interfaces:**
- Consumes: Header still `className="h-16 …"` (4rem)
- Produces: main `md:max-h-[calc(100svh-4rem)] md:min-h-[calc(100svh-4rem)]` on both frames

- [ ] **Step 1: Update authenticated app frame**

In `authenticated-app-frame.tsx`, change the `<main>` className from:

```tsx
className="relative flex max-h-svh min-h-svh flex-1 flex-col overflow-x-hidden overflow-y-auto p-4 pt-20 md:max-h-[calc(100svh-64px)] md:min-h-[calc(100svh-64px)] md:pt-4"
```

to:

```tsx
className="relative flex max-h-svh min-h-svh flex-1 flex-col overflow-x-hidden overflow-y-auto p-4 pt-20 md:max-h-[calc(100svh-4rem)] md:min-h-[calc(100svh-4rem)] md:pt-4"
```

Do **not** change mobile `max-h-svh min-h-svh` or `pt-20`.

- [ ] **Step 2: Update loading frame for parity**

In `app-shell-loading-frame.tsx`, same substitution on `<main>`:

`md:max-h-[calc(100svh-64px)] md:min-h-[calc(100svh-64px)]`  
→ `md:max-h-[calc(100svh-4rem)] md:min-h-[calc(100svh-4rem)]`

- [ ] **Step 3: Grep confirm app frames**

Run: `rg -n "100svh-64px" apps/web/src/app/\(app\)/components`

Expected: no matches.

- [ ] **Step 4: Commit**

```bash
git add \
  apps/web/src/app/\(app\)/components/authenticated-app-frame.tsx \
  apps/web/src/app/\(app\)/components/app-shell-loading-frame.tsx
git commit -m "fix(web): rem-align app main shell height for Dynamic Type"
```

---

### Task 3: Agents, jobs, share inventory

**Files:**
- Modify: `apps/web/src/app/(app)/agents/[agentId]/layout.tsx`
- Modify: `apps/web/src/app/(app)/agents/[agentId]/jobs/layout.tsx`
- Modify: `apps/web/src/app/(app)/agents/[agentId]/jobs/@right/page.tsx`
- Modify: `apps/web/src/components/jobs/job-details/job-details-view.tsx`
- Modify: `apps/web/src/app/share/layout.tsx`
- Modify: `apps/web/src/app/share/components/shared-task-view.tsx`
- Modify: `apps/web/src/app/globals.css` (comment only)

**Interfaces:**
- Produces: all header-offset shells use `4rem`; jobs outer height uses `6rem`

- [ ] **Step 1: Agents agent layout**

`apps/web/src/app/(app)/agents/[agentId]/layout.tsx`:

```tsx
// before
className="flex min-h-[calc(100svh-64px)] flex-1 flex-col pt-20 md:pt-0"
// after
className="flex min-h-[calc(100svh-4rem)] flex-1 flex-col pt-20 md:pt-0"
```

- [ ] **Step 2: Jobs layout (64px + 96px)**

`apps/web/src/app/(app)/agents/[agentId]/jobs/layout.tsx`:

```tsx
// sticky column
lg:h-[calc(100svh-4rem)]
// outer column (was 96px = 6rem at 16px root)
lg:h-[calc(100svh-6rem)]
```

Exact strings:

| Find | Replace |
| --- | --- |
| `lg:h-[calc(100svh-64px)]` | `lg:h-[calc(100svh-4rem)]` |
| `lg:h-[calc(100svh-96px)]` | `lg:h-[calc(100svh-6rem)]` |

- [ ] **Step 3: Jobs right empty + job details aside**

`@right/page.tsx`:

```tsx
lg:min-h-[calc(100svh-4rem)]
```

`job-details-view.tsx` aside:

```tsx
md:min-h-[calc(100svh-4rem)]
```

- [ ] **Step 4: Share layout + shared task aside**

`share/layout.tsx`:

```tsx
<main className="relative min-h-[calc(100svh-4rem)]">{children}</main>
```

`shared-task-view.tsx` aside:

```tsx
md:min-h-[calc(100svh-4rem)]
```

- [ ] **Step 5: globals.css comment**

In the hermes fullscreen comment block (~line 808), change wording from `calc(100svh-64px)` to `calc(100svh-4rem)` so future agents do not reintroduce px.

- [ ] **Step 6: Full inventory grep**

Run:

```bash
rg -n "100svh-64px|100svh-96px" apps/web/src
```

Expected: **zero** matches in product sources (comments updated).

- [ ] **Step 7: Commit**

```bash
git add \
  apps/web/src/app/\(app\)/agents/\[agentId\]/layout.tsx \
  apps/web/src/app/\(app\)/agents/\[agentId\]/jobs/layout.tsx \
  apps/web/src/app/\(app\)/agents/\[agentId\]/jobs/@right/page.tsx \
  apps/web/src/components/jobs/job-details/job-details-view.tsx \
  apps/web/src/app/share/layout.tsx \
  apps/web/src/app/share/components/shared-task-view.tsx \
  apps/web/src/app/globals.css
git commit -m "fix(web): rem-align remaining header-offset shells for Dynamic Type"
```

---

### Task 4: Static guard against reintroducing px header shells

**Files:**
- Create: `apps/web/src/lib/utils/__tests__/no-header-offset-px-shell.test.ts`

**Interfaces:**
- Produces: Vitest scan that fails if product TS/TSX/CSS under `apps/web/src` contain `100svh-64px` or `100svh-96px`

- [ ] **Step 1: Write the guard test**

```typescript
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../../..");
const SRC = path.join(ROOT, "src");

const FORBIDDEN = ["100svh-64px", "100svh-96px"] as const;

const EXTENSIONS = new Set([".ts", ".tsx", ".css"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".next") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
      continue;
    }
    if (EXTENSIONS.has(path.extname(entry.name))) {
      out.push(full);
    }
  }
  return out;
}

describe("no header-offset px shells", () => {
  it("bans 100svh-64px and 100svh-96px (use 4rem / 6rem to track Header h-16)", () => {
    const hits: string[] = [];
    for (const file of walk(SRC)) {
      const text = fs.readFileSync(file, "utf8");
      for (const needle of FORBIDDEN) {
        if (!text.includes(needle)) continue;
        const rel = path.relative(ROOT, file);
        hits.push(`${rel}: contains ${needle}`);
      }
    }
    expect(hits, hits.join("\n")).toEqual([]);
  });
});
```

Path note: `__dirname` for this file is `apps/web/src/lib/utils/__tests__`, so `../../..` is `apps/web`. Adjust if the package layout differs — final `SRC` must be `apps/web/src`.

- [ ] **Step 2: Run guard (should pass after Tasks 1–3)**

Run: `pnpm --filter web test src/lib/utils/__tests__/no-header-offset-px-shell.test.ts`

Expected: PASS with empty hits.

If FAIL: fix remaining inventory hits from the failure list, then re-run.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/utils/__tests__/no-header-offset-px-shell.test.ts
git commit -m "test(web): guard against px header-offset viewport shells"
```

---

### Task 5: Regression tests + manual smoke + secondary only if needed

**Files:**
- (optional secondary) `apps/web/src/app/(app)/tasks/components/tasks-view.tsx`
- (optional secondary) `apps/web/src/app/(app)/tasks/components/tasks-loading-view.tsx`
- (optional secondary) dense px height components only if type clips

**Interfaces:**
- Consumes: Tasks 1–4 complete
- Produces: verified acceptance; secondary fixes only with evidence

- [ ] **Step 1: Run targeted + font guard tests**

```bash
pnpm --filter web test \
  src/app/\(app\)/chat/components/__tests__/chat-mobile-tab-registry.test.ts \
  src/lib/utils/__tests__/no-header-offset-px-shell.test.ts \
  src/lib/utils/__tests__/no-fixed-font-size.test.ts
```

Expected: all PASS.

- [ ] **Step 2: Full inventory grep (final)**

```bash
rg -n "100svh-64px|100svh-96px" apps/web/src
```

Expected: no matches.

- [ ] **Step 3: Manual smoke at root 16px and 20px**

Simulate cap in browser DevTools: set `document.documentElement.style.fontSize = "20px"` (and clear for 16px).

Checklist:

| Surface | 16px | 20px |
| --- | --- | --- |
| Chat room (mobile width): header + messages + composer | OK | no shell overflow; messages scroll inside |
| Chats/home list + bottom nav | OK | nav usable; no double scroll spill |
| App header + sidebar | OK | no clip of primary chrome |
| Agents detail / jobs | OK | sticky column fits |
| Tasks board | OK | if board clips → convert `100vh-150px` to rem (e.g. `9.375rem` only if that was intentional 150/16; prefer measuring chrome) |
| Auth buttons / agent badges | OK | if type clips → `min-h-*` + wrap, not smaller type |

If chat still overflows at 20px after rem shells: inspect `rooms-client` flex chain (`min-h-0` / `overflow-hidden` on the outer shell only). Do not shrink type.

- [ ] **Step 4: Optional secondary commit (only if Step 3 found real clip)**

Example tasks board (only if needed):

```tsx
// prefer rem that matches measured chrome; do not invent without smoke evidence
"max-h-[calc(100vh-9.375rem)]" // 150/16 — only if 150px meant 9.375rem at default
```

Prefer measuring header+toolbar at 16px and converting that total to rem.

```bash
git add <only files that fixed real clip>
git commit -m "fix(web): ease Dynamic Type clip on <surface>"
```

If no secondary issues: skip commit; note `secondary skipped: no clip at 20px root` in PR body.

- [ ] **Step 5: Branch / draft PR (if not already on feature branch)**

```bash
# if still on main with only design+plan commits, create branch from current HEAD
git checkout -b sok-730-dynamic-type-layout-audit
# push and open draft PR with title = primary fix commit subject, e.g.
# fix(web): rem-align header-offset shells for Dynamic Type (SOK-730)
```

PR body must include:

- Link to SOK-730
- Summary: rem-align `100svh-64px` → `4rem` (and `96px` → `6rem`) app-wide
- Verification commands + smoke results
- Spec path

---

## Self-review (plan vs spec)

| Spec requirement | Task |
| --- | --- |
| Chat height shells rem | Task 1 |
| App main shells rem | Task 2 |
| Full-app inventory (agents, jobs, share, job-details) | Task 3 |
| Jobs `96px` → `6rem` | Task 3 |
| globals comment | Task 3 |
| Static ban on reintroduction | Task 4 |
| No new px fonts / guard green | Task 5 |
| Manual 16/20 smoke; secondary only if clip | Task 5 |
| Default root visual no-op | inherent (`4rem`@16 = 64px) |
| Do not raise cap / no plumbing redo | Global Constraints |

No TBD placeholders. Constant names match existing registry exports.
