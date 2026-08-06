# Design: Instant Navigation for mobile tab bar destinations

**Date:** 2026-08-06  
**Status:** Approved (Approach 1)  
**Scope:** Enable Next.js Instant Navigations on the three mobile tab bar destinations only

## Problem

The mobile bottom tab bar (`ChatMobileBottomNav`) links to:

| Tab | Route |
| --- | --- |
| Home | `/chat` |
| Chats | `/chat/chats` |
| Search | `/history` |

Each of those pages currently exports `export const instant = false` with soft-nav intent: **keep the previous screen** until the target RSC finishes, with **no** Instant shell / route `loading.tsx`.

That makes tab switches feel sluggish on mobile: the selected tab may lag while the old page stays painted, and there is no route-shaped skeleton for the destination.

App shell infrastructure for Instant Nav already exists (`cacheComponents: true`, sync `(app)/layout` + `AppShellLoadingFrame`, passive providers for Suspense fallback chrome, `AppMobileChrome` in the loading frame). Other hub routes (e.g. tasks/agents) already use Instant + sync `loading.tsx` skeletons.

## Goal

- Tab taps Home / Chats / Search use **Instant Navigations**: shared app chrome (including the mobile tab bar when visible) stays up; **main content** shows a **route-shaped skeleton** until the page streams.
- Per-tab skeletons roughly match real layout (not a generic spinner).
- Skeletons and `loading.tsx` stay **fully sync** (no `cookies()`, `connection()`, session, or async `getTranslations()`).

## Non-goals

- Optimistic tab pending styles (`useLinkStatus` / pending classes) — optional polish later
- Instant only on mobile (Next Instant is **route-level**; desktop navigations to the same routes Instant too)
- Special Instant behavior for `/chat` draft query modes (`?dm=new`, `?create=channel`, `?welcome=1`)
- Changing tab destinations, tab registry, or hub list routes beyond these three pages
- Admin / auth / personal-assistant Instant opt-outs (stay `instant = false`)
- Room open loading (already Instant via `rooms/[roomId]/loading.tsx`)

## Decisions (from brainstorm)

1. **Scope:** Only the three tab destinations (not all routes that show the tab bar).
2. **Pending UX:** Sync route `loading.tsx` skeletons (tasks/agents pattern).
3. **Desktop:** Accept Instant on these routes everywhere; no soft-nav preserve on desktop for the same paths.
4. **Skeleton fidelity:** Per-tab layout-shaped skeletons (Home hub / chat list / history toolbar+rows).
5. **Approach:** Enable Instant + route `loading.tsx` only (no client fake Instant overlay).

## Approach (1 — enable Instant + route skeletons)

### 1. Remove soft-nav opt-out on tab destinations

Remove `export const instant = false` and soft-nav comments from:

- `apps/web/src/app/(app)/chat/page.tsx`
- `apps/web/src/app/(app)/chat/chats/page.tsx`
- `apps/web/src/app/(app)/history/page.tsx`

Pages keep existing dynamic work (`await connection()`, session, data loaders). Instant shell comes from the segment `loading.tsx`, not from making the page static.

### 2. Add sync `loading.tsx` per route

| File | Renders |
| --- | --- |
| `apps/web/src/app/(app)/chat/loading.tsx` | Home skeleton |
| `apps/web/src/app/(app)/chat/chats/loading.tsx` | Chats list skeleton |
| `apps/web/src/app/(app)/history/loading.tsx` | History skeleton |

Each `loading.tsx` is a thin default export that returns a colocated skeleton component (tasks pattern: `tasks/(root)/loading.tsx` → `TasksPageSkeleton`).

**Hard rule:** skeleton trees are sync only — no dynamic APIs, no i18n that suspends. Static English labels only if needed (same as `TASKS_LOADING_DEFAULT_LABELS`). Prefer pure `Skeleton` bones over copy when labels are not required for layout.

### 3. Per-tab skeleton shapes

#### Home (`/chat`)

Real page:

- `<md`: `MobileHomeHub` (sidebar leaf nav list)
- `md+`: desktop welcome (`ChatWelcomeClient` via `hidden md:contents`)

Skeleton:

- **Mobile (`md:hidden`):** vertical stack of ~6–8 nav-row bones (icon circle + label bar); optional top personal-assistant row bone. Not a chat transcript.
- **Desktop (`hidden md:block`):** centered welcome block — title bar, short subtitle, wide composer/input bone, 2–3 suggestion chip bones.

Mirror the page’s responsive visibility so Instant swap does not flash the wrong surface.

#### Chats (`/chat/chats`)

Real page: `md:hidden` organization chat list (`OrganizationChatList`).

Skeleton:

