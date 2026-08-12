# Classic outbound delivery: pending shell, not confirm-before-paint

For classic room channel and thread POSTs (not coworker stream), the sender’s message enters the transcript immediately as a **pending message**, then becomes **confirmed** or a **failed send**. We reject waiting for the server before any bubble exists: high RTT (e.g. mobile/train) made confirm-before-paint feel broken even when the backend was fine.

**Why pending shell (not spinner-only):** Composer lock + empty timeline until the server action returns hides the user’s words for the full round-trip. A row in the chat is the product signal; composer chrome alone is not enough.

**Why not fake-confirmed:** Looking fully sent before the server accepts lies on flaky networks. Pending / failed is honest.

**Shape:**
- **Outbound delivery status:** pending → confirmed | failed (sender-local; others only see confirmed).
- **Client turn id:** one id per send chain; **Retry reuses** it (Core unique `roomId + clientMessageId`); **Remove** drops the local shell only.
- **Failed send actions:** Retry + Remove only (no in-row edit).
- **Send queue:** single-flight **per composer** (channel and thread separate); failed frees the slot; user may compose while one send is in flight or failed.
- **No durable outbox (v1):** navigation not blocked; remount loses local pending/failed; server/history/Ably are truth. Rare retype-duplicate after ambiguous failure is accepted.
- **Chrome:** subtle meta (“Sending…” / “Failed” + actions). Toast only if a failed shell cannot be shown (e.g. surface unmounted).
- **Scroll:** own pending uses the same pin-to-bottom rules as a successful own send.
- **Thread parent preview / reply count:** update only when the reply is **confirmed**.
- **Order:** pending freezes at append position; peer realtime may append after it; confirm **merges in place** — never two rows for one client turn (action result + Ably create).

**Out of scope (v1):** coworker stream rooms; session/localStorage outbox; multi-device pending sync; concurrent POSTs from one composer.

**Rejected:** confirm-before-paint + better spinner only; fake-confirmed-then-reconcile; hard composer lock for the whole RTT; one global queue for channel+thread; blocking navigation while pending.
