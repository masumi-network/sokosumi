# Thread Unread Surfacing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop Thread replies from marking a channel unread, and give Thread unread three places to be seen: an unread reply bar on the parent message, inset rows under the channel in the sidebar, and the existing thread list panel.

**Architecture:** Core already stores Thread reads correctly (`ChatRoomThreadReadState`, written on Thread open) and already gates Thread unread by Participant and Mute (ADR-0013, ADR-0030). The single defect is that `getChatRoomUnreadCounts` sums the two legs of its `UNION ALL` into one per-room number. This plan separates that sum into its two addends, carries both to the client, and teaches the sidebar and the message row to render them differently. No counting rule is invented; an existing sum is split.

**Tech Stack:** Hono + Zod + Prisma (`apps/core`), Next.js App Router + React + Tailwind + next-intl (`apps/web`), Vitest with mocked Prisma throughout.

**Spec:** [2026-09-21-thread-unread-surfacing.spec.md](./2026-09-21-thread-unread-surfacing.spec.md)

## Global Constraints

- **This reverses documented vocabulary.** `CONTEXT.md` currently lists "a separate Threads badge", "Threads badge as a separate count" and "not a sidebar number" under _Avoid_. Task 1 records the reversal as an ADR and rewrites those entries. Do not start Task 2 before Task 1 is committed — in this repo the vocabulary leads the code.
- **`unreadCount` keeps meaning the total** (`channel + thread`) on the wire. `apps/apple` consumes it and is not in this plan's scope. New fields are additive.
- **Participant, Look and Mute semantics do not change.** ADR-0013 and ADR-0030 stand. If a task's diff touches `sqlViewerIsThreadParticipant` or `sqlThreadReplyPagesViewer`, you have gone wrong.
- **Tests mock Prisma.** No DB-backed tests. Follow the existing style in `apps/core/src/routes/v1/chats/rooms/room-unread.test.ts`: assert on the SQL string and on the mapping of fake rows.
- **Copy rules:** `CONTEXT.md` forbids the word "looked" in product UI — say *unread* / *mark as read*. New user-facing strings go in `apps/web/messages/en.json` and every sibling locale file; use the `translations` skill.
- **Commit after every task.** Conventional Commits, scope `chat`.

## Review Focus

Five conditions the spec implies that no task's happy path exercises. Each has a test pinned to the task that owns the code.

1. **A User mention inside a Thread must still bold the channel.** After the split, a mention reply counts toward `thread`, not `channel` — naive `bold = channelUnreadCount > 0` silently drops the escalation the spec's row 3 requires. Pinned in Task 6.
2. **A room absent from the breakdown map.** Every one of the 8 call sites currently writes `?? 0`; a partially-populated `Map` must yield a zeroed breakdown, not `undefined` reaching Zod. Pinned in Task 3.
3. **A Muted thread with unread replies.** Must contribute 0 to `thread`, and must not produce an inset row or an unread reply bar — but a mention in it still breaks through. Pinned in Task 2 and Task 7.
4. **A lurker viewing a busy thread.** Not a Participant, so `threadUnreadReplyCount` is 0 and the reply bar stays plain, even though `threadReplyCount` is large. Pinned in Task 5.
5. **More than 3 unread threads in one room.** The inset list caps at 3 and the overflow row must state the true remainder, not "3". Pinned in Task 8.

---

### Task 1: Record the vocabulary reversal

**Files:**
- Create: `docs/adr/0037-thread-unread-leaves-room-unread.md`
- Modify: `CONTEXT.md:432-437` (**Room unread**, **Unread thread**), `CONTEXT.md:406-408` (**Thread list**)

**Interfaces:**
- Consumes: nothing.
- Produces: the vocabulary every later task's comments and copy must match.

- [x] **Step 1: Write the ADR** — done, committed ahead of this plan.

`docs/adr/0037-thread-unread-leaves-room-unread.md` already exists, with Status
`Proposed`. Do not rewrite it. If review changed the decision, the spec and the
tasks below are what must move, not the ADR alone. Flip its Status to `Accepted`
only once the docs PR is approved.

- [ ] **Step 2: Rewrite the three CONTEXT.md entries**

Replace the **Room unread** entry (`CONTEXT.md:432-434`) with:

```markdown
**Room unread**:
The count of unseen non-self top-level messages in this room after Room last-read. Replies in Threads do not count — they are Thread unread, and they surface on the Thread ([ADR-0037](docs/adr/0037-thread-unread-leaves-room-unread.md)). A User mention inside a Thread is the one exception: it marks the room as well. Replies from before the user joined the room do not count. Drives sidebar **bold**, and an optional numeric affordance a reader opts in to (`showRoomUnreadCount`, off by default, [ADR-0027](docs/adr/0027-room-unread-count-is-a-reader-opt-in.md)). Not the mention badge.
_Avoid_: Attention, attentionReplyCount, counting thread replies, counting lurker thread replies, using the mention badge as the message unread count
```

Replace the **Unread thread** entry (`CONTEXT.md:436-437`) with:

```markdown
**Unread thread**:
A Thread the user is a Participant of, with at least one non-self reply they have not cleared. Never-looked still counts if they are a Participant. A Muted thread does not count, unless a remaining reply mentions them. Sorts the thread list, tints the parent message's reply bar, and renders as an inset row under its channel in the sidebar (capped at 3, then an overflow row into the thread list). It is the room's second number, beside Room unread and never folded into it.
_Avoid_: Unread (when meaning the room), never-replied, treating Look-without-Participant as unread, attention threads, folding this into Room unread
```

Replace the **Thread list** entry (`CONTEXT.md:406-408`) with:

```markdown
**Thread list**:
The per-room list of that room’s threads, shown in the thread side panel. Every thread in the room, sorted with unread threads first, then by last reply. The overflow target for the sidebar's capped inset rows. Still per-room: not a cross-room inbox.
_Avoid_: Unread threads (as the name of this list), treating this as a cross-room surface
```

- [ ] **Step 3: Check nothing else contradicts**

