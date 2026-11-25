# Chat Feed slice 1: implementation plan

- Design: [chat-feed-design.md](./chat-feed-design.md), approved 2026-11-25.
- Slice 1 is a read-only Feed. It has no reply, no Done action, no Urgent lane and no live refetch.
- One PR. Four commits, one concern each, in this order. Each commit must pass the pre-commit hook (`pnpm check && pnpm typecheck`) alone.
- Two read-only planning agents traced the seams below on 2026-11-25. Their file:line citations are REPORTED. I checked the Prisma, signal and mention models myself (VERIFIED).

## Commit 1: `feat(database): add user feedMode preference`

1. `packages/database/prisma/user.prisma`: add `feedMode Boolean @default(false)` beside `hideRoomUnreadCount` (`:58`).
2. Migration `user_feed_mode`: `ALTER TABLE "user" ADD COLUMN "feedMode" BOOLEAN NOT NULL DEFAULT false;`. Its folder stamp must be newer than the current tip. Run Prisma migrate with an explicit `DATABASE_URL`.
3. `packages/utils/src/better-auth-client-schema.ts`: add `feedMode` (boolean, not required, default false). `packages/utils/src/better-auth-types.ts`: add `feedMode?: boolean | null`. Update the parity fixture in `__tests__/better-auth-session-user-parity.test.ts`.

The column and the Better Auth field ship in the same Core release. Better Auth fails at sign-in when it declares a column that does not exist. `vercel-build` migrates before the new deployment takes traffic.

## Commit 2: `feat(core): add chat feed read endpoint`

1. **Preferences.**
   - `preferences-select.ts`: add `feedMode` to the select, the row type and the response mapper.
   - `patch.ts`: accept `feedMode: z.boolean().optional()`, and add it to the "at least one field" check.
   - `user.schema.ts`: add `feedMode: z.boolean().default(false)`. The default keeps the field out of the OpenAPI `required` list, so shipped Apple builds still decode the response.
2. **Shared SQL.** In `chat-signal-views.service.ts`, export the existing helpers `placeholders`, `sqlReadJoins`, `sqlUnreadForViewer`, `sqlNeedsViewer`, `readerRooms` and `loadListedMessages`. Change nothing else in that file. `sqlNeedsViewer` already applies reader corrections. It does not check `state`, so the caller adds `s.state = 'tagged'`.
3. **New `apps/core/src/services/chat-feed.service.ts`.**
   - `listChatFeed(userId, organizationId, { cursor, take })` returns `{ items, nextCursor, unreadCount }`.
   - The candidate rule: a message in `readerRooms`, not deleted, not sent by the viewer, and one of these:
     - it is in a Direct room and a person sent it (`senderUserId IS NOT NULL`);
     - a `chat_room_user_mention` row names the viewer;
     - it is tagged, with the viewer in `addressedUserIds` and a needs-you tag;
     - it is an agent's answer to a human message: a `chat_room_mention` row has this message as `responseMessageId`, and the row's source message was sent by the viewer or mentions the viewer.
   - A test case covers each branch, including an agent reply in a 1:1 agent Direct that stays out.
   - Order by `createdAt DESC, id DESC`. The cursor is a message id. An unknown cursor returns 422.
   - No `COUNT(*) OVER ()` per page. The unread count is one separate query with `sqlReadJoins` and `sqlUnreadForViewer`.
4. **Schema.** In `chat-signal.schema.ts`, export `chatSignalRoomSchema`. Add `chatFeedItemSchema` (`lane`, `room`, `message`) and `chatFeedSchema` (`items`, `unreadCount`). `lane` declares `["feed", "urgent"]` now, so slice 3 does not widen a response enum. Slice 1 only ever returns `feed`.
5. **Route.** New `apps/core/src/routes/v1/chats/feed/get.ts` and `index.ts`, mounted in `chats/index.ts`.
   - Query: `cursorPaginationQuerySchema.extend({ lane: z.enum(["feed"]).default("feed") })`.
   - Auth: `requireUserAuthContext`. Use `withOrganizationSlugHeaderParameter`, as in the signal routes.
   - Map each message with `mapChatRoomMessage`. The DTO already carries the effective tags.
6. Run `pnpm --filter @sokosumi/core-client generate:snapshot`, then the Web typecheck.

## Commit 3: `test(core): cover chat feed candidates and paging`

1. **New `apps/core/src/services/chat-feed.postgres.test.ts`.** It uses the same opt-in gate as `chat-signals.postgres.test.ts`: `RUN_DATABASE_INTEGRATION_TESTS=true` plus a migrated scratch database. The fixtures write signal rows directly, so Jev does not run. Cases:
   - a Direct message and a mention appear before tagging;
   - the viewer's own message is hidden;
   - a muted room is hidden;
   - a needs-you message addressed to the viewer appears;
   - a correction with `applies: false` hides it;
   - pages of 2 return each item once, including two messages with the same `createdAt`;
   - `unreadCount` drops after a read state is written.
