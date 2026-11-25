# Chat Feed: design

- Status: Draft for review
- Date: 2026-11-25
- Scope: Web and Core. Apple and external messengers come later.

## Goal

Some people do not want to read many chat rooms. They want one place that shows only the chat messages that matter to them, and they want to answer there.

Feed mode gives them this place. It is opt-in. When it is on, the sidebar hides the classic room list and shows two entries: **Feed** and **Urgent**. Each entry opens a page that looks like a chat room. Each item on the page is the original message, shown as if its author wrote it to you. You can reply in place, and the reply goes to the source thread.

## Decisions already made

These come from the owner's answers in the design session on 2026-11-25.

1. The feed is one Core feature that Sokosumi shows. External messengers are out of scope for now. The Core endpoint is the seam for them later.
2. The feed covers chat messages only. Task, billing and system notifications do not change.
3. Feed mode is opt-in. It replaces the classic room list in the sidebar. The rooms stay reachable by link and search.
4. An agent reads the chats the person is in and decides what is urgent for that person. The existing chat signals already do this (see "What exists").
5. The feed is a virtual channel built on the Catch up engine. It adds no new rooms, no new room kind and no new table.
6. The first slice is Web only.

## What exists

Every line in this section is VERIFIED by reading the code on 2026-11-25, unless it is marked otherwise.

- **Chat signals.** Jev reads each human chat message once and stores a probability per tag in `ChatMessageSignal.probabilities` (`packages/database/prisma/chat-signal.prisma`). The tags include `question`, `needsDecision`, `urgent`, `escalation`, `blocker`, `fyi` and `chitChat` (`apps/core/src/lib/chat-signals/tags.ts:9`).
- **Who a message is for.** `ChatMessageSignal.addressedUserIds` holds the people a message asks something of: its @mentions, the other person in a pair, or the one person Jev read it as addressed to.
- **Thresholds.** A tag applies at `CHAT_SIGNAL_THRESHOLD = 0.6`. A push needs `CHAT_SIGNAL_PUSH_THRESHOLD = 0.75` (`tags.ts:30`, `tags.ts:34`). Reader corrections override Jev for every reader (`effectiveChatSignalTags`, `tags.ts:52`).
- **Urgent push.** `chatSignalPushRecipients` already interrupts the addressed people when `question`, `needsDecision`, `urgent` or `escalation` is at or above 0.75 (`apps/core/src/services/chat-signal-effects.service.ts:37`).
- **Reader views.** `listChatNeedsYou` and `listChatOpenLoops` return unread items per reader across their unmuted rooms (`apps/core/src/services/chat-signal-views.service.ts:251`, `:300`). Each call returns at most `MAX_LISTED = 50` rows (`:24`), so the result is a floor, not a total.
- **Digest.** `ChatCatchUpSummary` caches a written "while you were away" summary per reader (`chat-signal.prisma`). The Web Catch up page shows it (`apps/web/src/app/(app)/chat/catch-up/components/catch-up-view.tsx`).
- **Mentions.** `ChatRoomUserMention` stores one row per mentioned user and message, indexed by `userId` (`packages/database/prisma/schema.prisma:4503`). This exists before tagging finishes.
- **Thread replies.** `POST /v1/chats/rooms/{id}/messages` accepts `parentMessageId` (`apps/core/src/routes/v1/chats/rooms/[id]/messages/post.ts:115`).
- **Close a loop.** `setChatMessageSignalLoop` closes or reopens a message's open loop (`chat-signal-views.service.ts:472`).
- **A boolean preference to copy.** `hideRoomUnreadCount` goes from the Prisma column (`packages/database/prisma/user.prisma:58`) through the Better Auth session fields to the Core preferences PATCH (`apps/core/src/routes/v1/users/[id]/preferences/patch.ts:42`) and the settings UI (`apps/web/src/app/(app)/account/components/chat-display-preferences.tsx`). REPORTED by a read-only subagent; I checked only the Prisma line.
- **Sidebar seam.** `private-cached-app-sidebar.tsx:98` mounts `OrganizationChatList`. REPORTED by a read-only subagent.
- **Gap.** Only human messages are tagged. Coworker and Soko Bot messages have no signal (schema comment on `ChatMessageSignal`).

## Design

### Lanes

The lanes are worked out when the feed is read. Nothing new is stored. A message is a candidate for the viewer when all of these are true:

- It is in a room the viewer can see and has not muted (the same room set as `readerRooms`).
- It is not deleted.
- The viewer did not send it.

A candidate goes into one lane:

| Lane   | Rule                                                                                                                                                                                                                                                                                                                                                                                      |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Urgent | The viewer is in `addressedUserIds`, and `urgent` or `escalation` is at or above `CHAT_SIGNAL_PUSH_THRESHOLD` after reader corrections.                                                                                                                                                                                                                                                   |
| Feed   | Any other candidate that is a message from a person in a Direct, mentions the viewer (`ChatRoomUserMention`), or has the viewer in `addressedUserIds` with a needs-you tag (`question`, `needsDecision`). Also an agent message that answers a human message: its `ChatRoomMention.responseMessageId` points to it, and the asking message was sent by the viewer or mentions the viewer. |
| Hidden | Everything else. It stays in its source room.                                                                                                                                                                                                                                                                                                                                             |

