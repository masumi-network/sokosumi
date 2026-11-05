# Newsletter

Newsletter is a Marketing destination at `/newsletter` for the newsletter beta organization only (`utxo`, `NEWSLETTER_BETA_ORGANIZATION_SLUG`). Other workspaces do not get the sidebar row, and `/newsletter` is the app 404.

## Sub-features

- `newsletter-gated-off` is the default on a cloud-agent fixture workspace: no **Newsletter** row, and `/newsletter` shows **Return home**.
- `newsletter-open` is the enabled shell: the **Newsletter** row, then `/newsletter` asks for a project and redirects to issues or settings. Reachable only in a workspace whose organization slug is `utxo`.
- `newsletter-auth` is covered by the shared app auth gate (anonymous users bounce to sign-in).

## How to get to it (user POV)

- When the active workspace is in the `utxo` organization, choose **Newsletter** in the desktop sidebar **Marketing** group (after **Social posts** when that row is present).
- Open `/newsletter` directly. Core `GET /v1/newsletter/availability` decides whether the page exists (`apps/core/src/routes/v1/newsletter/availability/get.ts`, `apps/web/src/app/(app)/newsletter/page.tsx`).

## Driving it with agent-browser

Preconditions:

- Signed in (see [Sign in](./sign-in.md)).
- `verify-sokosumi doctor` ok.

- **Gate.** Run `agent-browser open $WEB_URL/newsletter` then `agent-browser snapshot -i`. On Alice's fixture org, the URL stays `/newsletter`, the page is the app 404 (**Return home**), and the sidebar **Marketing** group has **Content Studio** and **Social posts** only. That is success for a non-beta workspace. Do not call it a missing route.
- **Enabled shell (utxo only).** If **Newsletter** is in the sidebar, open it. Expect a project prompt or a redirect to `/newsletter/issues` or `/newsletter/settings` with `?projectId=`. Do not require a sent issue.
- **Proof.** `mkdir -p .cursor/verify-sokosumi-artifacts/newsletter` then screenshot + snapshot. Record whether the gate or the enabled shell was shown.

## Gotchas

- Cloud-agent fixture Alice (`alice-fixture`) is not the `utxo` organization. The enabled editor is `verified-unreachable` there. Prerequisite: active workspace organization slug `utxo`.
- **Ads** is a different row and is always listed. Do not treat a missing **Newsletter** row as a missing **Ads** row.
- Issue editing, subscribers, and sending are out of scope for this landing check.
