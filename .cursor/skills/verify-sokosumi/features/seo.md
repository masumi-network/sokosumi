# SEO

SEO is a Marketing destination at `/seo`. With no audits, the page is the first-audit form (**Start your first SEO audit**, then **Add a page**). A workspace that already has audits shows the list headed **SEO audits** instead.

## Sub-features

- `seo-open` loads `/seo` while authenticated.
- `seo-empty-or-list` shows either the first-audit form or the saved-audit list. Both are success. Do not submit the form.
- `seo-gated` is covered by the shared app auth gate (anonymous users bounce to sign-in).

## How to get to it (user POV)

- Choose **SEO** in the desktop sidebar **Marketing** group (after **Social posts**, before **Ads**).
- Open `/seo` directly.

## Driving it with agent-browser

Preconditions:

- Signed in (see [Sign in](./sign-in.md)).
- `verify-sokosumi doctor` ok.

- **Open SEO.** Run `agent-browser open $WEB_URL/seo` then `agent-browser wait --load load` and `agent-browser snapshot -i`. URL stays `/seo` (not `/signin`).
- **Confirm shell.** An empty fixture workspace shows heading **Start your first SEO audit**, **Add a page**, **First page URL**, and **Continue**. A workspace with audits shows heading **SEO audits** and the saved rows. Either is success. Do not create an audit or run a check.
- **Proof.** `mkdir -p .cursor/verify-sokosumi-artifacts/seo` then screenshot + snapshot.

## Gotchas

- The sidebar label is **SEO**. This is not Social posts and not the credit-history **SEO chat** source.
- Saving a page is free. Paid checks run only when someone starts them. Both are out of scope for this landing check.