The two lanes do not overlap: an Urgent item is not repeated in Feed.

Agent messages (coworkers and Soko Bot) never go to Urgent. An agent reply in a 1:1 Direct with an agent is not in the Feed. This follows the owner's rule from 2026-11-25: "agents may be included, for example if related to a human message, but normally not urgent".

The Feed lane does not wait for Jev. A Direct message or a mention is in the Feed as soon as it is written. Tagging can later move it to Urgent.

### Core: one read endpoint

`GET /v1/chats/feed?lane=feed|urgent&cursor=...`

- One SQL query over `chat_room_message`. It joins the reader's room set, `chat_room_user_mention` for the viewer, and `chat_message_signal`.
- The response is ordered by `createdAt` and paged with a cursor. History stays: an item that you read or answer remains in the Feed, as in a room.
- The Urgent lane shows only open items: unread, and with no closed loop. It works as a queue that empties.
- Each item returns the existing message DTO (`mapChatRoomMessage`) plus `room { id, name, kind }`, `lane`, the effective tags, and `threadReplyCount`.
- The response also returns the viewer's unread counts per lane, for the sidebar.
- Versioned route, validated OpenAPI schema. Regenerate the Core client snapshot after the change.

### Web: feed mode

- **Preference.** A new user boolean `feedMode`, default `false`. It follows the `hideRoomUnreadCount` path end to end, including the settings toggle.
- **Sidebar.** When `feedMode` is on, `private-cached-app-sidebar.tsx` renders a `FeedRooms` component instead of `OrganizationChatList`, and skips the chat list fetch. `FeedRooms` shows two rows, **Feed** and **Urgent**, each with its unread count.
- **Page.** `/chat/feed` and `/chat/feed/urgent`. The page reuses the existing message row components. Each row adds one line under the message: the room name and, for a reply, "in thread". The line links to the message in its room.
- **Reply.** Each row has a reply action. It opens a composer that posts to the source room with `parentMessageId` set to the message (or to its thread root, for a reply in a thread). The reply then shows in the feed row as a thread count, as it does in a room.
- **Done.** Urgent and needs-you rows have a Done action that calls the existing loop close. The row leaves the Urgent lane.
- **Pinned digest.** The top of the Feed shows the existing catch-up summary as one pinned "while you were away" message. It reuses `CatchUpSummaryBody`.
- **Realtime.** The page refetches the feed query when a chat event for one of the viewer's rooms arrives (new message, signal update) and on focus. The update is scoped to the feed query key, not a route refresh.
- **No top-level composer.** Nobody receives a message written at the top of the Feed, so the page has no main composer.

### Notifications

This slice does not change any notification. Mentions, Direct messages and signal pushes keep their current banners and emails. The banner click target can move to the Feed in a later slice.

## Slices

Each slice works end to end and can ship alone.

1. **Read-only Feed.** Core endpoint (Feed lane only), `feedMode` preference with the settings toggle, sidebar swap, Feed page with source lines. No reply.
2. **Reply and Done.** Inline thread reply and the Done action.
3. **Urgent lane.** The Urgent rule in the endpoint, the second sidebar row, and the Urgent page.
4. **Pinned digest and realtime.** The catch-up summary at the top of the Feed, and live refetch.

## Later, not in this design

- Apple clients.
- Re-notify an open Urgent item until it is acknowledged.
- Signals for coworker and Soko Bot messages.
- Replies in threads you take part in that do not address you.
- External messengers. eve 0.90.0 is installed and ships channels for Slack, Telegram, Teams, Discord, Twilio and iMessage. A messenger adapter would read the same endpoint.
- In feed mode, letting the feed decide banners and emails.

## Testing

- **Core integration tests for the endpoint**, against the Postgres test setup the signal views already use:
  - a Direct message and a mention appear in the Feed before tagging;
  - a message with `urgent` at 0.8 addressed to the viewer appears in Urgent and not in Feed;
  - a reader correction that removes `urgent` moves it back to Feed;
  - a message in a muted room is hidden;
  - the viewer's own message is hidden;
  - a closed loop leaves Urgent;
  - cursor paging returns each item once.
- **Web tests:**
  - the sidebar shows the feed rows and not the room list when `feedMode` is on;
  - a reply posts with the right `parentMessageId`.
- No test that only checks that a mock was called.

## Least confident decisions

1. **The two lanes do not overlap.** A person might want to see urgent items in the Feed too, so that the Feed is the complete record.
2. **The Feed keeps history like a room, and the Urgent lane empties like a queue.** The two lanes behave differently, and that can confuse people. The other choice is an inbox that hides items you have handled.
3. **The Urgent lane uses the push threshold, 0.75.** It is the same bar as the existing interrupt. We have no data yet on how often Jev scores `urgent` that high on real traffic, so the lane could be empty or noisy.
4. **No main composer.** People in feed mode may expect to start a conversation from the Feed. Today they must open a room or a Direct by search.
5. **The query cost.** The endpoint is one query across all of the reader's rooms. With many rooms it can be slow. `listChatNeedsYou` uses the same room-set pattern, but its plan with a history window and a cursor is not measured.
6. **The sidebar swap is server-rendered and cached.** `feedMode` must be readable where the cached sidebar renders. If it is not in the session, the swap costs an extra request or a cache key change.
