# Remove unfurl from a room message

Date: 2026-08-25  
Status: Approved  
ADR: [0015](../../adr/0015-removed-unfurl-urls-persist-on-message.md)

## Problem Statement

After a room message is sent, Core scrapes Open Graph data and attaches shared unfurls under the body. Those are the link-preview cards. There is no way to take a noisy one off. The URL in the body is fine. The card is the problem. A typo-edit currently re-scrapes every URL, so dropping the card from the current list is not enough.

## Solution

The human author can remove one unfurl from their message. The card disappears for everyone. The body URL stays. The removal is sticky while that URL remains in the body. This is not a message edit. It is not a personal hide. It is not a composer opt-out.

## User Stories

1. As the author of a room message, I want to remove one unfurl card, so that a noisy preview stops eating the transcript.
2. As another member of the room, I want that card gone for me too, so that we all see the same message.
3. As the author, I want the URL in the body to stay clickable, so that removing the card does not rewrite what I sent.
4. As the author, I want to remove only the noisy card and keep the others, so that useful previews remain.
5. As the author, I want a remove control on the card itself, so that I do not hunt through the message menu.
6. As the author on a pointer device, I want the control on hover or focus, so that cards stay quiet until I need it.
7. As the author on touch, I want the control always visible, so that I can actually hit it.
8. As the author, I want one click with no confirm and no undo toast, so that cleanup is cheap.
9. As a reader, I do not want the message marked edited when a card is removed, so that "edited" still means the body changed.
10. As the author, I want a typo-edit to leave the removed card gone, so that fixing spelling does not resurrect Ably.
11. As the author, I want pasting the URL again after deleting it from the body to be allowed to unfurl, so that I can get a card back without a restore button.
12. As a non-author, I do not want a remove control, so that I cannot rewrite someone else's message presentation.
13. As a member looking at a coworker-authored message, I accept that those cards cannot be removed in this slice.
14. As the author of a pending or failed local send, I do not need a remove control, because unfurls have not landed.
15. As anyone looking at a deleted message, I do not see unfurls or a remove control.

## Implementation Decisions

- Nested Core action on the message, same family as reactions. `POST /v1/chats/rooms/{id}/messages/{messageId}/unfurls/remove` with `{ url }`. Returns the room message DTO. Session user only (`requireUserAuthContext`).
- Author-only, matching edit and delete. Coworker-authored is forbidden. Deleted is forbidden. Unknown URL is a bad request. Already-removed URL is idempotent success.
- Persist `removedUnfurlUrls` on message metadata. ADR 0015. Do not expose that set on the DTO. `unfurls` on the DTO is the remaining cards only. Do not set `editedAt`.
- Filter at map time. Even if a concurrent scrape rewrites `unfurls`, the DTO and Ably `unfurl` patch omit removed URLs.
- Scrape skips removed URLs that are still body candidates. When a URL leaves the body, drop it from the removed set so a later paste may unfurl.
- Publish an Ably `unfurl` patch, not `update`, so clients replace `unfurls` without treating this as a body edit.
- Web: remove control on the card, sibling of the link, not nested inside it. Author plus `onRemoveUnfurl`. Hover or focus on pointer. Always visible on touch. Action and chat-room service call Core, then merge the returned message like edit and delete.
- UI copy may say "link preview". Glossary term is unfurl.

## Testing Decisions

Seams agreed:

1. Core chat room message HTTP. Author removes by URL. DTO omits that card. `editedAt` unchanged. Non-author and coworker-authored forbidden. Scrape or edit with the URL still in the body does not resurrect it. URL dropped from the body then pasted again may unfurl. Ably `unfurl` patch with remaining cards. Prior art: message DELETE and PATCH tests, `reactions/post.test.ts`, `chat-room-message-unfurl.service.test.ts`.
2. Web `ChatMessageRow` unfurl cards. Author sees remove on the card. Non-author does not. Click calls remove with that URL. No confirm dialog. Prior art: `room-message-row.test.tsx` Slack-style unfurl tests.

Do not unit-test hover vs touch media queries. Do not assert metadata JSON key names from HTTP tests. Observe DTO `unfurls`.

## Out of Scope

- Remove-all
- Org-admin override
- Per-user hide
- Composer "don't unfurl"
- Explicit restore button
- Coworker-authored cards
- Scheduling unfurls on coworker stream persist

## Further Notes

CONTEXT.md terms: Unfurl, Removed unfurl.
