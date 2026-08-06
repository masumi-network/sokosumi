# Design: Dynamic Type layout audit (1.25× cap)

**Date:** 2026-08-05  
**Status:** Approved  
**Issue:** [SOK-730](https://linear.app/masumi/issue/SOK-730/audit-and-fix-layouts-for-dynamic-type-125-cap)  
**Scope:** `apps/web` layout / shell CSS only. No Core API, schema, or Dynamic Type plumbing changes.

**Related:** PR #3665 (Dynamic Type wire-up); spec `docs/superpowers/specs/2026-08-05-dynamic-type-design.md`; rule `.cursor/rules/dynamic-type.mdc`.

## Problem

PR #3665 opts Sokosumi web into Apple Dynamic Type with a **1.25×** root rem cap (max 20px when default is 16px). That work intentionally did not redesign layouts.

App chrome heights use rem (e.g. `Header` `h-16` = **4rem**, which becomes **80px** at the cap). Many viewport shell calcs still subtract a **fixed 64px** header offset. At 1.25× the shell is ~16px taller than the remaining viewport → overflow (documented on **chat mobile shell**; same class of bug app-wide).

## Goals

1. At **default** and **~1.25×** root: no horizontal/vertical **shell overflow** that breaks primary navigation or primary content.
2. Prefer `min-h` + wrap/scroll over shrinking type below Dynamic Type size.
3. Align every header-offset shell with rem (`4rem` = `h-16`), **entire app**.
4. Only change surfaces that mismatch or actually clip — no blanket rem rewrite of all `h-[Npx]`.

## Non-goals

- Raising the 1.25× cap or supporting uncapped Accessibility sizes.
- Non-Apple OS text-size APIs.
- Re-doing Dynamic Type plumbing (`dynamic-type.ts`, `DynamicTypeRootCap`, `@supports` CSS).
- Full structural flex rewrite of every `svh` shell (optional later).
- Decorative fixed sizes with no text (icons, splash assets).

## Decision

| Decision | Choice |
| --- | --- |
| Depth | **Systemic rem align** for all header-offset shells |
| Implementation | **A + light B:** mechanical `64px` → `4rem` (and `96px` → `6rem` where paired); keep named constants in chat tab registry |
| Secondary dense px | Fix only if smoke at 1.25× shows real clip |
| Type sizes | Unchanged; no new product-UI fixed `px` fonts |

## Architecture

```text
html root rem (capped 1.25×)
        ↓
Header h-16 (= 4rem, scales with root)
        ↓
Shell heights: calc(100svh - 4rem)   ← must match header unit
Tab bar clearance: already 4rem      ← already OK
```

**Default root (16px):** `4rem` ≡ `64px` → visual no-op.  
**Cap (20px):** header and shells both use 80px equivalent → no systematic overflow.

### Contract

| Input | Output |
| --- | --- |
| Root at 16px | Layout unchanged vs pre-fix (4rem = 64px) |
| Root at 20px (cap) | Shells track header; primary nav/content usable |
| Chat room at cap | Composer + nav usable; messages scroll inside shell |
| Product UI type | No new fixed `px` fonts (existing guard stays green) |

## Full-app inventory (must fix)

Any viewport shell that subtracts **app header height** must use **4rem**, not raw `64px`.

| Area | File(s) | Change |
| --- | --- | --- |
| App main shell | `apps/web/src/app/(app)/components/authenticated-app-frame.tsx`, `app-shell-loading-frame.tsx` | `100svh-64px` → `100svh-4rem` |
| Chat room shell | `apps/web/src/app/(app)/chat/components/chat-mobile-tab-registry.ts` | both height-shell constants |
| Agents layout | `apps/web/src/app/(app)/agents/[agentId]/layout.tsx` | same |
| Jobs layout | `apps/web/src/app/(app)/agents/[agentId]/jobs/layout.tsx` | `64px` → `4rem`; **`96px` → `6rem`** (paired offset; keep ratio) |
| Jobs right empty | `apps/web/src/app/(app)/agents/[agentId]/jobs/@right/page.tsx` | `64px` → `4rem` |
| Job details aside | `apps/web/src/components/jobs/job-details/job-details-view.tsx` | same |
| Share layout + aside | `apps/web/src/app/share/layout.tsx`, `share/components/shared-task-view.tsx` | same |
| Comment only | `apps/web/src/app/globals.css` (hermes fullscreen comment) | document `4rem` so agents do not reintroduce `64px` |

### Already rem-safe (smoke only)

- Chat tab-bar clearance / composer bottom offsets (`4rem` + safe-area) in `chat-mobile-tab-registry.ts`
- Kanban `min-h-[calc(100svh-8.5rem)]`
- Dialogs using `100svh-2rem` / `100svh-2rem`-style rem gutters

### Secondary audit (fix only if clip at 1.25×)

- Tasks board `max-h-[calc(100vh-150px)]` in `tasks-view.tsx` / `tasks-loading-view.tsx` — convert to rem **if** board overflows/clips at cap
- Dense fixed-px boxes with text: agent badges `h-[22px]`, auth social buttons `h-[50px]` → prefer `min-h-*` + wrap **only if** type clips
- Room header `h-12` / `md:h-16` — rem already; only adjust flex/`min-h-0` if overflow remains after shell rem-align

## Chat flex chain (primary known break)

After rem shell fix, keep the existing flex contract — do not redesign:

```text
rooms-client outer: -m-4 + height shell + overflow-hidden + flex-col
  main: min-h-0 flex-1
    section: min-h-0 flex-1 flex-col
      header: shrink-0 (h-12 / md:h-16)
      ScrollArea: min-h-0 flex-1   ← messages scroll here
      composer: shrink-0
  ThreadPanel: min-h-0 + own ScrollArea (mobile full-screen / desktop side)
```

| Surface | Expectation at 1.25× |
| --- | --- |
| Room + draft | Shell fits viewport; no body scroll spill |
| Composer | Usable; sits above keyboard / chrome |
| Bottom nav (list routes) | Usable; spacer still `4rem` + safe-area |
| Thread panel | Scroll inside; no double overflow |
| Message list | Scrolls inside shell only |

If rem alignment alone leaves overflow: tighten `min-h-0` / `overflow-hidden` on that link only — never shrink type.

## App chrome

- Header stays `h-16` (scales with rem).
- Main `md:min/max-h-[calc(100svh-4rem)]` matches header.
- Mobile main: keep `min/max-h-svh` + `pt-20` (fixed header clearance); no new fixed-px header offsets.
- Sidebar header `h-16` — rem OK; change only if smoke shows clip.

## Edge cases

| Case | Behavior |
| --- | --- |
| Default root 16px | `4rem` = `64px` → no visual delta |
| Cap 20px | Shells track header; no systematic ~16px spill |
| User changes text size mid-session | Cap client already re-runs; rem shells update with root |
| Mobile fixed header + `pt-20` | Keep; only the md `svh − header` path was unit-mismatched |
| Jobs `96px` shell | → `6rem` (same pixel ratio as today at 16px root) |
| Secondary dense px | Touch only if smoke shows clip at 1.25× |
| Non-Apple / no Dynamic Type | Unchanged default rem |

## Testing / verification

| Layer | What |
| --- | --- |
| Static | Grep: no remaining product-shell `100svh-64px` or `100svh-96px` (or document intentional leftover) |
| Unit | Existing no-fixed-font-size guard still green |
| Manual / browser | Root `font-size` **16px** vs **20px** (cap simulation): chat room (mobile width), chats list + bottom nav, app header/sidebar, agents detail/jobs, tasks board, auth smoke |
| Device (ideal) | iOS Safari Dynamic Type default → max within 1.25× cap |
| Regression | No layout change at default root |

## Implementation sketch

1. Update chat height-shell constants (`64px` → `4rem`).
2. Replace app-frame / loading-frame `100svh-64px` with `100svh-4rem`.
3. Replace remaining inventory rows (agents, jobs, share, job-details).
4. Jobs layout: `96px` → `6rem`.
5. Update `globals.css` hermes comment to say `4rem`.
6. Static grep for leftover header-offset px shells.
7. Smoke at 16px and 20px root; fix secondary clip only if real.
8. Keep font-size guard green.

## Delivery

- Branch: Linear `gitBranchName` preferred (`sok-730-audit-and-fix-layouts-for-dynamic-type-125×-cap`, or short kebab if `×` is awkward for git).
- Draft PR; title = primary Conventional Commit subject.
- PR body: SOK-730 link + short summary of rem shell align + verification.

## Success criteria

- [ ] All full-app header-offset shells use rem (`4rem` / `6rem` as specified).
- [ ] Chat mobile shell: no overflow; composer + nav usable; messages scroll inside shell at ~1.25×.
- [ ] App chrome, agents, tasks, auth: smoke OK at default and cap.
- [ ] No new product-UI fixed `px` font sizes.
- [ ] Default root layout visually unchanged.
