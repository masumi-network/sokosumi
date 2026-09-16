# ADR 0030: Unfurl preview images are snapshotted, never hotlinked

- Status: Accepted
- Date: 2026-09-16

When Core scrapes an unfurl it downloads the page's preview image and stores it in Vercel Blob under the message; the card's `imageUrl` is that Blob URL. Clients never load a third-party image host directly. If the download fails (no Blob token, not an image, over 5 MB, timeout) the card keeps the source URL, which is what shipped before this decision.

**Why:** X serves link-preview images from a host that answers 403 to any browser carrying an X login cookie, so exactly the people who share X links never saw an X preview. A per-host allowlist through the Next image optimizer would have fixed X only and needed a deploy per new host. Snapshotting fixes every host at once, stops leaking our users' cookies and referers to those hosts, works identically for web and Apple, and keeps cards intact when a source image expires.

## Considered options

- **Next image optimizer with a host allowlist** — rejected. Per-host, web-only, and the optimizer is not meant to be an open proxy, so the list can never be `**`.
- **A Core image proxy route** — rejected. Every card view would cost an authenticated function call plus an upstream fetch, and the same cookie problem returns for hosts that gate by referer.

## Consequences

- Blob storage grows by one image per scraped card. Snapshots are deleted when the author removes the unfurl and when an edit re-scrapes the message. Message delete does not clean them, matching attachments today.
- Existing cards are not backfilled; they pick up a snapshot on the next edit.
