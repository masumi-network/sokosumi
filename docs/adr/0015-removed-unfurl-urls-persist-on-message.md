# ADR 0015: Persist removed unfurl URLs on the message

- Status: Accepted
- Date: 2026-08-25

When a human author removes an unfurl, store that URL on the message as removed. Do not only drop the card from the current `unfurls` array. Scrapes skip a removed URL while it remains in the room message body. If the URL leaves the body, drop it from the removed set so pasting it again may unfurl.

**Why:** Content edits re-scrape every candidate URL. Drop the card alone and a typo-edit brings Ably back. Hiding it for one viewer is the wrong model. Unfurls already live on the message.

**Apply:**

- Author-only, per card, same cards for every viewer. `editedAt` stays put. This is not a body edit.
- The DTO still exposes remaining unfurls only. Clients do not need the removed set.
- No restore control this slice. Delete the URL from the body and paste it again if you want the card back.

**Rejected:** drop-from-array only, which resurrects on edit. Forever-sticky with an explicit restore. Per-user hide. Composer opt-out.

**Out of scope:** coworker-authored cards, remove-all, stream-created coworker messages. Those stream messages are never scraped today.
