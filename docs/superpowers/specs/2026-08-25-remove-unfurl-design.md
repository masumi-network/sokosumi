# Remove unfurl from a room message

Date: 2026-08-25  
Status: Approved  
ADR: [0015](../../adr/0015-removed-unfurl-urls-persist-on-message.md)

## Problem Statement

After a room message is sent, Core scrapes Open Graph data and attaches shared **unfurls** (link-preview cards) under the body. There is no way to take a noisy card off the message. The URL in the body is fine; the card is the problem. A typo-edit currently re-scrapes every URL, so dropping the card from the current list is not enough.

## Solution

The human author can remove **one unfurl** from their message. The card disappears for everyone. The body URL stays. The removal is sticky while that URL remains in the body. It is not a message edit, not a personal hide, and not a composer opt-out.

## User Stories

1. As the author of a room message, I want to remove one unfurl card, so that a noisy preview stops eating the transcript.
2. As another member of the room, I want that card gone for me too, so that we all see the same message.
3. As the author, I want the URL in the body to stay clickable, so that removing the card does not rewrite what I sent.
4. As the author, I want to remove only the noisy card and keep the others, so that useful previews remain.
5. As the author, I want a remove control on the card itself, so that I do not hunt through the message menu.
6. As the author on a pointer device, I want the control on hover/focus, so that cards stay quiet until I need it.
7. As the author on touch, I want the control always visible, so that I can actually hit it.
8. As the author, I want one click with no confirm and no undo toast, so that cleanup is cheap.
9. As a reader, I do not want the message marked edited when a card is removed, so that “edited” still means the body changed.
10. As the author, I want a typo-edit to leave the removed card gone, so that fixing spelling does not resurrect Ably.
11. As the author, I want pasting the URL again after deleting it from the body to be allowed to unfurl, so that I can get a card back without a restore button.
12. As a non-author, I do not want a remove control, so that I cannot rewrite someone else’s message presentation.
13. As a member looking at a coworker-authored message, I accept that those cards cannot be removed in this slice.
14. As the author of a pending or failed local send, I do not need a remove control, because unfurls have not landed.
15. As anyone looking at a deleted message, I do not see unfurls or a remove control.

## Implementation Decisions

- Nested Core action on the message (same family as reactions): `POST /v1/chats/rooms/{id}/messages/{messageId}/unfurls/remove` with `{ url }`. Returns the room message DTO. Session user only (`requireUserAuthContext`).
- Author-only, matching edit/delete. Coworker-authored → forbidden. Deleted → forbidden. Unknown URL → bad request. Already-removed URL → idempotent success.
- Persist `removedUnfurlUrls` on message metadata (ADR 0015). Do not expose that set on the DTO. `unfurls` on the DTO is the remaining cards only. Do not set `editedAt`.
- Map-time filter: even if a concurrent scrape rewrites `unfurls`, the DTO and Ably `unfurl` patch omit removed URLs.
- Scrape skips removed URLs that are still body candidates. When a URL leaves the body, drop it from the removed set so a later paste may unfurl.
- Publish Ably `unfurl` patch (not `update`) so clients replace `unfurls` without treating this as a body edit.
- Web: remove control on the card (sibling of the link, not nested inside it). Author + `onRemoveUnfurl`. Hover/focus on pointer; always visible on touch. Action + chat-room service call Core; merge the returned message like edit/delete.
- UI copy may say “link preview”; glossary term is unfurl.

## Testing Decisions

Seams (agreed):

1. **Core chat room message HTTP** — author removes by URL; DTO omits that card; `editedAt` unchanged; non-author and coworker-authored forbidden; scrape/edit with the URL still in the body does not resurrect it; URL dropped from the body then pasted again may unfurl; Ably `unfurl` patch with remaining cards. Prior art: message DELETE/PATCH tests, `reactions/post.test.ts`, `chat-room-message-unfurl.service.test.ts`.
2. **Web `ChatMessageRow` unfurl cards** — author sees remove on the card; non-author does not; click calls remove with that URL; no confirm dialog. Prior art: `room-message-row.test.tsx` Slack-style unfurl tests.

Do not unit-test hover vs touch media queries. Do not assert metadata JSON key names from HTTP tests; observe DTO `unfurls`.

## Out of Scope

- Remove-all
- Org-admin override
- Per-user hide
- Composer “don’t unfurl”
- Explicit restore button
- Coworker-authored cards
- Scheduling unfurls on coworker stream persist

## Further Notes

CONTEXT.md: **Unfurl**, **Removed unfurl**.