Run: `rg -n "separate Threads badge|not a sidebar number|Threads badge as a separate count" CONTEXT.md docs/`
Expected: no matches outside `docs/adr/superseded/`.

- [ ] **Step 4: Commit**

```bash
git add docs/adr/0037-thread-unread-leaves-room-unread.md CONTEXT.md
git commit -m "docs(chat): thread unread leaves room unread (ADR-0037)"
```

---

### Task 2: Split the room unread count into a breakdown

**Files:**
- Modify: `apps/core/src/routes/v1/chats/rooms/room-unread.ts:98-165`
- Test: `apps/core/src/routes/v1/chats/rooms/room-unread.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `export interface ChatRoomUnreadBreakdown { channel: number; thread: number; total: number }`
  - `export function emptyChatRoomUnreadBreakdown(): ChatRoomUnreadBreakdown`
  - `getChatRoomUnreadCounts(roomIds, userId, tx): Promise<Map<string, ChatRoomUnreadBreakdown>>` — **return type changes**; Task 3 fixes the 8 call sites.

- [ ] **Step 1: Write the failing tests**

Add to `apps/core/src/routes/v1/chats/rooms/room-unread.test.ts`, inside the existing `describe("getChatRoomUnreadCounts", ...)`:

```ts
it("splits the two legs into channel and thread with a total", async () => {
  const queryRawUnsafe = vi.fn().mockResolvedValue([
    { roomId: "room-a", source: "channel", unreadCount: 2 },
    { roomId: "room-a", source: "thread", unreadCount: 3 },
    { roomId: "room-b", source: "thread", unreadCount: 1 },
  ]);
  const tx = { $queryRawUnsafe: queryRawUnsafe } as never;

  const counts = await getChatRoomUnreadCounts(["room-a", "room-b"], "user_1", tx);

  expect(counts.get("room-a")).toEqual({ channel: 2, thread: 3, total: 5 });
  // A room whose only unread lives in Threads reports a clean channel.
  expect(counts.get("room-b")).toEqual({ channel: 0, thread: 1, total: 1 });
});

it("groups by source and keeps both legs' gating intact", async () => {
  const queryRawUnsafe = vi.fn().mockResolvedValue([]);
  const tx = { $queryRawUnsafe: queryRawUnsafe } as never;

  await getChatRoomUnreadCounts(["room-a"], "user_1", tx);

  const sql = String(queryRawUnsafe.mock.calls[0]?.[0]);
  expect(sql).toContain("'channel'::text AS source");
  expect(sql).toContain("'thread'::text AS source");
  expect(sql).toContain('GROUP BY combined."roomId", combined.source');
  // Mute gating (ADR-0030) still lives on the thread leg only.
  expect(sql).toContain('thread_read."mutedAt" IS NULL');
});

