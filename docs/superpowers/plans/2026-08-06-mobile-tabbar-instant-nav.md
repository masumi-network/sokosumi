# Mobile Tab Bar Instant Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable Next.js Instant Navigations on the three mobile tab bar destinations (`/chat`, `/chat/chats`, `/history`) with per-route sync skeleton `loading.tsx` files that roughly match each surface.

**Architecture:** Remove `export const instant = false` from the three tab destination pages so Instant defaults on. Add thin sync `loading.tsx` per segment that renders a colocated skeleton view (tasks/agents pattern). Skeletons use only `Skeleton` + static markup — no `cookies()`, `connection()`, session, or async i18n. App chrome (including `AppMobileChrome` tab bar) is already Instant-safe and is not modified.

**Tech Stack:** Next.js App Router Cache Components (`cacheComponents: true`), React Server Components, Tailwind, shadcn `Skeleton`, Vitest + Testing Library, Biome.

**Spec:** `docs/superpowers/specs/2026-08-06-mobile-tabbar-instant-nav-design.md`

## Global Constraints

- Only three routes change Instant behavior: `/chat`, `/chat/chats`, `/history`
- `loading.tsx` and skeleton views must be **fully sync** (no cookies/connection/session/getTranslations)
- Prefer pure `Skeleton` bones over i18n copy; static English only if a label is required for layout
- Do not add `useLinkStatus` pending tab styles (out of scope)
- Do not change `CHAT_MOBILE_TABS`, `ChatMobileBottomNav`, or `AppMobileChrome` behavior
- Leave `instant = false` on auth, admin, personal-assistant
- Leave room loading at `chat/rooms/[roomId]/loading.tsx` (update comment only)
- Conventional Commits; run targeted Vitest; Biome via precommit or `pnpm check` on touched paths
- No new npm dependencies; no Core API / schema changes

## File map

| File | Responsibility |
| --- | --- |
| `apps/web/src/app/(app)/chat/components/chat-home-loading-view.tsx` | Sync Home skeleton (mobile hub + desktop welcome bones) |
| `apps/web/src/app/(app)/chat/loading.tsx` | Segment loading: render `ChatHomePageSkeleton` |
| `apps/web/src/app/(app)/chat/components/__tests__/chat-home-loading-view.test.tsx` | RTL structure tests for Home skeleton |
| `apps/web/src/app/(app)/chat/page.tsx` | Remove `export const instant = false` + soft-nav comments |
| `apps/web/src/app/(app)/chat/components/chat-chats-loading-view.tsx` | Sync Chats list skeleton (`md:hidden`) |
| `apps/web/src/app/(app)/chat/chats/loading.tsx` | Segment loading: render `ChatChatsPageSkeleton` |
| `apps/web/src/app/(app)/chat/components/__tests__/chat-chats-loading-view.test.tsx` | RTL structure tests for Chats skeleton |
| `apps/web/src/app/(app)/chat/chats/page.tsx` | Remove `export const instant = false` + soft-nav comments |
| `apps/web/src/app/(app)/history/components/history-loading-view.tsx` | Sync History toolbar + list skeleton |
| `apps/web/src/app/(app)/history/loading.tsx` | Segment loading: render `HistoryPageSkeleton` |
| `apps/web/src/app/(app)/history/components/__tests__/history-loading-view.test.tsx` | RTL structure tests for History skeleton |
| `apps/web/src/app/(app)/history/page.tsx` | Remove `export const instant = false` + soft-nav comments |
| `apps/web/src/app/(app)/chat/__tests__/tab-destinations-instant-contract.test.ts` | Source contract: pages no longer set `instant = false` |
| `apps/web/src/app/(app)/chat/rooms/[roomId]/loading.tsx` | Comment hygiene only |

---

### Task 1: Home skeleton + Instant enable

**Files:**
- Create: `apps/web/src/app/(app)/chat/components/chat-home-loading-view.tsx`
- Create: `apps/web/src/app/(app)/chat/loading.tsx`
- Create: `apps/web/src/app/(app)/chat/components/__tests__/chat-home-loading-view.test.tsx`
- Modify: `apps/web/src/app/(app)/chat/page.tsx` (remove `export const instant = false` and soft-nav comment block)

