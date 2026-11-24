# Sidebar chat room collection owners

- Status: Accepted
- Date: 2026-11-24

The chat sidebar's room collections stay outside React Query: each mounted chat list owns its active, archived, and invitation rows in a per-mount store, non-list surfaces read active rooms from one layout-mounted reader, and Elsewhere keeps its shared React Query cache.

**Why:** putting the three sidebar collections in React Query (#8012) or rewriting main's rules as a reducer (`prototype/sidebar-rooms-store`) repeatedly drifted from main on workspace-switch abort order, 429 cadence, and Elsewhere coalescing. Moving main's tested logic intact into a plain scheduler factory (#8032), a per-mount chat list store (#8034), and one layout-mounted live-rooms reader (#8041) gave us unit-testable stores, eliminated duplicate reader requests across non-list surfaces, and cleared the sidebar files from the Web effect baseline ([ADR 0075](0075-effects-live-only-in-named-hooks.md)) without rewriting the rules.

## Decisions

- **Active rooms have two React-owned owners with main's tested handoff.**
  - **Layout reader (`LiveChatRoomsProvider`, #8041):** mounted once in the authenticated app chrome (`AuthenticatedAppFrame` and `AppShellLoadingFrame`, the same pattern as `OtherWorkspaceRoomsLive` for Elsewhere). Non-list surfaces (Chats tab unread dot, Go-to search, Threads, Decisions, Saved messages) read `{ rooms, failed }` from context instead of each running its own scheduler and listeners.
  - **Per-mount chat list store (`createChatListStore` via `useOrganizationChatRooms`, #8034):** created and disposed with each mounted sidebar or mobile `/chat` list (keyed by user and workspace).
  - **Handoff kept as a known, accepted cost:** when a list is mounted, it wins and publishes its rows through `useMembershipVisibleRoomsPublisher`; the layout reader watches the publisher count in `membership-visible-rooms-store.ts`, keeps the 2 s desktop wait (`useLiveChatRoomsOwnershipSettled`), and mirrors published rows.
- **Archived rooms and invitations live in the per-mount chat list store.** They have one consumer (the list) and keep their per-mount lifetime: store state is created fresh on each mount (across a mobile sheet close or workspace switch), while `useSidebarChatListDeferred` caches settled archived-room seed promises by promise identity so reopening a sheet with the same server promise starts with the settled rows instead of an empty flash.
- **Elsewhere stays in React Query (`chatQueryKeys`) with its one live component (`OtherWorkspaceRoomsLive`).** It already has a single owner and relies on React Query's per-workspace entries and placeholder behaviour.
- **Owners are React-owned instances, never module state.** Two earlier attempts at sharing the live-rooms reader in module state (#8035, #8039) hit multi-instance attach/detach, React Activity hide/reveal, and per-surface health-history regressions. Lifting one React instance into the app layout avoids that class of bugs entirely.
- **Read drivers stay per owner.** The list store drives one-room reads (within a 60 s whole-list window) and RSC seeds; the layout reader drives whole-list reads, session scope, and the 2 s desktop wait. In steady state only one driver runs at a time (except when two lists are mounted simultaneously, such as the phone `/chat` page and an open sheet); during handoff on desktop, a provider GET that started after the 2 s wait can still be in flight when a late list mounts and starts its own batch — the handoff stops further provider scheduling and fences late answers, rather than aborting the in-flight request.
- **The session snapshot module (`membership-visible-rooms-store.ts`) stays.** It remains the published output for instant `/chat` paint, provisional room chrome, Channel links in the open room, and the list's first-rows rule.
- **The control channel bridge (`ChatControlListBridge`), window events (`organization-chat-events.ts`), and direct server-action writes stay.** Writes (invitation accept/decline, failed Pin reorder) continue calling their server actions directly rather than routing through the refresh scheduler.
- **Built by moving main's code.** Every rule change requires its own PR and its own test. Shipped behaviour changes across the move:
  - **01 Scheduler factory (#8032):** none.
  - **02 Per-mount chat list store (#8034):** two named exceptions — (1) new RSC rows reach the store in a layout effect (before paint) rather than during render, and (2) `refreshActive` and `requestCollections` read current store rows immediately instead of a one-render-behind ref.
  - **03 Layout live-rooms reader (#8041):** D1 — one reader instance per app page reduces mount and timer reads across N non-list callers from N to 1; D2 — a caller that mounts later gets the current rows immediately with no extra read; D3 — a caller hidden in React Activity no longer stops its own reader because the layout instance stays mounted.

## Considered options

- **React Query for active, archived, and invitations (#8012).** Rejected: mismatched the sidebar's revision counters, one-room reads, 429 throttle clock, and instant snapshot seeding.
- **Reducer rewrite (`prototype/sidebar-rooms-store`).** Rejected: five review rounds kept uncovering behaviour drift from main.
- **Active rows in module state (#8035) or a scheduler shared across surface instances (#8039).** Rejected: both closed unmerged after multi-instance lifecycle and React Activity corner cases.
- **Single active owner in the layout deleting the list/reader handoff (skipped ticket 04).** Rejected for now: after #8041 it offered no user-visible gain while carrying 10 named behaviour changes and similar ownership-transition risk to #8035/#8039. The detailed plan is kept only as scratch notes.

## Consequences

- Active rooms keep the publisher/count/mirror/2 s-wait handoff between `LiveChatRoomsProvider` and mounted `OrganizationChatList` instances.
- All sidebar room-list files are out of `apps/web/effect-baseline.json`; `useChatRefreshScheduler` lives in `apps/web/src/hooks/effects/` as a shared hook and `useSidebarChatListDeferred` lives beside it as a single-site hook.
- **Next direction:** data-carrying realtime events were evaluated on 2026-11-24 and deferred. Core stores no unread counters — every sidebar unread field is computed per viewer (~11–12 queries per member, one user per query), so publishing a per-member row patch on every message would scale with all members (including offline ones), whereas today's one-room reads scale only with online tabs. Mention and needs-you counts also land after the first publish (second publish in `chat-notification-fanout`, `announceTagged`), so a correct patch would require re-sends; meanwhile the client still needs its read paths for reconnects, missed events, and throttling, so little client code would go for ~1 round trip of freshness when healthy. Revisit if chat read load or 429s become a real problem; the right shape then is unread SQL that takes many users at once and is shared with the list `GET`, so patches and list reads cannot drift. A smaller candidate if a stale unread dot in another tab is reported: an id-only `chat_rooms_changed` event to the reader's own control channel on mark-read.