2. **New `feed/get.test.ts`.** It checks that a coworker gets 403, that `lane=urgent`, `limit=0` and an unknown cursor get 422, and that a valid call returns the response shape and pagination.
3. Extend `preferences.test.ts` to cover reading and patching `feedMode`.

Before I claim the candidate rule works, I revert only `chat-feed.service.ts`, keep the tests, and confirm that a non-zero number of collected tests fails.

## Commit 4: `feat(web): add opt-in chat feed mode`

1. **Settings.**
   - `account/components/chat-display-preferences.tsx`: add a third `ChatPreferenceSwitch` that saves `feedMode`, then calls `router.refresh()`. The comment says why: the change is a session change, so no narrower invalidation covers it.
   - `account/notifications/page.tsx`: pass the value from the session.
2. **Data path.** All new files:
   - `lib/clients/core.chat-feed.ts`. It is spread into `core.shared.ts`, which is a two-line change because that file has 6886 lines.
   - `lib/services/chat-feed.service.ts`.
   - `app/api/chat/feed/route.ts`, built on `respondToBackgroundChatRead`.
   - `components/chat/fetch-chat-feed.ts`.
3. **Sidebar.**
   - New `sidebar/components/sidebar-chat-slot.tsx`: when `sessionUser.feedMode` is set, it renders `FeedRooms` and does not mount `PrivateCachedSidebarRooms`, so the room list is never fetched. `private-cached-app-sidebar.tsx` calls this component. The private cache key does not change.
   - New `components/chat/feed-rooms.tsx` (view): a Feed row with its unread count, plus the existing Catch up row. Built from the sidebar row parts in `chat-unread-nav-rows.tsx`.
   - New `components/chat/use-feed-unread-count.ts` (logic): reads `limit=1` with query key `["chat", "feed", workspaceId, "unread"]`. It respects `useShowRoomUnreadCount()`.
4. **Page.**
   - `CHAT_FEED_PATH` in `chat-route-base.ts`.
   - `chat/feed/page.tsx`, which loads the first page on the server, and `loading.tsx`.
   - `components/use-chat-feed.ts` (logic): an infinite query.
   - `feed-view.tsx` (view). It reuses `ChatUnreadViewHeader`, `ChatCaughtUp` and `ThreadListLoadMore`.
   - `feed-item-row.tsx`: renders `ChatMessageRow` with no thread or quote buttons.
   - `feed-source-line.tsx`: shows the room name, adds "in thread" for a reply, and links with `chatRoomMessageHref`.
5. **Mobile.** No new tab. The Chats tab is active on `CHAT_FEED_PATH`. In feed mode, `chat/page.tsx` renders `FeedRooms` instead of the two room loaders.
6. **Translations.** New keys go in `en`, `de` and `es` under `App.Account.ChatDisplay.feedMode*` and `App.Channels.Feed.*`. Then run `pnpm --filter web messages:parity`.
7. **Tests.**
   - `sidebar-chat-slot.test.tsx`: in feed mode the Feed link shows and no room name does, and the reverse when feed mode is off.
   - `feed-item-row.test.tsx`: the room name, "in thread" and the message href.
   - `api/chat/feed/route.test.ts`: success, 401 and 503.
   - Update the mobile tab registry test and the sidebar contract test.
   - Every folder-scoped Web run includes `src/lib/utils/__tests__/src-walk-guards.test.ts`.
8. **UI review.** Run the UI skills that `apps/web/AGENTS.md` requires, then check the page in the browser in light and dark themes.

## Verification before push

- `pnpm exec turbo run typecheck test --filter=core --filter=web`, plus the opt-in Postgres suite on a scratch database.
- Run the review loop from the push gate: two reviewers on models other than the author's, then fix and repeat until a pass comes back clean.

## Least confident decisions

1. **Agent answers are found through `chat_room_mention`.** I assume a 1:1 Direct with an agent writes no mention row, so its replies stay out (INFERRED from the schema comment on `providerConversationId`, not traced in code). If such Directs do write mention rows, every agent Direct reply to the viewer lands in the Feed. A test case checks this.
2. **Active workspace only.** The Feed covers the active workspace plus personal Directs, like the signal routes. A person in two workspaces sees two feeds.
3. **The Catch up row stays in feed mode.** It keeps an existing feature reachable, but the sidebar then shows two entries, not one.
4. **The unread count is a separate query on every sidebar read.** It is cheap per call, but it runs on every page that shows the sidebar. Its cost is not measured.
5. **`router.refresh()` after the toggle.** It depends on Better Auth rewriting the session cookie on update. A browser check confirms it.
