# Apple Dynamic Type Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Sokosumi web respect Apple Dynamic Type (iOS/macOS) for whole-UI rem scale, keep Inter, cap at 1.25× (max 20px root), purge all product-UI fixed `px` font sizes, and document the rule for agents.

**Architecture:** Opt into `-apple-system-body` on `html` under `@supports` in `globals.css`, re-apply Inter from `next/font`, clamp root size with a pure helper + early client bootstrap, convert every product `text-[Npx]` / `font-size: Npx` to rem-based type, and guard with a Vitest scan plus `.cursor/rules/dynamic-type.mdc` + `AGENTS.md`.

**Tech Stack:** Next.js App Router (`apps/web`), React 19 client components, Tailwind CSS v4, Vitest, Biome. No new npm dependencies.

**Spec:** `docs/superpowers/specs/2026-08-05-dynamic-type-design.md`

## Global Constraints

- Cap: `DYNAMIC_TYPE_MAX_SCALE = 1.25`, default root `16px`, max root `20px`
- Brand face: Inter only (size from Dynamic Type; no SF Pro switch)
- Whole UI scales via root rem
- **No fixed `px` font sizes** in product UI (allowlist only true non-UI export/print if unavoidable)
- Do not set `maximum-scale=1` / `user-scalable=no`
- Do not set fixed `px` on `html`/`body` except the documented 20px cap path
- Web-only; no Core API / schema / new deps
- Conventional Commits; Biome format; pin no registry ranges
- Prefer pure helpers testable without DOM where possible

## File map

| File | Responsibility |
| --- | --- |
| `apps/web/src/lib/utils/dynamic-type.ts` | Constants + pure cap helpers (`clampRootFontSizePx`, `applyDynamicTypeRootCap`) |
| `apps/web/src/lib/utils/__tests__/dynamic-type.test.ts` | Unit tests for clamp math |
| `apps/web/src/components/dynamic-type-root-cap.tsx` | Early client bootstrap: apply cap, listen `pageshow` / `visibilitychange` |
| `apps/web/src/app/layout.tsx` | Mount `<DynamicTypeRootCap />` next to other root clients |
| `apps/web/src/app/globals.css` | `@supports (font: -apple-system-body)` block on `html` |
| ~37 product TSX files under `apps/web/src` | Replace `text-[Npx]` with rem / Tailwind `text-*` |
| `apps/web/src/app/global-error.tsx` | Replace numeric `fontSize: 14` (React px) with rem |
| `apps/web/src/app/api/export/pdf/route.ts` | Allowlisted exception: keep or document print `font-size: 10px` |
| `apps/web/src/lib/utils/__tests__/no-fixed-font-size.test.ts` | Repo scan: fail if product UI reintroduces `px` font sizes |
| `.cursor/rules/dynamic-type.mdc` | Normative agent rule |
| `AGENTS.md` | UI & Styling pointer to Dynamic Type + no px fonts |
| `apps/web/AGENTS.md` | Short Styling pointer (if typography is local) |

**Mapping guide (16px root):**

| Old | Prefer |
| --- | --- |
| `text-[9px]` | `text-[0.5625rem]` |
| `text-[10px]` | `text-[0.625rem]` |
| `text-[11px]` | `text-[0.6875rem]` |
| `text-[13px]` | `text-[0.8125rem]` |
| `text-[15px]` | `text-sm` (0.875rem) only if 14px is acceptable; else `text-[0.9375rem]` |
| `text-[26px]` | `text-[1.625rem]` |
| `text-[30px]` | `text-3xl` (1.875rem) or `text-[1.875rem]` |
| `text-[36px]` | `text-4xl` (2.25rem) or `text-[2.25rem]` |

Use exact rem when micro-type fidelity matters (badges, uppercase labels). Do not leave any `text-[Npx]`.

---

### Task 1: Cap helper + unit tests (TDD)

**Files:**
- Create: `apps/web/src/lib/utils/dynamic-type.ts`
- Create: `apps/web/src/lib/utils/__tests__/dynamic-type.test.ts`

