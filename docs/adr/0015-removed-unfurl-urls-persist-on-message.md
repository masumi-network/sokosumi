# ADR 0015: Persist removed unfurl URLs on the message

- Status: Accepted
- Date: 2026-08-25

When a human author removes an unfurl, persist that URL on the message as removed — do not only drop the card from the current `unfurls` array. Scrapes skip a removed URL while it remains in the room message body. If the URL leaves the body, drop it from the removed set so pasting it again may unfurl.

**Why:** Content edits re-scrape every candidate URL. Dropping the card alone would bring it back on a typo-edit. A personal hide is the wrong model: unfurls are already shared on the message.

**Apply:**

- Author-only, per card, shared with every viewer. Not a message edit (`editedAt` unchanged).
- The DTO still exposes remaining unfurls only. Clients do not need the removed set.
- No restore control this slice. Re-adding the URL after it left the body is how a card comes back.

**Rejected:** drop-from-array only (resurrects on edit); forever-sticky with an explicit restore; per-user hide; composer opt-out.

**Out of scope:** coworker-authored cards; remove-all; stream-created coworker messages (those are never scraped today).
