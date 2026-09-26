# ADR 0032: Reactions are idempotent and shown before confirm

- Status: Accepted
- Date: 2026-09-17
- Supersedes: the 2026-09-14 reaction decision in [`apps/apple/PARITY.md`](../../apps/apple/PARITY.md) ("no optimistic mutation or rollback")

A **Reaction** is set, not toggled. Core exposes `PUT` and `DELETE` on `/v1/chats/rooms/{id}/messages/{messageId}/reactions/{emoji}`. `PUT` makes the Reaction exist, `DELETE` makes it gone, and repeating either returns `200` with the message and publishes no realtime event. The old blind-toggle `POST …/reactions` is removed.

Clients show a **Pending reaction** the moment the user taps. Requests for one message and emoji run one at a time and only the latest intent is sent, so on, off, on costs at most two requests. Realtime patches that replace the reaction list are applied first, then the Pending reaction is re-applied on top. A response or a failure touches only that emoji's entry: success takes the server's entry, failure rolls back to the last confirmed entry and shows the error toast. The request outlives leaving the room. The overlay is only ever shown on the message it belongs to and is cleared when the request settles, so a room you come back to mid-request still shows your intent.

**Why idempotent:** a toggle cannot be shown early safely. A retry after a timeout the server already applied flips the Reaction back, and two overlapping taps land in whichever order the network chooses. With set semantics the last intent is the end state no matter how often a request repeats.

**Why the emoji in the path:** the user, message and emoji already identify a Reaction (the unique index says so), so the URL can name it without a lookup. Both generated clients percent-encode path parameters; Core route tests cover a plain emoji, one with a variation selector, and a ZWJ sequence.

**Why `PUT`, while pin, star and mute use `POST`:** the URL names the whole resource, which is what `PUT` means. The other routes predate this and are not changed here.

**Rejected:** `DELETE` with the emoji in a JSON body (RFC 9110 gives `DELETE` content no semantics and some intermediaries reject it); `POST …/reactions/remove` with a body (works, but invents a verb in the path when HTTP has one); GitHub-style removal by reaction id (the DTO aggregates per emoji and exposes no id, and a reaction added a moment ago has no id to delete until the add returns, which defeats showing it early); keeping the toggle for Apple (no Apple build has shipped, and AGENTS.md forbids two paths).
