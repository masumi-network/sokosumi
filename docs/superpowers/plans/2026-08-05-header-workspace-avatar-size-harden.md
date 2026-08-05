# Header Workspace Avatar Size Harden Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make personal and org workspace avatars in the closed header switcher both render at compact `size-4` so icon sizes cannot break top-right chrome alignment.

**Architecture:** Fix the size-class leak in `UserAvatarContent` (drop `md:size-10` so caller `className` fully wins via `cn`/`tailwind-merge`). Lock behavior with a unit test. No header layout redesign.

**Tech Stack:** React, Tailwind CSS + `cn` (clsx + tailwind-merge), Vitest + Testing Library, Next.js web app.

**Spec:** `docs/superpowers/specs/2026-08-05-header-workspace-avatar-size-harden-design.md`

## Global Constraints

- Closed switcher avatar size: **`size-4` (16px)** for personal and org
- Do not change dropdown menu avatars (`size-6`), notification bell, or sidebar chips
- Prefer editing existing files; no new shared size API
- Tests: Vitest via `pnpm --filter web test path/to/file.test.ts` (no extra `--`)
- Commits: Conventional Commits

## File map

| File | Role |
| --- | --- |
| `apps/web/src/app/(app)/components/user-avatar/user-avatar-content.tsx` | Default size only; caller overrides |
| `apps/web/src/app/(app)/components/user-avatar/__tests__/user-avatar-content.test.tsx` | New — size override lock |
| `apps/web/src/app/(app)/components/header/header-workspace-avatar.tsx` | Unchanged API; personal path fixed via UserAvatarContent |
| `apps/web/src/app/(app)/components/header/header-workspace-switch.client.tsx` | Already passes `size-4 shrink-0`; no layout change |

---

### Task 1: TDD — UserAvatarContent size override

**Files:**
- Create: `apps/web/src/app/(app)/components/user-avatar/__tests__/user-avatar-content.test.tsx`
- Modify: `apps/web/src/app/(app)/components/user-avatar/user-avatar-content.tsx`
- Test: `apps/web/src/app/(app)/components/user-avatar/__tests__/user-avatar-content.test.tsx`

**Interfaces:**
- Consumes: `UserAvatarContent({ className?: string; imageUrl?: string; imageAlt?: string })`
- Produces: Avatar root classes where caller size fully replaces default (no leftover `md:size-10`)

- [x] **Step 1: Write the failing test**

```tsx
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import UserAvatarContent from "@/app/components/user-avatar/user-avatar-content";

describe("UserAvatarContent", () => {
  it("defaults to size-8 without a size override", () => {
    const { container } = render(<UserAvatarContent imageAlt="User" />);
    const avatar = container.querySelector("[data-slot='avatar']");
    expect(avatar?.className).toContain("size-8");
    expect(avatar?.className).not.toContain("md:size-10");
  });

  it("lets className size fully override the default (header compact case)", () => {
    const { container } = render(
      <UserAvatarContent className="size-4 shrink-0" imageAlt="User" />,
    );
    const avatar = container.querySelector("[data-slot='avatar']");
    expect(avatar?.className).toContain("size-4");
    expect(avatar?.className).toContain("shrink-0");
    expect(avatar?.className).not.toContain("size-8");
    expect(avatar?.className).not.toContain("md:size-10");
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web test src/app/\(app\)/components/user-avatar/__tests__/user-avatar-content.test.tsx`

Expected: FAIL — default still has `md:size-10` and/or override still leaves `md:size-10` / fails `not.toContain("size-8")` depending on merge order.

- [x] **Step 3: Write minimal implementation**

In `user-avatar-content.tsx`, change:

```tsx
<Avatar className={cn("size-8 md:size-10", className)}>
```

to:

```tsx
<Avatar className={cn("size-8", className)}>
```

Leave image/fallback markup unchanged.

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm --filter web test src/app/\(app\)/components/user-avatar/__tests__/user-avatar-content.test.tsx`

Expected: PASS both cases.

- [x] **Step 5: Commit**

```bash
git add \
  apps/web/src/app/\(app\)/components/user-avatar/user-avatar-content.tsx \
  apps/web/src/app/\(app\)/components/user-avatar/__tests__/user-avatar-content.test.tsx
git commit -m "fix(web): respect UserAvatarContent size className override"
```

---

### Task 2: Confirm header closed switcher still passes compact size

**Files:**
- Read-only verify: `apps/web/src/app/(app)/components/header/header-workspace-switch.client.tsx` (trigger `HeaderWorkspaceAvatar` with `className="size-4 shrink-0"`)
- Read-only verify: `apps/web/src/app/(app)/components/header/header-workspace-avatar.tsx` (personal → `UserAvatarContent`, org → `Avatar` + className)

**Interfaces:**
- Consumes: fixed `UserAvatarContent` from Task 1
- Produces: no API change; personal path now actually `size-4` at `md+`

- [x] **Step 1: Grep closed-trigger sizing**

Confirm trigger still has:

```tsx
className="size-4 shrink-0"
logoSize={12}
```

and menu rows still use `size-6` / `logoSize={14}` (out of scope, must remain).

- [x] **Step 2: No code change unless trigger regressed**

If trigger lost `size-4`, restore it. Do not redesign grid.

- [x] **Step 3: Run related header tests**

Run: `pnpm --filter web test src/app/\(app\)/components/header/__tests__/header-profile-section.client.test.tsx`

Expected: PASS (mocks only; regression smoke).

- [x] **Step 4: Commit only if header files changed**

Otherwise skip commit.

---

## Spec coverage checklist

| Spec requirement | Task |
| --- | --- |
| Fix `UserAvatarContent` default / drop `md:size-10` | Task 1 |
| Caller `size-4` fully wins | Task 1 |
| Closed switcher stays compact for personal + org | Task 1 + 2 |
| Default remains `size-8` | Task 1 |
| Dropdown / bell / sidebar out of scope | Task 2 verify only |
| Unit test locks override | Task 1 |