**Interfaces:**
- Produces:
  - `DYNAMIC_TYPE_MAX_SCALE = 1.25` (as const)
  - `DYNAMIC_TYPE_DEFAULT_ROOT_PX = 16` (as const)
  - `DYNAMIC_TYPE_MAX_ROOT_PX = 20` (as const) — `16 * 1.25`
  - `clampRootFontSizePx(computedPx: number): number` — returns `min(computedPx, DYNAMIC_TYPE_MAX_ROOT_PX)`; if `computedPx` is NaN/non-finite/≤0, return `DYNAMIC_TYPE_DEFAULT_ROOT_PX`
  - `shouldApplyRootFontSizeInline(computedPx: number): boolean` — `true` only when `computedPx > DYNAMIC_TYPE_MAX_ROOT_PX`
  - `applyDynamicTypeRootCap(root: HTMLElement = document.documentElement): void` — reads computed font-size; if over cap sets `root.style.fontSize = "20px"`; else sets `root.style.fontSize = ""` (clear override)

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, expect, it } from "vitest";

import {
  clampRootFontSizePx,
  DYNAMIC_TYPE_DEFAULT_ROOT_PX,
  DYNAMIC_TYPE_MAX_ROOT_PX,
  DYNAMIC_TYPE_MAX_SCALE,
  shouldApplyRootFontSizeInline,
} from "@/lib/utils/dynamic-type";

describe("dynamic-type constants", () => {
  it("caps at 1.25× of 16px → 20px", () => {
    expect(DYNAMIC_TYPE_MAX_SCALE).toBe(1.25);
    expect(DYNAMIC_TYPE_DEFAULT_ROOT_PX).toBe(16);
    expect(DYNAMIC_TYPE_MAX_ROOT_PX).toBe(20);
  });
});

describe("clampRootFontSizePx", () => {
  it("leaves sizes at or under 20px unchanged", () => {
    expect(clampRootFontSizePx(16)).toBe(16);
    expect(clampRootFontSizePx(17)).toBe(17);
    expect(clampRootFontSizePx(20)).toBe(20);
  });

  it("clamps sizes above 20px to 20", () => {
    expect(clampRootFontSizePx(21)).toBe(20);
    expect(clampRootFontSizePx(28)).toBe(20);
    expect(clampRootFontSizePx(100)).toBe(20);
  });

  it("falls back to 16 for invalid input", () => {
    expect(clampRootFontSizePx(Number.NaN)).toBe(16);
    expect(clampRootFontSizePx(0)).toBe(16);
    expect(clampRootFontSizePx(-4)).toBe(16);
  });
});

