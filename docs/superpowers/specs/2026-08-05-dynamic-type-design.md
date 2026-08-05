# Design: Apple Dynamic Type (iOS / macOS) for Sokosumi web

**Date:** 2026-08-05  
**Status:** Approved  
**Scope:** `apps/web` only (root typography, font-size purge, agent rules). No Core API or schema changes.

## Problem

Sokosumi web uses Inter via `next/font` and Tailwind rem-based utilities, but does **not** opt into Apple Dynamic Type. On iOS and macOS Safari (and home-screen PWA), the user’s Accessibility **text size** preference often does not scale product UI the way native apps do.

Additionally, many surfaces use fixed pixel type (`text-[10px]`, inline `font-size: Npx`, etc.). Those sizes ignore root rem scaling even after Dynamic Type is wired, so large-text users still see tiny labels and badges.

## Goals

- Respect **Apple Dynamic Type** for whole-app UI scale on supporting Safari / WKWebView.
- Keep **Inter** as the brand face; only the **size** comes from Dynamic Type.
- **Cap** scale at **1.25×** the default root size so dense chrome stays usable.
- **Eliminate fixed `px` font sizes** in product UI so all user-visible type tracks root rem.
- Encode the convention in **agent rules** (`AGENTS.md` + `.cursor/rules`) so future work does not reintroduce fixed type or break Dynamic Type.

## Non-goals

- Switching to SF Pro / system UI font on Apple (Inter stays).
- Supporting non-Apple OS text-size APIs beyond normal browser rem/zoom behavior.
- Full layout redesign for Accessibility sizes beyond the 1.25× cap.
- Changing icon pixel sizes or non-text fixed dimensions unless they clip scaled text (prefer `min-h` + padding when fixing clip).
- Core, email, or PDF print pipelines as primary surfaces (export/print may keep absolute sizes when not interactive browser UI; document any exception).

## Decisions (from brainstorming)

| Decision | Choice |
| --- | --- |
| Scope of scaling | Whole UI (root rem drives Tailwind text/spacing) |
| Typeface | Keep Inter; size from Dynamic Type only |
| Max scale | **1.25×** default root size |
| Approach | A: `-apple-system-body` on `html` + Inter re-apply + client cap |
| Fixed fonts | None remain in product UI |
| Agent convention | New rule file + short `AGENTS.md` pointer |

## Architecture

```
System Dynamic Type (Safari / WKWebView / PWA)
        ↓
@supports (font: -apple-system-body)
  html { font: -apple-system-body; … Inter family preserved }
        ↓
Client cap: computed root font-size ≤ 1.25 × default
        ↓
1rem = capped body size
        ↓
Tailwind text-* / rem spacing / rem heights scale together
```

### CSS (`apps/web/src/app/globals.css`)

Under `@layer base`, inside `@supports (font: -apple-system-body)`:

1. Set `html { font: -apple-system-body; }`.
2. Immediately restore brand family after the `font` shorthand so Inter from `next/font` on `<html>` is not replaced by the system text face. Implementation must verify computed `font-family` still resolves to Inter (re-declare family after shorthand if the class alone is insufficient).
3. Do **not** set a fixed `px` `font-size` on `html`/`body` outside the documented cap path.

Non-supporting browsers: no change; UA default root size remains.

### Cap client

- Constants: `DYNAMIC_TYPE_MAX_SCALE = 1.25`, `DYNAMIC_TYPE_DEFAULT_ROOT_PX = 16`, max root = **20px**.
- Early client bootstrap (minimal component or script mounted from root layout):
  - Read `computedPx` from `getComputedStyle(document.documentElement).fontSize`.
  - If `computedPx > 20`, set `document.documentElement.style.fontSize = "20px"`.
  - If `computedPx ≤ 20`, clear any previous inline override so CSS Dynamic Type remains in control.
- Re-run on `pageshow` and `visibilitychange` so Settings changes while backgrounded are picked up.
- No React state for the size; imperative DOM only.
- Failure mode: if script throws, leave CSS Dynamic Type uncapped rather than forcing a wrong size.

### Inter / layout