- Same outer wrapper classes as the page (`-m-4 min-h-0 flex-1 overflow-y-auto` + `md:hidden`)
- ~6–8 list rows: avatar circle + two text bars (title + subtitle)
- Optional cheap section header bones (Channels / DMs)

No meaningful desktop body (matches real page).

#### Search (`/history`)

Real page: `HistoryToolbar` + `HistoryList` in `w-full px-2` column.

Skeleton:

- Toolbar: search field bone + filter control bones
- ~5–6 list rows: type/icon bone + title + meta line
- Outer shell matching page spacing (`gap-6`, `pb-6`)

### 4. Implementation layout (suggested)

Colocate skeleton views next to features; keep `loading.tsx` thin:

```
apps/web/src/app/(app)/chat/loading.tsx
apps/web/src/app/(app)/chat/components/chat-home-loading-view.tsx
apps/web/src/app/(app)/chat/chats/loading.tsx
apps/web/src/app/(app)/chat/components/chat-chats-loading-view.tsx   # or under chats/
apps/web/src/app/(app)/history/loading.tsx
apps/web/src/app/(app)/history/components/history-loading-view.tsx
```

Exact file names may follow existing feature conventions during implementation; behavior above is normative.

### 5. Unchanged

- `ChatMobileBottomNav` / `CHAT_MOBILE_TABS` / `AppMobileChrome` (plain `next/link` stays)
- `(app)/layout.tsx` Instant Suspense + `AppShellLoadingFrame`
- Room Instant path (`chat/rooms/[roomId]/loading.tsx`)
- Other `instant = false` routes (auth, admin, personal-assistant)

### 6. Comment hygiene

- Update page comments that claim soft-nav / no `loading.tsx`.
- Update `chat/rooms/[roomId]/loading.tsx` comment that states Home/Chats have no segment loading.

## Architecture flow

```
Tab Link (or any nav) → Instant Nav for destination route
  → existing Instant-safe (app) shell (sidebar/header/mobile chrome)
  → route loading.tsx (sync skeleton)     ← NEW
  → page.tsx streams after connection + data
```

```
Tab destinations
├── /chat          instant default ON + chat/loading.tsx
├── /chat/chats    instant default ON + chat/chats/loading.tsx
└── /history       instant default ON + history/loading.tsx
```

## Testing

### Automated

1. **Unit/RTL:** each skeleton view renders without throw; assert structure (e.g. `data-testid` or stable layout markers for mobile vs desktop home skeleton).
2. **Contract (cheap):** source tests that the three pages no longer contain `export const instant = false` (same spirit as existing Instant/sidebar contract tests).
3. No new e2e required for v1.

### Manual

1. Mobile viewport: Home ↔ Chats ↔ Search — skeleton then content; tab bar remains mounted.
2. Desktop: navigate to `/chat` and `/history` — skeleton appears (soft-nav freeze gone).
3. Open a chat room — existing room loading still applies.
4. Draft flow `?dm=new` from Home — brief Home skeleton is acceptable.

## Error handling

- Page failures use existing boundaries (`ChatRouteErrorBoundary` for chat segment; app-level for history).
- Skeletons must never throw and must not depend on auth/notification contexts beyond what the app shell already provides.
- If Instant validation fails at build, fix the skeleton (dynamic API leakage) or keep page deferral via `connection()` (already present).

## Success criteria

| Case | Expected |
| --- | --- |
| Tap Chats on mobile | Instant shell + chats list skeleton, then room list |
| Tap Search on mobile | Instant shell + history skeleton, then toolbar + list |
| Tap Home on mobile | Instant shell + home hub skeleton, then `MobileHomeHub` |
| Desktop nav to `/history` | Skeleton (not previous-page soft-nav) |
| Room open | Unchanged room loading spinner |
| Admin / auth | Still opt out of Instant |
| `loading.tsx` trees | No cookies/connection/session/async i18n |

## Risks

| Risk | Mitigation |
| --- | --- |
| Soft-nav was intentional; skeleton flash feels worse on fast desktop nav | Accepted product trade; skeletons should be light |
| `/chat` draft queries share Home `loading.tsx` | Accept brief Home skeleton before draft UI |
| `/chat/chats` empty on desktop | Rare; page already `md:hidden` |
| Instant validation fails if loading tree is dynamic | Keep skeletons sync; follow tasks loading pattern |
| Active tab highlight lag | Pathname-driven active state is enough for v1; `useLinkStatus` later |

## Out of scope follow-ups

- `useLinkStatus` pending styles on tab links
- Instant for other main hub list roots only as separate work if still soft
- i18n-accurate skeleton labels
- Browser e2e proof via verify-sokosumi