describe("shouldApplyRootFontSizeInline", () => {
  it("is true only when over cap", () => {
    expect(shouldApplyRootFontSizeInline(16)).toBe(false);
    expect(shouldApplyRootFontSizeInline(20)).toBe(false);
    expect(shouldApplyRootFontSizeInline(20.1)).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
pnpm --filter web test src/lib/utils/__tests__/dynamic-type.test.ts
```

Expected: FAIL (module missing or exports missing).

- [ ] **Step 3: Implement helper**

```typescript
export const DYNAMIC_TYPE_MAX_SCALE = 1.25 as const;
export const DYNAMIC_TYPE_DEFAULT_ROOT_PX = 16 as const;
export const DYNAMIC_TYPE_MAX_ROOT_PX = 20 as const; // 16 * 1.25

export function clampRootFontSizePx(computedPx: number): number {
  if (!Number.isFinite(computedPx) || computedPx <= 0) {
    return DYNAMIC_TYPE_DEFAULT_ROOT_PX;
  }
  return Math.min(computedPx, DYNAMIC_TYPE_MAX_ROOT_PX);
}

export function shouldApplyRootFontSizeInline(computedPx: number): boolean {
  return (
    Number.isFinite(computedPx) && computedPx > DYNAMIC_TYPE_MAX_ROOT_PX
  );
}

export function applyDynamicTypeRootCap(
  root: HTMLElement = document.documentElement,
): void {
  const computedPx = Number.parseFloat(
    globalThis.getComputedStyle(root).fontSize,
  );
  if (shouldApplyRootFontSizeInline(computedPx)) {
    root.style.fontSize = `${DYNAMIC_TYPE_MAX_ROOT_PX}px`;
    return;
  }
  root.style.fontSize = "";
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
pnpm --filter web test src/lib/utils/__tests__/dynamic-type.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/utils/dynamic-type.ts apps/web/src/lib/utils/__tests__/dynamic-type.test.ts
git commit -m "feat(web): add Dynamic Type root size cap helper"
```

---

### Task 2: CSS Dynamic Type opt-in + client bootstrap

**Files:**
- Modify: `apps/web/src/app/globals.css` (`@layer base` near `body` rules ~469–475)
- Create: `apps/web/src/components/dynamic-type-root-cap.tsx`
- Modify: `apps/web/src/app/layout.tsx`

**Interfaces:**
- Consumes: `applyDynamicTypeRootCap` from `@/lib/utils/dynamic-type`
- Produces: `<DynamicTypeRootCap />` client component (renders `null`)

- [ ] **Step 1: Add CSS under `@layer base`**

In `apps/web/src/app/globals.css`, inside `@layer base` after the existing `body` rule:

```css
  /*
   * Apple Dynamic Type (iOS/macOS Safari / PWA): map system body size to root
   * rem. Inter stays the face via next/font class on <html>; re-declare family
   * after the `font` shorthand so it is not replaced by the system text face.
   * Cap (>20px) is applied in DynamicTypeRootCap — do not hardcode px here.
   */
  @supports (font: -apple-system-body) {
    html {
      font: -apple-system-body;
      font-family: var(--font-inter), ui-sans-serif, system-ui, sans-serif,
        "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol",
        "Noto Color Emoji";
    }
  }
```

**Inter variable:** `next/font` Inter currently only sets `className` on `<html>`, not a CSS variable. Update `layout.tsx` Inter config to expose a variable:

```typescript
const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  fallback: ["sans-serif"],
  variable: "--font-inter",
});
```

And on `<html>`:

```tsx
className={`${inter.className} ${inter.variable}`}
```

If computed family still drifts, keep both `className` and `variable` as above (required).

- [ ] **Step 2: Create client bootstrap**

`apps/web/src/components/dynamic-type-root-cap.tsx`:

```tsx
"use client";

import { useEffect } from "react";

import { applyDynamicTypeRootCap } from "@/lib/utils/dynamic-type";

export function DynamicTypeRootCap() {
  useEffect(() => {
    applyDynamicTypeRootCap();

    function handleResume() {
      applyDynamicTypeRootCap();
    }

    window.addEventListener("pageshow", handleResume);
    document.addEventListener("visibilitychange", handleResume);

    return () => {
      window.removeEventListener("pageshow", handleResume);
      document.removeEventListener("visibilitychange", handleResume);
    };
  }, []);

  return null;
}
```

- [ ] **Step 3: Mount in root layout**

In `apps/web/src/app/layout.tsx`, import and render next to other root clients (inside `<body>`, siblings of `ClientAnalytics`):

```tsx
import { DynamicTypeRootCap } from "@/components/dynamic-type-root-cap";
// ...
<body className="bg-background min-h-svh max-w-dvw antialiased">
  <DynamicTypeRootCap />
  {/* existing providers */}
```

- [ ] **Step 4: Optional unit test for apply with mock DOM**

Append to `dynamic-type.test.ts` (happy-dom / jsdom already available in web Vitest):

```typescript
import { applyDynamicTypeRootCap } from "@/lib/utils/dynamic-type";

describe("applyDynamicTypeRootCap", () => {
  it("sets inline 20px when computed size is over cap", () => {
    const el = document.createElement("div");
    el.style.fontSize = "28px";
    document.body.appendChild(el);
    // Stub getComputedStyle for this element
    const original = globalThis.getComputedStyle;
    globalThis.getComputedStyle = ((target: Element) => {
      if (target === el) {
        return { fontSize: "28px" } as CSSStyleDeclaration;
      }
      return original(target);
    }) as typeof getComputedStyle;

    applyDynamicTypeRootCap(el);
    expect(el.style.fontSize).toBe("20px");

    globalThis.getComputedStyle = original;
    el.remove();
  });

  it("clears inline size when at or under cap", () => {
    const el = document.createElement("div");
    el.style.fontSize = "20px";
    const original = globalThis.getComputedStyle;
    globalThis.getComputedStyle = ((target: Element) => {
      if (target === el) {
        return { fontSize: "17px" } as CSSStyleDeclaration;
      }
      return original(target);
    }) as typeof getComputedStyle;

    applyDynamicTypeRootCap(el);
    expect(el.style.fontSize).toBe("");

    globalThis.getComputedStyle = original;
  });
});
```

- [ ] **Step 5: Run tests**

```bash
pnpm --filter web test src/lib/utils/__tests__/dynamic-type.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/globals.css apps/web/src/app/layout.tsx \
  apps/web/src/components/dynamic-type-root-cap.tsx \
  apps/web/src/lib/utils/__tests__/dynamic-type.test.ts
git commit -m "feat(web): wire Apple Dynamic Type root size and 1.25x cap"
```

---

### Task 3: Purge product-UI fixed font sizes

**Files:** All product files currently matching `text-[Npx]` or React/`font-size` px (inventory at plan time):

```
apps/web/src/app/(app)/chat/components/draft-direct-message.tsx
apps/web/src/app/(app)/chat/components/participant-checkboxes.tsx
apps/web/src/app/(app)/chat/components/room-composer.tsx
apps/web/src/app/(app)/chat/components/room-draft-shared.tsx
apps/web/src/app/(app)/chat/components/room-message-row.tsx
apps/web/src/app/(app)/chat/components/rooms-client.tsx
apps/web/src/app/(app)/components/header/header-notification-bell.client.tsx
apps/web/src/app/(app)/components/onboarding-dialog.tsx
apps/web/src/app/(app)/components/sidebar/components/menu-items.tsx
apps/web/src/app/(app)/components/sidebar/components/personal-assistant-nav.client.tsx
apps/web/src/app/(app)/components/sidebar/components/sidebar-account-chip.client.tsx
apps/web/src/app/(app)/history/components/history-list-item.tsx
apps/web/src/app/(app)/personal-assistant/components/running-state/confirmation-card.tsx
apps/web/src/app/(app)/personal-assistant/components/running-state/message-row.tsx
apps/web/src/app/(app)/personal-assistant/components/skills-marketplace.tsx
apps/web/src/app/(app)/tasks/components/job-list-item.tsx
apps/web/src/app/(app)/tasks/components/task-activity.tsx
apps/web/src/app/(app)/tasks/components/task-created-celebration.tsx
apps/web/src/app/(app)/tasks/components/task-design-md-attachment.tsx
apps/web/src/app/(app)/tasks/components/task-meta.tsx
apps/web/src/app/(app)/tasks/components/task-metadata.tsx
apps/web/src/app/(app)/tasks/components/tasks-empty-state-overlay.tsx
apps/web/src/app/(auth)/components/social-buttons.tsx
apps/web/src/app/(auth)/signin/components/form.tsx
apps/web/src/app/share/components/shared-task-view.tsx
apps/web/src/components/agents/rating-list-item.tsx
apps/web/src/components/chat/chat-room-sidebar-row.tsx
apps/web/src/components/chat/organization-chat-list.client.tsx
apps/web/src/components/chat/preview-attachment.tsx
apps/web/src/components/common/filter-dropdown-menu.tsx
apps/web/src/components/jobs/agent-job-status-badge.tsx
apps/web/src/components/jobs/job-details/job-details-view.tsx
apps/web/src/components/onboarding/taskboard-visual.tsx
apps/web/src/components/organizations/create-organization-wizard/create-organization-wizard.tsx
apps/web/src/components/ui/document-text-preview.tsx
apps/web/src/components/ui/file-upload.tsx
apps/web/src/components/user/user-profile-avatar.tsx
apps/web/src/lib/utils/file-upload-progress-toast.tsx
apps/web/src/app/global-error.tsx
```

**Allowlist (do not convert, document in test):**

- `apps/web/src/app/api/export/pdf/route.ts` — Puppeteer print chrome (`font-size: 10px` in HTML string). Not interactive browser UI.

**Interfaces:** None new. Mechanical class renames per mapping guide.

- [ ] **Step 1: Replace every product `text-[Npx]`**

For each file in the list above, replace using the mapping guide. Prefer project-wide search:

```bash
rg -n 'text-\[[0-9]+px\]' apps/web/src --glob '*.{tsx,ts,css}'
```

Example replacements:

- `text-[10px]` → `text-[0.625rem]`
- `text-[9px]` → `text-[0.5625rem]`
- `text-[11px]` → `text-[0.6875rem]`
- `text-[13px]` → `text-[0.8125rem]`
- `text-[15px]` → `text-[0.9375rem]`
- `text-[26px]` → `text-[1.625rem]`
- `text-[30px]` → `text-[1.875rem]`
- `text-[36px]` → `text-[2.25rem]`

- [ ] **Step 2: Fix non-Tailwind px font sizes in product UI**

`apps/web/src/app/global-error.tsx` — React `fontSize: 14` is pixels. Change to rem string:

```typescript
fontSize: "0.875rem",
```

Search also:

```bash
rg -n 'fontSize:\s*[0-9]+|font-size:\s*[0-9]+px|fontSize:\s*["'\''][0-9]+px' apps/web/src --glob '*.{tsx,ts,css}'
```

Convert any product hits; leave only the PDF export allowlist.

- [ ] **Step 3: Verify purge**

```bash
rg -n 'text-\[[0-9]+px\]' apps/web/src --glob '*.{tsx,ts,css}'
# Expected: no matches

rg -n 'font-size:\s*[0-9]+px' apps/web/src --glob '*.{tsx,ts,css}'
# Expected: only apps/web/src/app/api/export/pdf/route.ts (or zero if you moved that to rem too)
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src
git commit -m "fix(web): replace fixed px font sizes with rem for Dynamic Type"
```

---

### Task 4: Guardrail test — no fixed product font sizes

**Files:**
- Create: `apps/web/src/lib/utils/__tests__/no-fixed-font-size.test.ts`

**Interfaces:**
- Consumes: filesystem under `apps/web/src`
- Allowlist paths (relative to `apps/web/src`):
  - `app/api/export/pdf/route.ts`

- [ ] **Step 1: Write the scan test**

```typescript
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const SRC_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

/** Paths relative to apps/web/src that may keep px font sizes (non-product UI). */
const ALLOWLIST = new Set(["app/api/export/pdf/route.ts"]);

const TEXT_PX_CLASS = /text-\[\d+px\]/;
const FONT_SIZE_PX = /font-size:\s*\d+px/i;
const FONT_SIZE_STYLE_NUM = /fontSize:\s*\d+\b/;
const FONT_SIZE_STYLE_PX = /fontSize:\s*["']\d+px["']/;

const EXTENSIONS = new Set([".ts", ".tsx", ".css"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next") continue;
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(full, out);
      continue;
    }
    if (EXTENSIONS.has(path.extname(name))) {
      out.push(full);
    }
  }
  return out;
}

describe("no fixed px font sizes in product UI", () => {
  it("has no text-[Npx], font-size: Npx, or fontSize: N outside allowlist", () => {
    const violations: string[] = [];

    for (const file of walk(SRC_ROOT)) {
      const rel = path.relative(SRC_ROOT, file).split(path.sep).join("/");
      if (ALLOWLIST.has(rel)) continue;
      // Skip this test file and the dynamic-type helper (cap uses "20px" string intentionally)
      if (rel.endsWith("no-fixed-font-size.test.ts")) continue;
      if (rel === "lib/utils/dynamic-type.ts") continue;
      if (rel.endsWith("dynamic-type.test.ts")) continue;

      const content = readFileSync(file, "utf8");
      const lines = content.split("\n");
      lines.forEach((line, i) => {
        if (
          TEXT_PX_CLASS.test(line) ||
          FONT_SIZE_PX.test(line) ||
          FONT_SIZE_STYLE_NUM.test(line) ||
          FONT_SIZE_STYLE_PX.test(line)
        ) {
          violations.push(`${rel}:${i + 1}: ${line.trim()}`);
        }
      });
    }

    expect(violations, violations.join("\n")).toEqual([]);
  });
});
```

Note: `dynamic-type.ts` is allowlisted in the skip list because it intentionally writes `"20px"` for the cap. That is the only runtime root override; product components must not use px type.

- [ ] **Step 2: Run test — expect PASS after Task 3**

```bash
pnpm --filter web test src/lib/utils/__tests__/no-fixed-font-size.test.ts
```

If FAIL, fix remaining product files (Task 3 residual) then re-run.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/utils/__tests__/no-fixed-font-size.test.ts
git commit -m "test(web): guard against fixed px font sizes in product UI"
```

---

### Task 5: Agent rules (`AGENTS.md` + `.cursor/rules`)

**Files:**
- Create: `.cursor/rules/dynamic-type.mdc`
- Modify: `AGENTS.md` (UI & Styling section ~lines 61–67)
- Modify: `apps/web/AGENTS.md` (Styling section ~line 315 area — add short bullets)

- [ ] **Step 1: Create `.cursor/rules/dynamic-type.mdc`**

```markdown
---
description: "Apple Dynamic Type and no fixed px font sizes in apps/web"
alwaysApply: true
---

## Dynamic Type (iOS / macOS)

Sokosumi web opts into Apple Dynamic Type for whole-UI rem scaling.

1. **Root size** may come from `-apple-system-body` on `html` (see `apps/web/src/app/globals.css`). Brand face stays **Inter** (`next/font`).
2. **Cap is 1.25×** default (`DYNAMIC_TYPE_MAX_SCALE = 1.25`, max root **20px** when default is 16px). Implemented in `apps/web/src/lib/utils/dynamic-type.ts` + `DynamicTypeRootCap`. Do not raise the cap without product decision.
3. **No fixed `px` font sizes** in product UI. Use Tailwind `text-*` or `rem`/`em` (e.g. `text-[0.625rem]` not `text-[10px]`). Guard: `apps/web/src/lib/utils/__tests__/no-fixed-font-size.test.ts`.
4. Do **not** set viewport `maximum-scale=1` or `user-scalable=no`.
5. Do **not** set `html`/`body` `font-size` to a fixed `px` that kills Dynamic Type, except the documented 20px cap path.

Allowlist for px font sizes: true non-interactive export/print only (e.g. PDF Puppeteer chrome), named in the guard test.
```

- [ ] **Step 2: Update root `AGENTS.md` UI & Styling**

After the existing Themes bullet, add:

```markdown
- **Dynamic Type (iOS/macOS)**: Root rem may track Apple Dynamic Type (`-apple-system-body`); Inter stays the face; scale capped at **1.25×** (max 20px root). See `.cursor/rules/dynamic-type.mdc` and `apps/web/src/lib/utils/dynamic-type.ts`.
- **Font sizes**: Never use fixed `px` type in product UI (`text-[10px]`, `font-size: 12px`, `fontSize: 14`). Use Tailwind `text-*` or `rem`/`em` so type scales with root.
```

- [ ] **Step 3: Update `apps/web/AGENTS.md` Styling**

Under `### Styling`, add the same two bullets (or a one-liner pointing at root `AGENTS.md` + `.cursor/rules/dynamic-type.mdc`).

- [ ] **Step 4: Commit**

```bash
git add .cursor/rules/dynamic-type.mdc AGENTS.md apps/web/AGENTS.md
git commit -m "docs(agents): require Dynamic Type-safe typography (no px fonts)"
```

---

### Task 6: Verification pass

**Files:** none new (run commands only).

- [ ] **Step 1: Unit + guard tests**

```bash
pnpm --filter web test src/lib/utils/__tests__/dynamic-type.test.ts
pnpm --filter web test src/lib/utils/__tests__/no-fixed-font-size.test.ts
```

Expected: PASS.

- [ ] **Step 2: Typecheck web**

```bash
pnpm --filter web typecheck
```

Expected: PASS.

- [ ] **Step 3: Biome on touched paths**

```bash
pnpm exec biome check apps/web/src/lib/utils/dynamic-type.ts \
  apps/web/src/lib/utils/__tests__/dynamic-type.test.ts \
  apps/web/src/lib/utils/__tests__/no-fixed-font-size.test.ts \
  apps/web/src/components/dynamic-type-root-cap.tsx \
  apps/web/src/app/layout.tsx \
  apps/web/src/app/globals.css
```

Fix any issues with `pnpm exec biome check --write …` as needed.

- [ ] **Step 4: Manual checklist (Apple)**

On iOS Safari and/or macOS Safari (simulator OK):

1. Default text size — app looks like today (root ~16px).
2. Increase Dynamic Type several steps — body and UI type grow; Inter still used.
3. Push past ~1.25× — growth stops (root ≤ 20px); layout remains usable.
4. Spot-check chat, agents list, auth — no clipped labels from residual fixed type.
5. Non-Apple browser (Chrome desktop) — default zoom unchanged.

- [ ] **Step 5: Final commit only if verification fixed anything**

```bash
git status
# commit residual fixes if any
```

---

## Spec coverage checklist

| Spec requirement | Task |
| --- | --- |
| `-apple-system-body` on html under `@supports` | Task 2 |
| Inter preserved | Task 2 (`--font-inter` + className) |
| Cap 1.25× / max 20px | Task 1–2 |
| Re-apply on pageshow / visibilitychange | Task 2 |
| Whole UI rem scale | Task 2 + 3 |
| No product `px` fonts | Task 3–4 |
| PDF export allowlist | Task 3–4 |
| `.cursor/rules/dynamic-type.mdc` | Task 5 |
| `AGENTS.md` pointer | Task 5 |
| Unit tests for cap | Task 1 |
| Guard test | Task 4 |
| Manual Apple verify | Task 6 |

## Execution notes

- Prefer a feature branch (not committing design-only work onto diverged `main` without pull); worktree already used for this session.
- Task 3 is large but mechanical — one commit is fine; split by area (chat / tasks / auth / shared) only if review needs smaller diffs.
- Do not hand-edit generated clients.
- After implementation, human merges; open draft PR with Conventional Commit title matching primary commit subject if shipping via PR.