it("returns no entry for a room with nothing unread", async () => {
  const queryRawUnsafe = vi.fn().mockResolvedValue([]);
  const tx = { $queryRawUnsafe: queryRawUnsafe } as never;

  const counts = await getChatRoomUnreadCounts(["room-a"], "user_1", tx);

  expect(counts.has("room-a")).toBe(false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @sokosumi/core test -- room-unread.test.ts -t "getChatRoomUnreadCounts"`
Expected: FAIL — `counts.get("room-a")` is a number, not an object.

- [ ] **Step 3: Implement the split**

In `apps/core/src/routes/v1/chats/rooms/room-unread.ts`, add above `getChatRoomUnreadCounts`:

```ts
/**
 * Room unread, as its two addends (ADR-0037).
 *
 * `channel` is what Room last-read clears. `thread` is what Looking a Thread
 * clears. They are reported separately because a reader who clears a channel
 * must see its mark go quiet, and folding the two made that impossible.
 * `total` is the sum, which is what `unreadCount` has always meant on the wire.
 */
export interface ChatRoomUnreadBreakdown {
  channel: number;
  thread: number;
  total: number;
}

export function emptyChatRoomUnreadBreakdown(): ChatRoomUnreadBreakdown {
  return { channel: 0, thread: 0, total: 0 };
}
```

Change the signature to `Promise<Map<string, ChatRoomUnreadBreakdown>>`.

Change the row type and the `SELECT`/`GROUP BY` (leave both `WHERE` bodies byte-for-byte alone):

```ts
  const rows = await tx.$queryRawUnsafe<
    Array<{
      roomId: string;
      source: "channel" | "thread";
      unreadCount: number | bigint;
    }>
  >(
    `
    SELECT
      combined."roomId" AS "roomId",
      combined.source AS "source",
      COUNT(*)::int AS "unreadCount"
    FROM (
      SELECT message.id, message."roomId", 'channel'::text AS source
```

…and on the second leg:

```ts
      SELECT reply.id, reply."roomId", 'thread'::text AS source
```

…and the tail:

```ts
    ) combined
    GROUP BY combined."roomId", combined.source
  `,
    ...uniqueRoomIds,
    userId,
  );
```

Replace the return with:

```ts
  const byRoom = new Map<string, ChatRoomUnreadBreakdown>();
  for (const row of rows) {
    const breakdown = byRoom.get(row.roomId) ?? emptyChatRoomUnreadBreakdown();
    if (row.source === "channel") {
      breakdown.channel = Number(row.unreadCount);
    } else {
      breakdown.thread = Number(row.unreadCount);
    }
    breakdown.total = breakdown.channel + breakdown.thread;
    byRoom.set(row.roomId, breakdown);
  }
  return byRoom;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @sokosumi/core test -- room-unread.test.ts`
Expected: PASS. The pre-existing test asserting `counts.get("room-a")` is `3` will now fail — update it to `{ channel: 3, thread: 0, total: 3 }` and give its mock row a `source: "channel"`.

- [ ] **Step 5: Commit**

```bash
git add apps/core/src/routes/v1/chats/rooms/room-unread.ts apps/core/src/routes/v1/chats/rooms/room-unread.test.ts
git commit -m "feat(chat): split room unread into channel and thread legs"
```

---

### Task 3: Carry the breakdown to the room summary

**Files:**
- Modify: `apps/core/src/schemas/chat-room.schema.ts:183`
- Modify: `apps/core/src/routes/v1/chats/rooms/helpers.ts:208-221` (options), `:246-254` (destructure), `:283` (return)
- Modify (one line each): `apps/core/src/routes/v1/chats/rooms/get.ts:221`, `[id]/get.ts:82`, `[id]/star/post.ts`, `[id]/star/delete.ts`, `[id]/mute/post.ts`, `[id]/mute/delete.ts`, `[id]/unread/post.ts`, `[id]/read/post.ts:139`
- Test: `apps/core/src/routes/v1/chats/rooms/helpers.test.ts`

**Interfaces:**
- Consumes: `ChatRoomUnreadBreakdown`, `emptyChatRoomUnreadBreakdown` (Task 2).
- Produces:
  - `export function unreadAttention(breakdown: ChatRoomUnreadBreakdown | undefined): { unreadCount: number; channelUnreadCount: number; threadUnreadCount: number }` in `helpers.ts`
  - Wire fields `channelUnreadCount`, `threadUnreadCount` on `chatRoomSchema`, consumed by Task 6.

- [ ] **Step 1: Write the failing test**

Add to `apps/core/src/routes/v1/chats/rooms/helpers.test.ts`:

```ts
import { unreadAttention } from "./helpers";

describe("unreadAttention", () => {
  it("spreads a breakdown into the three wire fields", () => {
    expect(unreadAttention({ channel: 2, thread: 3, total: 5 })).toEqual({
      unreadCount: 5,
      channelUnreadCount: 2,
      threadUnreadCount: 3,
    });
  });

  // Review Focus 2: a room with nothing unread is absent from the Map.
  it("zeroes every field when the room is missing from the map", () => {
    expect(unreadAttention(undefined)).toEqual({
      unreadCount: 0,
      channelUnreadCount: 0,
      threadUnreadCount: 0,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @sokosumi/core test -- helpers.test.ts -t unreadAttention`
Expected: FAIL — `unreadAttention` is not exported.

- [ ] **Step 3: Implement**

In `apps/core/src/routes/v1/chats/rooms/helpers.ts`, import the breakdown type and add:

```ts
/**
 * The three unread fields a room summary carries, from one breakdown.
 *
 * `unreadCount` stays the total so existing clients keep their meaning;
 * the two halves are additive (ADR-0037). One helper so the 8 routes that
 * build a summary cannot drift from each other.
 */
export function unreadAttention(breakdown: ChatRoomUnreadBreakdown | undefined): {
  unreadCount: number;
  channelUnreadCount: number;
  threadUnreadCount: number;
} {
  const { channel, thread, total } = breakdown ?? emptyChatRoomUnreadBreakdown();
  return {
    unreadCount: total,
    channelUnreadCount: channel,
    threadUnreadCount: thread,
  };
}
```

In `MapChatRoomAttentionOptions` (`helpers.ts:208`) add:

```ts
  channelUnreadCount?: number;
  threadUnreadCount?: number;
```

In the `mapChatRoom` destructure (`helpers.ts:246`) add `channelUnreadCount = 0,` and `threadUnreadCount = 0,`, and in the returned object beside `unreadCount,` add `channelUnreadCount,` and `threadUnreadCount,`.

In `apps/core/src/schemas/chat-room.schema.ts`, after the `unreadCount` field (`:183`):

```ts
    channelUnreadCount: z.number().int().min(0).default(0).openapi({
      description:
        "Unread non-self top-level messages after Room last-read. Excludes Thread replies. Drives sidebar bold. ADR-0037.",
      example: 2,
    }),
    threadUnreadCount: z.number().int().min(0).default(0).openapi({
      description:
        "Unread non-self replies in Threads the viewer Participates in, after the per-thread look baseline, less Muted threads that do not mention them. Surfaces on the Thread, never on the channel. ADR-0037.",
      example: 3,
    }),
```

Update the `unreadCount` description to: `"Total unread: channelUnreadCount + threadUnreadCount. Prefer the two halves; this stays the sum for existing clients. ADR-0037."`

- [ ] **Step 4: Update the 8 call sites**

In each of the eight files, replace the line

```ts
          unreadCount: unreadCounts.get(room.id) ?? 0,
```

with

```ts
          ...unreadAttention(unreadCounts.get(room.id)),
```

matching the surrounding indentation, and add `unreadAttention` to that file's import from `../helpers` (path depth varies per file). In `[id]/read/post.ts:139` the variable is also called `unreadCounts`; apply the same change at whichever key it feeds.

- [ ] **Step 5: Run the Core suite**

Run: `pnpm --filter @sokosumi/core test && pnpm --filter @sokosumi/core typecheck`
Expected: PASS. Any remaining type error is a call site missed in Step 4.

- [ ] **Step 6: Regenerate the web client**

Run: `pnpm --filter @sokosumi/web generate:core-client`
Expected: `apps/web/src/lib/clients/generated/core/types.gen.ts` gains `channelUnreadCount` and `threadUnreadCount` on `ChatRoom`. If that script name does not exist, find it with `rg -n '"generate' apps/web/package.json` and use the one that writes `lib/clients/generated/core`.

- [ ] **Step 7: Commit**

```bash
git add apps/core/src apps/web/src/lib/clients/generated
git commit -m "feat(chat): expose channel and thread unread on the room summary"
```

---

### Task 4: Per-viewer unread reply count on the message projection

**Files:**
- Modify: `apps/core/src/routes/v1/chats/rooms/helpers.ts:541` (signature), `:646` (return)
- Modify: `apps/core/src/schemas/chat-room.schema.ts:575`
- Modify: `apps/core/src/routes/v1/chats/rooms/[id]/messages/get.ts:167-176` and `:235-244`
- Test: `apps/core/src/routes/v1/chats/rooms/[id]/messages/get.test.ts`

**Interfaces:**
- Consumes: `getChatRoomThreadAggregates` (existing, unchanged).
- Produces:
  - `mapChatRoomMessage(message, currentUserId?, threadUnreadReplyCount?: number)` — third parameter defaults to `0`, so existing call sites stay valid.
  - Wire field `threadUnreadReplyCount` on `chatRoomMessageSchema`, consumed by Task 5.

- [ ] **Step 1: Write the failing test**

Add to `apps/core/src/routes/v1/chats/rooms/[id]/messages/get.test.ts`:

```ts
it("reports the viewer's unread reply count on each parent", async () => {
  // Two parents in the page; only the first has unread replies for this viewer.
  const response = await listMessages({
    roomId: ROOM_ID,
    userId: "user_1",
    threadAggregates: [
      { parentMessageId: "msg-1", unreadReplyCount: 2 },
    ],
    messages: [
      { id: "msg-1", replyCount: 5 },
      { id: "msg-2", replyCount: 3 },
    ],
  });

  expect(response.data[0]).toMatchObject({
    id: "msg-1",
    threadReplyCount: 5,
    threadUnreadReplyCount: 2,
  });
  // Review Focus 4: a lurker's busy thread reports 0, not 3.
  expect(response.data[1]).toMatchObject({
    id: "msg-2",
    threadReplyCount: 3,
    threadUnreadReplyCount: 0,
  });
});
```

Build `listMessages` on the harness this file already uses for its other cases — reuse its Prisma mock and add a `getChatRoomThreadAggregates` mock returning `threadAggregates`. Do not introduce a new harness shape.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @sokosumi/core test -- messages/get.test.ts -t "unread reply count"`
Expected: FAIL — `threadUnreadReplyCount` is undefined.

- [ ] **Step 3: Add the schema field**

In `apps/core/src/schemas/chat-room.schema.ts`, after `threadReplyCount` (`:575`):

```ts
    threadUnreadReplyCount: z.number().int().min(0).default(0).openapi({
      description:
        "Non-self replies under this parent the viewer has not cleared: Participant-gated and mute-gated, after the per-thread look baseline. 0 for lurkers and for viewers with no unread. ADR-0013, ADR-0030, ADR-0037.",
      example: 2,
    }),
```

- [ ] **Step 4: Thread the value through the mapper**

In `helpers.ts`, change the `mapChatRoomMessage` signature to take a third parameter:

```ts
export function mapChatRoomMessage(
  message: ChatRoomMessageWithRelations,
  currentUserId?: string,
  /**
   * The viewer's unread replies under this parent. Passed in rather than
   * derived: it depends on the viewer's Look baseline and Participant status,
   * which the Prisma include cannot express. Defaults to 0, which is also the
   * right answer for a lurker.
   */
  threadUnreadReplyCount = 0,
) {
```

(Keep the existing first-parameter type exactly as it is today.) In the returned object, beside `threadReplyCount: message._count.replies,` add:

```ts
    threadUnreadReplyCount,
```

- [ ] **Step 5: Supply the value from the message route**

In `apps/core/src/routes/v1/chats/rooms/[id]/messages/get.ts`, import `getChatRoomThreadAggregates` from `../../../room-unread` (match the relative depth the file already uses for `../../helpers`), and add above each of the two `return ok(` blocks:

```ts
    // One extra gated query per page rather than a per-message N+1: the
    // aggregates are already Participant- and mute-gated, so this cannot
    // disagree with the room's thread unread number.
    const unreadByParent = new Map(
      (
        await getChatRoomThreadAggregates(id, userContext.userId, prisma, {
          unreadOnly: true,
        })
      ).map((aggregate) => [
        aggregate.parentMessageId,
        aggregate.unreadReplyCount,
      ]),
    );
```

and change both `mapChatRoomMessage` calls to:

```ts
              mapChatRoomMessage(
                message,
                userContext.userId,
                unreadByParent.get(message.id) ?? 0,
              ),
```

For the search branch (`searchQuery` truthy) pass `0` instead — search results are not a live timeline and an unread bar there would be noise.

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter @sokosumi/core test -- messages/get.test.ts && pnpm --filter @sokosumi/core typecheck`
Expected: PASS.

- [ ] **Step 7: Regenerate the client and commit**

```bash
pnpm --filter @sokosumi/web generate:core-client
git add apps/core/src apps/web/src/lib/clients/generated
git commit -m "feat(chat): report per-viewer unread reply count on thread parents"
```

---

### Task 5: Unread reply bar on the parent message

**Files:**
- Modify: `apps/web/src/app/(app)/chat/components/room-message-row.tsx:2214-2222`
- Modify: `apps/web/messages/en.json` (and every sibling locale)
- Test: `apps/web/src/app/(app)/chat/components/__tests__/room-message-row-thread-bar.test.tsx` (create)

**Interfaces:**
- Consumes: `message.threadUnreadReplyCount` (Task 4).
- Produces: the `data-slot="thread-reply-bar"` element, asserted by no later task.

- [ ] **Step 1: Add the copy**

Use the `translations` skill. In `apps/web/messages/en.json`, beside the existing `Thread.replyCount`, add:

```json
"newReplyCount": "{count, plural, one {# new reply} other {# new replies}}"
```

Add the same key to every other file in `apps/web/messages/`. Find them with `ls apps/web/messages/`.

- [ ] **Step 2: Write the failing test**

Create `apps/web/src/app/(app)/chat/components/__tests__/room-message-row-thread-bar.test.tsx`, following the mock setup of the sibling `rooms-client-*.test.tsx` files:

```tsx
it("renders a plain reply count when nothing is unread", () => {
  renderRow({ threadReplyCount: 3, threadUnreadReplyCount: 0 });

  const bar = screen.getByRole("button", { name: /3 replies/i });
  expect(bar).not.toHaveAttribute("data-unread");
});

it("renders the unread bar with the new-reply count", () => {
  renderRow({ threadReplyCount: 5, threadUnreadReplyCount: 2 });

  const bar = screen.getByRole("button", { name: /2 new replies/i });
  expect(bar).toHaveAttribute("data-unread", "true");
});

// Review Focus 4: a lurker sees the plain bar on a busy thread.
it("stays plain for a lurker on a busy thread", () => {
  renderRow({ threadReplyCount: 20, threadUnreadReplyCount: 0 });

  expect(screen.getByRole("button", { name: /20 replies/i })).not.toHaveAttribute(
    "data-unread",
  );
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @sokosumi/web test -- room-message-row-thread-bar`
Expected: FAIL — no `data-unread` attribute.

- [ ] **Step 4: Implement**

In `apps/web/src/app/(app)/chat/components/room-message-row.tsx`, replace the thread button block (`:2214-2222`) with:

```tsx
      {showThreadButton && message.threadReplyCount > 0 && onOpenThread ? (
        <button
          type="button"
          data-slot="thread-reply-bar"
          data-unread={message.threadUnreadReplyCount > 0 ? "true" : undefined}
          className={cn(
            "text-primary hover:text-primary-hover -mx-1 mt-1 min-h-9 px-1 text-xs font-medium sm:mt-1 sm:min-h-0",
            // Unread reads as a bar, not a badge: the tint plus an inset left
            // rule gives the count an edge to sit against without adding a
            // second mark to a row that already carries reactions.
            message.threadUnreadReplyCount > 0 &&
              "bg-primary/10 shadow-primary/45 rounded-md px-2 font-semibold shadow-[inset_2px_0_0]",
          )}
          onClick={() => onOpenThread(message)}
        >
          {message.threadUnreadReplyCount > 0
            ? t("Thread.newReplyCount", {
                count: message.threadUnreadReplyCount,
              })
            : t("Thread.replyCount", { count: message.threadReplyCount })}
        </button>
      ) : null}
```

Add `cn` to the file's imports from `@/lib/utils` if it is not already there.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @sokosumi/web test -- room-message-row-thread-bar && pnpm --filter @sokosumi/web typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/\(app\)/chat/components/room-message-row.tsx apps/web/src/app/\(app\)/chat/components/__tests__/room-message-row-thread-bar.test.tsx apps/web/messages
git commit -m "feat(chat): tint the thread reply bar when replies are unread"
```

---

### Task 6: Sidebar attention follows the channel leg only

**Files:**
- Modify: `apps/web/src/components/chat/room-attention.ts`
- Modify: `apps/web/src/components/chat/chat-room-sidebar-row.tsx:318-325`
- Test: `apps/web/src/components/chat/room-attention.test.ts`

**Interfaces:**
- Consumes: `room.channelUnreadCount`, `room.threadUnreadCount`, `room.unreadMentionCount` (Task 3).
- Produces: `resolveRoomAttention` gains an optional `channelUnreadCount`; its return shape is unchanged (`{ bold, badgeCount, unreadTextCount }`), so `chat-room-sidebar-row.tsx` and `chat-unread-document-title.ts` keep working.

- [ ] **Step 1: Write the failing tests**

Add to `apps/web/src/components/chat/room-attention.test.ts`:

```ts
it("does not bold a room whose unread is all thread replies", () => {
  expect(
    resolveRoomAttention({
      unreadCount: 3,
      channelUnreadCount: 0,
      unreadMentionCount: 0,
    }),
  ).toEqual({ bold: false, badgeCount: 0, unreadTextCount: 0 });
});

// Review Focus 1: a mention inside a Thread must still reach the channel.
it("bolds a room when a thread reply mentions the reader", () => {
  const { bold, badgeCount } = resolveRoomAttention({
    unreadCount: 1,
    channelUnreadCount: 0,
    unreadMentionCount: 1,
  });

  expect(bold).toBe(true);
  expect(badgeCount).toBe(1);
});

it("counts only the channel leg in the reader's opt-in number", () => {
  expect(
    resolveRoomAttention({
      unreadCount: 5,
      channelUnreadCount: 2,
      unreadMentionCount: 0,
      showUnreadCount: true,
    }).unreadTextCount,
  ).toBe(2);
});

it("falls back to the total when the channel leg is absent", () => {
  expect(
    resolveRoomAttention({ unreadCount: 4, unreadMentionCount: 0 }).bold,
  ).toBe(true);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @sokosumi/web test -- room-attention`
Expected: FAIL — the first test reports `bold: true`.

- [ ] **Step 3: Implement**

In `apps/web/src/components/chat/room-attention.ts`, extend the options and body:

```ts
export function resolveRoomAttention(options: {
  unreadCount: number;
  /**
   * The channel leg alone (ADR-0037). Bold and the reader's opt-in number
   * follow this, not the total, so clearing a channel genuinely quiets its
   * row. Optional so a caller that has not migrated still gets today's
   * behaviour from the total.
   */
  channelUnreadCount?: number;
  unreadMentionCount: number;
  markedUnread?: boolean;
  isMuted?: boolean;
  showUnreadCount?: boolean;
}): { bold: boolean; badgeCount: number; unreadTextCount: number } {
  if (options.isMuted === true) {
    return { bold: false, badgeCount: 0, unreadTextCount: 0 };
  }

  const channelUnread = options.channelUnreadCount ?? options.unreadCount;

  return {
    // A User mention inside a Thread is the one escalation that reaches the
    // channel: being named is not chatter. Without it the split would quietly
    // drop the loudest thing a Thread can hold.
    bold:
      channelUnread > 0 ||
      options.unreadMentionCount > 0 ||
      options.markedUnread === true,
    badgeCount: options.unreadMentionCount,
    unreadTextCount: options.showUnreadCount === true ? channelUnread : 0,
  };
}
```

Update the doc comment's first line to: `Bold = unread top-level activity, an unread mention, or forced unread; badge = unread @mentions only. Thread replies do not bold a row (ADR-0037).`

In `resolveSectionAttention`, add `channelUnreadCount: number;` to the `rooms` element type and pass `channelUnreadCount: room.channelUnreadCount` into the inner call.

- [ ] **Step 4: Wire the sidebar row**

In `apps/web/src/components/chat/chat-room-sidebar-row.tsx:318`, add the field to the call:

```tsx
  const { bold, badgeCount, unreadTextCount } = resolveRoomAttention({
    unreadCount: room.unreadCount,
    channelUnreadCount: room.channelUnreadCount,
    unreadMentionCount: room.unreadMentionCount,
```

Fix the resulting type errors at every other `resolveRoomAttention` / `resolveSectionAttention` call site — find them with `rg -n "resolveRoomAttention|resolveSectionAttention" apps/web/src --glob '!*.test.*'`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @sokosumi/web test -- room-attention chat-room-sidebar-row && pnpm --filter @sokosumi/web typecheck`
Expected: PASS. Existing sidebar-row tests that build a room fixture without `channelUnreadCount` will need the field added.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/chat
git commit -m "feat(chat): thread replies no longer bold the channel row"
```

---

### Task 7: Capped unread-thread previews on the room summary

**Files:**
- Modify: `apps/core/src/routes/v1/chats/rooms/room-unread.ts` (new export)
- Modify: `apps/core/src/schemas/chat-room.schema.ts`, `apps/core/src/routes/v1/chats/rooms/helpers.ts`, `apps/core/src/routes/v1/chats/rooms/get.ts`
- Test: `apps/core/src/routes/v1/chats/rooms/room-unread.test.ts`

**Interfaces:**
- Consumes: the gating SQL fragments `sqlThreadReplyPagesViewer`, `sqlMessageAttentionAt` (existing).
- Produces:
  - `export const SIDEBAR_UNREAD_THREAD_CAP = 3`
  - `export interface ChatRoomUnreadThreadPreview { parentMessageId: string; preview: string; unreadReplyCount: number }`
  - `listChatRoomUnreadThreadPreviews(roomIds, userId, tx): Promise<Map<string, ChatRoomUnreadThreadPreview[]>>`
  - Wire field `unreadThreads` on `chatRoomSchema`, consumed by Task 8.

- [ ] **Step 1: Write the failing tests**

Add to `apps/core/src/routes/v1/chats/rooms/room-unread.test.ts`:

```ts
describe("listChatRoomUnreadThreadPreviews", () => {
  it("returns the capped, ranked previews per room", async () => {
    const queryRawUnsafe = vi.fn().mockResolvedValue([
      { roomId: "room-a", parentMessageId: "p1", preview: "vendor-wide", unreadReplyCount: 2 },
      { roomId: "room-a", parentMessageId: "p2", preview: "into linear", unreadReplyCount: 1 },
    ]);
    const tx = { $queryRawUnsafe: queryRawUnsafe } as never;

    const previews = await listChatRoomUnreadThreadPreviews(["room-a"], "user_1", tx);

    expect(previews.get("room-a")).toEqual([
      { parentMessageId: "p1", preview: "vendor-wide", unreadReplyCount: 2 },
      { parentMessageId: "p2", preview: "into linear", unreadReplyCount: 1 },
    ]);
  });

  // Review Focus 3: mute gating rides the same fragment as the count.
  it("reuses the paging predicate so mute cannot drift", async () => {
    const queryRawUnsafe = vi.fn().mockResolvedValue([]);
    const tx = { $queryRawUnsafe: queryRawUnsafe } as never;

    await listChatRoomUnreadThreadPreviews(["room-a"], "user_1", tx);

    const sql = String(queryRawUnsafe.mock.calls[0]?.[0]);
    expect(sql).toContain('thread_read."mutedAt" IS NULL');
    expect(sql).toContain("chat_room_user_mention");
    expect(sql).toContain("LIMIT 3");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @sokosumi/core test -- room-unread.test.ts -t listChatRoomUnreadThreadPreviews`
Expected: FAIL — not exported.

- [ ] **Step 3: Implement**

Add to `apps/core/src/routes/v1/chats/rooms/room-unread.ts`:

```ts
/**
 * How many unread Threads a channel shows inset in the sidebar before the
 * overflow row takes over. Three, because past that the channel list stops
 * being a list of channels (ADR-0037).
 */
export const SIDEBAR_UNREAD_THREAD_CAP = 3;

export interface ChatRoomUnreadThreadPreview {
  parentMessageId: string;
  preview: string;
  unreadReplyCount: number;
}

/**
 * The top unread Threads per room, for the sidebar's inset rows.
 *
 * Ranked by newest unread reply, capped per room. Eligibility rides the same
 * `sqlThreadReplyPagesViewer` fragment the counts use, so a Thread can never
 * appear here while contributing zero to `threadUnreadCount`.
 */
export async function listChatRoomUnreadThreadPreviews(
  roomIds: readonly string[],
  userId: string,
  tx: Prisma.TransactionClient,
): Promise<Map<string, ChatRoomUnreadThreadPreview[]>> {
  const uniqueRoomIds = normalizeUniqueStrings(roomIds);
  if (uniqueRoomIds.length === 0) {
    return new Map();
  }

  const roomIdPlaceholders = uniqueRoomIds
    .map((_, index) => `$${index + 1}::uuid`)
    .join(", ");
  const userIdPlaceholder = `$${uniqueRoomIds.length + 1}`;

  const rows = await tx.$queryRawUnsafe<
    Array<{
      roomId: string;
      parentMessageId: string;
      preview: string;
      unreadReplyCount: number | bigint;
    }>
  >(
    `
    WITH unread AS (
      SELECT
        parent."roomId" AS "roomId",
        parent.id AS "parentMessageId",
        LEFT(parent.content, 120) AS preview,
        COUNT(*)::int AS "unreadReplyCount",
        MAX(${sqlMessageAttentionAt("reply")}) AS "lastUnreadAt"
      FROM "chat_room_message" reply
      INNER JOIN "chat_room_message" parent
        ON parent.id = reply."parentMessageId"
        AND parent."roomId" = reply."roomId"
      LEFT JOIN "chat_room_thread_read_state" thread_read
        ON thread_read."parentMessageId" = parent.id
        AND thread_read."userId" = ${userIdPlaceholder}
      LEFT JOIN "chat_room_read_state" room_read
        ON room_read."roomId" = reply."roomId"
        AND room_read."userId" = ${userIdPlaceholder}
      WHERE reply."roomId" IN (${roomIdPlaceholders})
        AND reply."parentMessageId" IS NOT NULL
        AND reply."deletedAt" IS NULL
        AND parent."deletedAt" IS NULL
        AND parent."parentMessageId" IS NULL
        AND ${sqlThreadReplyPagesViewer(userIdPlaceholder)}
        AND ${sqlMessageAttentionAt("reply")} > COALESCE(
          thread_read."lastReadAt",
          room_read."createdAt",
          '-infinity'::timestamp
        )
        AND (reply."senderUserId" IS NULL OR reply."senderUserId" <> ${userIdPlaceholder})
      GROUP BY parent."roomId", parent.id, parent.content
    ),
    ranked AS (
      SELECT unread.*,
        ROW_NUMBER() OVER (
          PARTITION BY unread."roomId"
          ORDER BY unread."lastUnreadAt" DESC, unread."parentMessageId" DESC
        ) AS rank
      FROM unread
    )
    SELECT "roomId", "parentMessageId", preview, "unreadReplyCount"
    FROM ranked
    WHERE rank <= ${SIDEBAR_UNREAD_THREAD_CAP}
    ORDER BY "roomId", rank
    LIMIT ${SIDEBAR_UNREAD_THREAD_CAP} * ${uniqueRoomIds.length}
  `,
    ...uniqueRoomIds,
    userId,
  );

  const byRoom = new Map<string, ChatRoomUnreadThreadPreview[]>();
  for (const row of rows) {
    const list = byRoom.get(row.roomId) ?? [];
    list.push({
      parentMessageId: row.parentMessageId,
      preview: row.preview,
      unreadReplyCount: Number(row.unreadReplyCount),
    });
    byRoom.set(row.roomId, list);
  }
  return byRoom;
}
```

- [ ] **Step 4: Carry it on the summary**

In `chat-room.schema.ts`, after `threadUnreadCount`:

```ts
    unreadThreads: z
      .array(
        z.object({
          parentMessageId: z.string(),
          preview: z.string(),
          unreadReplyCount: z.number().int().min(1),
        }),
      )
      .default([])
      .openapi({
        description:
          "Up to 3 unread Threads in this room, newest unread reply first, for the sidebar's inset rows. `threadUnreadCount` is the true total; this list is capped. ADR-0037.",
      }),
```

Add `unreadThreads?: ChatRoomUnreadThreadPreview[]` to `MapChatRoomAttentionOptions`, default it to `[]` in the destructure, and return it beside `threadUnreadCount`.

In `apps/core/src/routes/v1/chats/rooms/get.ts`, add `listChatRoomUnreadThreadPreviews(roomIds, userId, prisma)` to the existing `Promise.all` (destructure it as `unreadThreadPreviews`) and add to the summary beside the spread:

```ts
            unreadThreads: unreadThreadPreviews.get(room.id) ?? [],
```

Only the list route needs this; leave the seven single-room routes alone, since the sidebar is the only consumer.

- [ ] **Step 5: Run tests, regenerate, commit**

Run: `pnpm --filter @sokosumi/core test && pnpm --filter @sokosumi/core typecheck && pnpm --filter @sokosumi/web generate:core-client`
Expected: PASS.

```bash
git add apps/core/src apps/web/src/lib/clients/generated
git commit -m "feat(chat): list capped unread thread previews on the room summary"
```

---

### Task 8: Inset thread rows in the expanded sidebar

**Files:**
- Create: `apps/web/src/components/chat/chat-room-thread-rows.tsx`
- Create: `apps/web/src/components/chat/chat-room-thread-rows.test.tsx`
- Modify: `apps/web/src/components/chat/chat-room-sidebar-row.tsx` (render after the row's link)
- Modify: `apps/web/messages/en.json` and siblings

**Interfaces:**
- Consumes: `room.unreadThreads`, `room.threadUnreadCount` (Task 7).
- Produces: `<ChatRoomThreadRows room={...} onOpenThread={...} />`, reused by Task 9's flyout.

- [ ] **Step 1: Add the copy**

In `apps/web/messages/en.json`, under `App.Channels`, add a `ThreadRows` group:

```json
"ThreadRows": {
  "moreInThreads": "{count, plural, one {+# more in Threads} other {+# more in Threads}}",
  "unreadReplies": "{count, plural, one {# unread reply} other {# unread replies}}"
}
```

Mirror into every sibling locale with the `translations` skill.

- [ ] **Step 2: Write the failing tests**

Create `apps/web/src/components/chat/chat-room-thread-rows.test.tsx`:

```tsx
it("renders one row per unread thread", () => {
  render(
    <ChatRoomThreadRows
      room={{
        threadUnreadCount: 3,
        unreadThreads: [
          { parentMessageId: "p1", preview: "vendor-wide", unreadReplyCount: 2 },
          { parentMessageId: "p2", preview: "into linear", unreadReplyCount: 1 },
        ],
      }}
      onOpenThread={vi.fn()}
    />,
  );

  expect(screen.getAllByRole("button")).toHaveLength(2);
  expect(screen.getByText("vendor-wide")).toBeInTheDocument();
});

it("renders nothing when no thread is unread", () => {
  const { container } = render(
    <ChatRoomThreadRows
      room={{ threadUnreadCount: 0, unreadThreads: [] }}
      onOpenThread={vi.fn()}
    />,
  );

  expect(container).toBeEmptyDOMElement();
});

// Review Focus 5: the overflow row states the true remainder.
it("states the remainder beyond the cap", () => {
  render(
    <ChatRoomThreadRows
      room={{
        threadUnreadCount: 7,
        unreadThreads: [
          { parentMessageId: "p1", preview: "a", unreadReplyCount: 1 },
          { parentMessageId: "p2", preview: "b", unreadReplyCount: 1 },
          { parentMessageId: "p3", preview: "c", unreadReplyCount: 1 },
        ],
      }}
      onOpenThread={vi.fn()}
    />,
  );

  expect(screen.getByText("+4 more in Threads")).toBeInTheDocument();
});
```

Note the remainder is `threadUnreadCount - unreadThreads.length` = 7 − 3 = 4. `threadUnreadCount` counts unread *replies* while the list counts *threads*, so this number is an approximation of "more threads"; if the executor finds that misleading in review, add a `unreadThreadCount` field in Task 7 rather than fudging it here.

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter @sokosumi/web test -- chat-room-thread-rows`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement**

Create `apps/web/src/components/chat/chat-room-thread-rows.tsx`:

```tsx
"use client";

import { MessageSquare } from "lucide-react";
import { useTranslations } from "next-intl";

import type { ChatRoom } from "@/lib/clients/generated/core";

interface ChatRoomThreadRowsProps {
  room: Pick<ChatRoom, "threadUnreadCount" | "unreadThreads">;
  onOpenThread: (parentMessageId: string) => void;
}

/**
 * The unread Threads of one channel, inset under its sidebar row (ADR-0037).
 *
 * Present only while something is unread, so the sidebar returns to a list of
 * channels the moment the reader is caught up — which is why these carry no
 * persistent nav weight and need no empty state. Hidden on the collapsed rail,
 * where the same rows are the flyout's job.
 */
export function ChatRoomThreadRows({
  room,
  onOpenThread,
}: ChatRoomThreadRowsProps) {
  const t = useTranslations("App.Channels.ThreadRows");
  const threads = room.unreadThreads ?? [];
  if (threads.length === 0) {
    return null;
  }

  const remainder = Math.max(0, room.threadUnreadCount - threads.length);

  return (
    <div
      data-slot="room-thread-rows"
      className="border-sidebar-border ml-[1.1875rem] flex flex-col gap-px border-l pl-3 group-data-[collapsible=icon]:hidden"
    >
      {threads.map((thread) => (
        <button
          key={thread.parentMessageId}
          type="button"
          className="hover:bg-sidebar-accent flex items-center gap-2 rounded-md px-2 py-1 text-left"
          onClick={() => onOpenThread(thread.parentMessageId)}
        >
          <span className="bg-primary/15 text-primary inline-flex size-[1.125rem] shrink-0 items-center justify-center rounded-full">
            <MessageSquare className="size-3" />
          </span>
          <span className="text-foreground flex-1 truncate text-xs font-semibold">
            {thread.preview}
          </span>
          <span className="text-primary text-[0.6875rem] font-semibold tabular-nums">
            {thread.unreadReplyCount}
            <span className="sr-only">
              {" "}
              {t("unreadReplies", { count: thread.unreadReplyCount })}
            </span>
          </span>
        </button>
      ))}
      {remainder > 0 ? (
        <span className="text-muted-foreground px-2 py-1 pl-8 text-[0.6875rem]">
          {t("moreInThreads", { count: remainder })}
        </span>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 5: Mount it in the sidebar row**

In `apps/web/src/components/chat/chat-room-sidebar-row.tsx`, render `<ChatRoomThreadRows room={room} onOpenThread={...} />` immediately after the row's `SidebarMenuItem` closes, inside the same fragment. Wire `onOpenThread` to the same navigation the thread list panel already uses — find it with `rg -n "onOpenThread" apps/web/src/app/\(app\)/chat --glob '!*.test.*'` and reuse that handler rather than inventing a second route shape.

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter @sokosumi/web test -- chat-room-thread-rows chat-room-sidebar-row && pnpm --filter @sokosumi/web typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/chat apps/web/messages
git commit -m "feat(chat): inset unread thread rows under the channel"
```

---

### Task 9: Collapsed rail flyout

**Files:**
- Modify: `apps/web/src/components/chat/chat-room-sidebar-row.tsx` (tooltip content when collapsed)
- Test: `apps/web/src/components/chat/chat-room-sidebar-row.test.tsx`

**Interfaces:**
- Consumes: `ChatRoomThreadRows` (Task 8), `room.unreadThreads`.
- Produces: nothing downstream.

- [ ] **Step 1: Write the failing test**

Add to `apps/web/src/components/chat/chat-room-sidebar-row.test.tsx`:

```tsx
it("offers the unread threads in the collapsed rail tooltip", async () => {
  renderRow({
    collapsed: true,
    room: {
      threadUnreadCount: 2,
      unreadThreads: [
        { parentMessageId: "p1", preview: "vendor-wide", unreadReplyCount: 2 },
      ],
    },
  });

  await userEvent.hover(screen.getByRole("link", { name: /Sokosumi/ }));

  expect(await screen.findByText("vendor-wide")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @sokosumi/web test -- chat-room-sidebar-row -t "collapsed rail tooltip"`
Expected: FAIL — the tooltip holds only the room name.

- [ ] **Step 3: Implement**

The row already renders a `SidebarMenuButton` with `tooltip={room.name}` for the collapsed state. Replace that string tooltip with a node when the room has unread threads, keeping the plain string otherwise so nothing changes for a quiet room:

```tsx
  const railTooltip =
    (room.unreadThreads?.length ?? 0) > 0 ? (
      <div className="flex min-w-56 flex-col gap-1">
        <span className="text-xs font-semibold">{room.name}</span>
        <ChatRoomThreadRows room={room} onOpenThread={onOpenThread} />
      </div>
    ) : (
      room.name
    );
```

`ChatRoomThreadRows` hides itself on the collapsed rail via `group-data-[collapsible=icon]:hidden`, and the tooltip renders in a portal outside that group — verify this in the browser; if the class still applies, lift it to a `hideWhenCollapsed` prop defaulting to `true` and pass `false` here.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @sokosumi/web test -- chat-room-sidebar-row && pnpm --filter @sokosumi/web typecheck`
Expected: PASS.

- [ ] **Step 5: Verify in a browser**

Run the app, collapse the sidebar, hover a channel with an unread thread. Confirm the flyout lists the thread and that the Rail attention pill is **absent** on a channel whose only unread is a thread reply.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/chat
git commit -m "feat(chat): show unread threads in the collapsed rail flyout"
```

---

## Final verification

- [ ] `pnpm typecheck && pnpm test && pnpm lint` at the repo root, all green.
- [ ] Walk the spec's five acceptance scenarios by hand in the running app.
- [ ] Confirm `apps/apple` still builds against the regenerated OpenAPI — `unreadCount` is unchanged, but `openapi.json` moved.