**Interfaces:**
- Produces:
  - `export function ChatHomePageSkeleton(): React.ReactElement` — sync skeleton matching Home page responsive split
  - `apps/web/src/app/(app)/chat/loading.tsx` default export returns `<ChatHomePageSkeleton />`
- Consumes: `@/components/ui/skeleton` (`Skeleton`), `cn` only if needed

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/app/(app)/chat/components/__tests__/chat-home-loading-view.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ChatHomePageSkeleton } from "../chat-home-loading-view";

describe("ChatHomePageSkeleton", () => {
  it("renders mobile hub and desktop welcome skeleton regions", () => {
    render(<ChatHomePageSkeleton />);

    expect(screen.getByTestId("chat-home-loading-mobile")).toBeTruthy();
    expect(screen.getByTestId("chat-home-loading-desktop")).toBeTruthy();
  });

  it("uses pulse skeleton bones (no async APIs)", () => {
    const { container } = render(<ChatHomePageSkeleton />);
    const bones = container.querySelectorAll('[data-slot="skeleton"]');
    expect(bones.length).toBeGreaterThanOrEqual(6);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter web test src/app/\(app\)/chat/components/__tests__/chat-home-loading-view.test.tsx
```

Expected: FAIL — module `../chat-home-loading-view` not found (or export missing).

- [ ] **Step 3: Implement skeleton + loading.tsx**

Create `apps/web/src/app/(app)/chat/components/chat-home-loading-view.tsx`:

```tsx
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Sync Instant Nav shell for `/chat` (no cookies/`connection()`/i18n).
 * Mirrors page split: mobile Home hub list + desktop welcome.
 */
export function ChatHomePageSkeleton(): React.ReactElement {
  return (
    <>
      <div
        data-testid="chat-home-loading-mobile"
        className="-m-4 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto bg-background p-4 md:hidden"
      >
        {Array.from({ length: 8 }, (_, index) => (
          <div key={index} className="flex items-center gap-3 py-2">
            <Skeleton className="size-5 shrink-0 rounded-md" />
            <Skeleton className="h-4 w-32" />
          </div>
        ))}
      </div>
      <div
        data-testid="chat-home-loading-desktop"
        className="mx-auto hidden w-full max-w-2xl flex-col items-center gap-6 px-4 py-12 md:flex"
      >
        <div className="flex w-full flex-col items-center gap-2">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-72" />
        </div>
        <Skeleton className="h-12 w-full max-w-xl rounded-xl" />
        <div className="flex flex-wrap justify-center gap-2">
          <Skeleton className="h-8 w-28 rounded-full" />
          <Skeleton className="h-8 w-24 rounded-full" />
          <Skeleton className="h-8 w-32 rounded-full" />
        </div>
      </div>
    </>
  );
}
```

Create `apps/web/src/app/(app)/chat/loading.tsx`:

```tsx
import { ChatHomePageSkeleton } from "@/app/chat/components/chat-home-loading-view";

/** Sync shell only — no cookies/`connection()` (Instant Nav). */
export default function ChatHomeLoading() {
  return <ChatHomePageSkeleton />;
}
```

- [ ] **Step 4: Enable Instant on `/chat` page**

In `apps/web/src/app/(app)/chat/page.tsx`:

1. Delete the block:

```ts
/**
 * Soft-nav: keep previous screen (no Instant shell / route spinner).
 * Rooms still use Instant via `rooms/[roomId]`.
 */
export const instant = false;
```

2. Update the page JSDoc so it no longer claims soft-nav / no route `loading.tsx`. Example replacement for the async page description:

```ts
/**
 * `/chat` landing: mobile Home hub (sidebar minus Channels/DMs); desktop
 * classic coworker welcome. Draft modes via query: `?create=channel`,
 * `?dm=new`, `?welcome=1` (mobile coworker compose). Open rooms:
 * `/chat/rooms/[roomId]`.
 *
 * Instant Nav uses `chat/loading.tsx` while this page streams after
 * `connection()`. Room open uses `rooms/[roomId]/loading.tsx`.
 */
```

Keep `await connection()` and all data-loading logic unchanged.

- [ ] **Step 5: Run tests to verify they pass**

```bash
pnpm --filter web test src/app/\(app\)/chat/components/__tests__/chat-home-loading-view.test.tsx
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add \
  apps/web/src/app/\(app\)/chat/components/chat-home-loading-view.tsx \
  apps/web/src/app/\(app\)/chat/components/__tests__/chat-home-loading-view.test.tsx \
  apps/web/src/app/\(app\)/chat/loading.tsx \
  apps/web/src/app/\(app\)/chat/page.tsx
git commit -m "$(cat <<'EOF'
feat(web): Instant Nav skeleton for chat Home tab

Enable Instant Navigations on /chat with a sync loading shell that
mirrors mobile hub and desktop welcome layouts.
EOF
)"
```

---

### Task 2: Chats list skeleton + Instant enable

**Files:**
- Create: `apps/web/src/app/(app)/chat/components/chat-chats-loading-view.tsx`
- Create: `apps/web/src/app/(app)/chat/chats/loading.tsx`
- Create: `apps/web/src/app/(app)/chat/components/__tests__/chat-chats-loading-view.test.tsx`
- Modify: `apps/web/src/app/(app)/chat/chats/page.tsx` (remove `export const instant = false` + soft-nav comments)

**Interfaces:**
- Produces:
  - `export function ChatChatsPageSkeleton(): React.ReactElement`
  - `chat/chats/loading.tsx` default export → `<ChatChatsPageSkeleton />`
- Consumes: `@/components/ui/skeleton`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/app/(app)/chat/components/__tests__/chat-chats-loading-view.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ChatChatsPageSkeleton } from "../chat-chats-loading-view";

describe("ChatChatsPageSkeleton", () => {
  it("renders mobile-only chats list skeleton", () => {
    render(<ChatChatsPageSkeleton />);

    const root = screen.getByTestId("chat-chats-loading");
    expect(root.className).toMatch(/md:hidden/);
  });

  it("renders multiple list row bones", () => {
    const { container } = render(<ChatChatsPageSkeleton />);
    const bones = container.querySelectorAll('[data-slot="skeleton"]');
    expect(bones.length).toBeGreaterThanOrEqual(8);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter web test src/app/\(app\)/chat/components/__tests__/chat-chats-loading-view.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement skeleton + loading.tsx**

Create `apps/web/src/app/(app)/chat/components/chat-chats-loading-view.tsx`:

```tsx
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Sync Instant Nav shell for `/chat/chats` (no cookies/`connection()`/i18n).
 * Matches mobile-only OrganizationChatList page wrapper.
 */
export function ChatChatsPageSkeleton(): React.ReactElement {
  return (
    <div
      data-testid="chat-chats-loading"
      className="md:hidden -m-4 min-h-0 flex-1 overflow-y-auto p-4"
    >
      <div className="mb-3 flex items-center justify-between">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-5 w-16" />
      </div>
      <ul className="flex flex-col gap-3">
        {Array.from({ length: 7 }, (_, index) => (
          <li key={index} className="flex items-center gap-3">
            <Skeleton className="size-10 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-4 w-2/3 max-w-[12rem]" />
              <Skeleton className="h-3 w-full max-w-[16rem]" />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

Note: avoid invalid Tailwind like `w-2/3` if Biome/build rejects it — use `w-[66%]` or `w-40` instead if needed. Prefer `w-40` / `w-52` static widths.

Safer row title/subtitle classes:

```tsx
<Skeleton className="h-4 w-40" />
<Skeleton className="h-3 w-52" />
```

Create `apps/web/src/app/(app)/chat/chats/loading.tsx`:

```tsx
import { ChatChatsPageSkeleton } from "@/app/chat/components/chat-chats-loading-view";

/** Sync shell only — no cookies/`connection()` (Instant Nav). */
export default function ChatChatsLoading() {
  return <ChatChatsPageSkeleton />;
}
```

- [ ] **Step 4: Enable Instant on `/chat/chats` page**

In `apps/web/src/app/(app)/chat/chats/page.tsx`:

1. Delete:

```ts
/**
 * Soft-nav: keep previous screen (no Instant shell / route spinner).
 */
export const instant = false;
```

2. Update the page JSDoc to mention Instant + `chats/loading.tsx` instead of soft-nav / no spinner. Keep all data-loading logic and `await connection()` unchanged.

- [ ] **Step 5: Run tests to verify they pass**

```bash
pnpm --filter web test src/app/\(app\)/chat/components/__tests__/chat-chats-loading-view.test.tsx
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add \
  apps/web/src/app/\(app\)/chat/components/chat-chats-loading-view.tsx \
  apps/web/src/app/\(app\)/chat/components/__tests__/chat-chats-loading-view.test.tsx \
  apps/web/src/app/\(app\)/chat/chats/loading.tsx \
  apps/web/src/app/\(app\)/chat/chats/page.tsx
git commit -m "$(cat <<'EOF'
feat(web): Instant Nav skeleton for Chats tab

Enable Instant Navigations on /chat/chats with a mobile list-shaped
sync loading shell.
EOF
)"
```

---

### Task 3: History (Search) skeleton + Instant enable

**Files:**
- Create: `apps/web/src/app/(app)/history/components/history-loading-view.tsx`
- Create: `apps/web/src/app/(app)/history/loading.tsx`
- Create: `apps/web/src/app/(app)/history/components/__tests__/history-loading-view.test.tsx`
- Modify: `apps/web/src/app/(app)/history/page.tsx` (remove `export const instant = false` + soft-nav comments)

**Interfaces:**
- Produces:
  - `export function HistoryPageSkeleton(): React.ReactElement`
  - `history/loading.tsx` default export → `<HistoryPageSkeleton />`
- Consumes: `@/components/ui/skeleton`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/app/(app)/history/components/__tests__/history-loading-view.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { HistoryPageSkeleton } from "../history-loading-view";

describe("HistoryPageSkeleton", () => {
  it("renders toolbar and list skeleton regions", () => {
    render(<HistoryPageSkeleton />);

    expect(screen.getByTestId("history-loading-toolbar")).toBeTruthy();
    expect(screen.getByTestId("history-loading-list")).toBeTruthy();
  });

  it("renders multiple skeleton bones", () => {
    const { container } = render(<HistoryPageSkeleton />);
    const bones = container.querySelectorAll('[data-slot="skeleton"]');
    expect(bones.length).toBeGreaterThanOrEqual(8);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter web test src/app/\(app\)/history/components/__tests__/history-loading-view.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement skeleton + loading.tsx**

Create `apps/web/src/app/(app)/history/components/history-loading-view.tsx`:

```tsx
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Sync Instant Nav shell for `/history` (no cookies/`connection()`/i18n).
 * Mirrors toolbar + list layout of the Search tab destination.
 */
export function HistoryPageSkeleton(): React.ReactElement {
  return (
    <div className="w-full px-2">
      <div className="mx-auto flex w-full flex-col gap-6 pb-6">
        <div
          data-testid="history-loading-toolbar"
          className="flex items-center gap-2 sm:gap-3"
        >
          <Skeleton className="h-10 min-w-0 flex-1 rounded-md" />
          <Skeleton className="size-10 shrink-0 rounded-md" />
        </div>
        <ul data-testid="history-loading-list" className="flex flex-col gap-3">
          {Array.from({ length: 6 }, (_, index) => (
            <li
              key={index}
              className="flex items-start gap-3 rounded-lg border border-border/40 p-3"
            >
              <Skeleton className="size-8 shrink-0 rounded-md" />
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-3 w-full max-w-md" />
                <Skeleton className="h-3 w-24" />
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
```

Create `apps/web/src/app/(app)/history/loading.tsx`:

```tsx
import { HistoryPageSkeleton } from "@/app/history/components/history-loading-view";

/** Sync shell only — no cookies/`connection()` (Instant Nav). */
export default function HistoryLoading() {
  return <HistoryPageSkeleton />;
}
```

- [ ] **Step 4: Enable Instant on `/history` page**

In `apps/web/src/app/(app)/history/page.tsx`:

1. Delete:

```ts
/**
 * Soft-nav: keep previous screen (no Instant shell / route spinner).
 */
export const instant = false;
```

2. Optionally add a one-line note near the top of the page default export JSDoc that Instant uses `history/loading.tsx` while the page streams after `connection()`. Keep `generateMetadata`, filters, and data loading unchanged.

- [ ] **Step 5: Run tests to verify they pass**

```bash
pnpm --filter web test src/app/\(app\)/history/components/__tests__/history-loading-view.test.tsx
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add \
  apps/web/src/app/\(app\)/history/components/history-loading-view.tsx \
  apps/web/src/app/\(app\)/history/components/__tests__/history-loading-view.test.tsx \
  apps/web/src/app/\(app\)/history/loading.tsx \
  apps/web/src/app/\(app\)/history/page.tsx
git commit -m "$(cat <<'EOF'
feat(web): Instant Nav skeleton for Search/history tab

Enable Instant Navigations on /history with a toolbar + list shaped
sync loading shell.
EOF
)"
```

---

### Task 4: Instant contract + room loading comment + verify

**Files:**
- Create: `apps/web/src/app/(app)/chat/__tests__/tab-destinations-instant-contract.test.ts`
- Modify: `apps/web/src/app/(app)/chat/rooms/[roomId]/loading.tsx` (comment only)

**Interfaces:**
- Produces: source contract tests asserting tab destination pages do not export `instant = false`, and that each segment has a `loading.tsx` that imports the matching skeleton
- Consumes: Node `fs` / `path` (same pattern as `private-cached-app-sidebar-contract.test.ts`)

- [ ] **Step 1: Write the failing contract test (or write after Tasks 1–3 so it passes first run)**

Create `apps/web/src/app/(app)/chat/__tests__/tab-destinations-instant-contract.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const appDir = join(here, "../..");

function readApp(rel: string): string {
  return readFileSync(join(appDir, rel), "utf8");
}

describe("mobile tab destinations Instant Nav contract", () => {
  const pages = [
    "chat/page.tsx",
    "chat/chats/page.tsx",
    "history/page.tsx",
  ] as const;

  for (const rel of pages) {
    it(`${rel} does not soft-nav opt out of Instant`, () => {
      const source = readApp(rel);
      expect(source).not.toMatch(/export\s+const\s+instant\s*=\s*false/);
    });
  }

  it("chat/loading.tsx renders ChatHomePageSkeleton", () => {
    const source = readApp("chat/loading.tsx");
    expect(source).toMatch(/ChatHomePageSkeleton/);
  });

  it("chat/chats/loading.tsx renders ChatChatsPageSkeleton", () => {
    const source = readApp("chat/chats/loading.tsx");
    expect(source).toMatch(/ChatChatsPageSkeleton/);
  });

  it("history/loading.tsx renders HistoryPageSkeleton", () => {
    const source = readApp("history/loading.tsx");
    expect(source).toMatch(/HistoryPageSkeleton/);
  });
});
```

If Tasks 1–3 are done, this should pass immediately. If run earlier, page assertions fail until Instant is enabled.

- [ ] **Step 2: Run contract test**

```bash
pnpm --filter web test src/app/\(app\)/chat/__tests__/tab-destinations-instant-contract.test.ts
```

Expected: PASS (after Tasks 1–3)

- [ ] **Step 3: Update room loading comment**

In `apps/web/src/app/(app)/chat/rooms/[roomId]/loading.tsx`, replace the outdated soft-nav comment with:

```tsx
/**
 * Spinner when opening a room. Home/Chats/Search tab destinations use their
 * own segment `loading.tsx` skeletons under Instant Nav. Room open remains
 * a heavier navigation that uses this spinner shell.
 */
```

- [ ] **Step 4: Run full related test batch**

```bash
pnpm --filter web test \
  src/app/\(app\)/chat/components/__tests__/chat-home-loading-view.test.tsx \
  src/app/\(app\)/chat/components/__tests__/chat-chats-loading-view.test.tsx \
  src/app/\(app\)/history/components/__tests__/history-loading-view.test.tsx \
  src/app/\(app\)/chat/__tests__/tab-destinations-instant-contract.test.ts
```

Expected: all PASS

- [ ] **Step 5: Lint/format touched web files (optional if husky covers commit)**

```bash
pnpm --filter web exec biome check --write \
  src/app/\(app\)/chat/loading.tsx \
  src/app/\(app\)/chat/page.tsx \
  src/app/\(app\)/chat/components/chat-home-loading-view.tsx \
  src/app/\(app\)/chat/components/chat-chats-loading-view.tsx \
  src/app/\(app\)/chat/components/__tests__/chat-home-loading-view.test.tsx \
  src/app/\(app\)/chat/components/__tests__/chat-chats-loading-view.test.tsx \
  src/app/\(app\)/chat/chats/loading.tsx \
  src/app/\(app\)/chat/chats/page.tsx \
  src/app/\(app\)/chat/rooms/\[roomId\]/loading.tsx \
  src/app/\(app\)/chat/__tests__/tab-destinations-instant-contract.test.ts \
  src/app/\(app\)/history/loading.tsx \
  src/app/\(app\)/history/page.tsx \
  src/app/\(app\)/history/components/history-loading-view.tsx \
  src/app/\(app\)/history/components/__tests__/history-loading-view.test.tsx
```

- [ ] **Step 6: Commit**

```bash
git add \
  apps/web/src/app/\(app\)/chat/__tests__/tab-destinations-instant-contract.test.ts \
  apps/web/src/app/\(app\)/chat/rooms/\[roomId\]/loading.tsx
git commit -m "$(cat <<'EOF'
test(web): contract Instant Nav for mobile tab destinations

Lock Home/Chats/Search pages against reintroducing instant=false and
refresh room loading comment for tab segment skeletons.
EOF
)"
```

- [ ] **Step 7: Manual smoke (when local web is available)**

1. Mobile viewport: Home ↔ Chats ↔ Search — skeleton then content; tab bar stays.
2. Desktop: navigate to `/chat` and `/history` — skeleton (no soft-nav freeze).
3. Open a room — room spinner still shows.
4. Confirm auth/admin/Hermes still soft-nav (`instant = false` unchanged).

---

## Spec coverage checklist

| Spec requirement | Task |
| --- | --- |
| Remove `instant = false` on `/chat` | Task 1 |
| Remove `instant = false` on `/chat/chats` | Task 2 |
| Remove `instant = false` on `/history` | Task 3 |
| Sync `chat/loading.tsx` Home skeleton (mobile + desktop) | Task 1 |
| Sync `chat/chats/loading.tsx` list skeleton `md:hidden` | Task 2 |
| Sync `history/loading.tsx` toolbar + list | Task 3 |
| Skeleton unit tests | Tasks 1–3 |
| Contract: no reintroduced soft-nav opt-out | Task 4 |
| Room loading comment hygiene | Task 4 |
| No changes to tab bar Links / AppMobileChrome | (none — out of file map) |
| Auth/admin/Hermes stay opted out | (none — not touched) |

## Self-review notes

- No TBD/TODO placeholders in tasks.
- Component names consistent across loading.tsx imports and contract tests: `ChatHomePageSkeleton`, `ChatChatsPageSkeleton`, `HistoryPageSkeleton`.
- Avoid invalid Tailwind fraction widths in Chats skeleton (`w-40` / `w-52` preferred).
- TDD order: failing test → implement → pass → commit per task.