- Keep `Inter` from `next/font/google` on `<html className={inter.className}>` in `apps/web/src/app/layout.tsx`.
- Do not add viewport locks (`maximum-scale`, `user-scalable=no`). Existing chat `interactiveWidget: "resizes-content"` stays.

### Fixed font purge

Sweep `apps/web` product UI:

| Pattern | Action |
| --- | --- |
| `text-[Npx]` | Map to nearest Tailwind `text-*` step or arbitrary rem (e.g. `text-[0.625rem]`) |
| Inline `font-size: Npx` / `style={{ fontSize: "…px" }}` | rem, em, or Tailwind class |
| `font-size: Npx` in CSS modules / globals for UI | rem / theme tokens |

**Rule:** user-visible Sokosumi browser UI text must use rem, em, or Tailwind rem-based `text-*`. No bare `px` font-size in product surfaces.

**Allowlisted exceptions (must be named in PR if any remain):**

- True print/PDF export chrome not shown as interactive app UI.
- Third-party embeds we do not control.

A verification grep (or unit/lint test) must fail the build or test suite if new `text-[Npx]` / `font-size: Npx` appears outside the allowlist.

## Agent rules (same PR)

### `.cursor/rules/dynamic-type.mdc` (new)

Normative rule for agents:

1. Root size may come from Apple Dynamic Type (`-apple-system-body`); brand face stays Inter.
2. Cap is **1.25×** default (max root **20px** when default is 16px) — do not raise without product decision.
3. **No fixed `px` font sizes** in product UI — use Tailwind `text-*` or `rem`/`em`.
4. Do not set `maximum-scale=1` / `user-scalable=no` on the viewport.
5. Do not override `html`/`body` `font-size` with a fixed `px` that kills Dynamic Type, except the documented 1.25× cap path.

### `AGENTS.md` (and `apps/web/AGENTS.md` if typography is local)

Under **UI & Styling** (or equivalent), add a short bullet block that points at Dynamic Type + no `px` font sizes and references `.cursor/rules/dynamic-type.mdc` for full detail.

## Error handling & edge cases

| Case | Behavior |
| --- | --- |
| Non-Apple / no `@supports` | CSS skipped; cap is no-op when size ≤ 20px |
| Cap script fails | Leave CSS Dynamic Type; no forced wrong size |
| User changes text size mid-session | Re-clamp on `visibilitychange` / `pageshow` |
| `font` shorthand vs Inter | Family restored so Inter remains |
| FOUC | Brief flash acceptable; prefer early client mount over blocking HTML |
| Layout clip at 1.25× | Prefer `min-h` + wrap over shrinking type below Dynamic Type size |
| PDF / server print | Absolute sizes allowed only as documented non-UI exceptions |

No user-facing error UI for this feature.

## Testing

| Layer | What |
| --- | --- |
| Unit | Cap helper: sizes above 20px clamp to 20px; at/below leave unchanged |
| Static check | Grep/test: no product-UI `text-[Npx]` / `font-size: …px` outside allowlist |
| Manual (Apple) | iOS Safari + macOS Safari: Dynamic Type steps; UI scales; growth stops at ~1.25×; Inter still used |
| Regression smoke | Chat, agents, auth shells at default and max cap for overflow/clip |

## Implementation sketch (for planning)

1. Add cap helper + unit tests (`DYNAMIC_TYPE_MAX_SCALE = 1.25`, max 20px).
2. Mount early client bootstrap from root layout.
3. Add `@supports (font: -apple-system-body)` block in `globals.css`; preserve Inter.
4. Purge all product-UI fixed font sizes to rem/Tailwind.
5. Add verification test or CI-friendly grep for px font sizes.
6. Add `.cursor/rules/dynamic-type.mdc` + `AGENTS.md` (and web AGENTS if needed) pointers.
7. Manual verify on Apple devices/simulators where available.

## Success criteria

- On supporting Safari, increasing system text size increases app UI type up to **1.25×**, then stops.
- Inter remains the UI face.
- No fixed `px` font sizes remain in product UI (allowlist empty or documented).
- Agent docs forbid reintroducing fixed type and document the cap.
- Non-Apple browsers look unchanged at default zoom.
