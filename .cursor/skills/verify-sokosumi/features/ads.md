# Ads

Ads is a Marketing destination at `/ads`. Ad accounts belong to one project. With no project in scope the page shows sample ads and **Pick a project**.

## Sub-features

- `ads-open` loads `/ads` while authenticated.
- `ads-no-project` shows heading **Pick a project**, the body that ads belong to one project, and the sample-ad backdrop (`data-testid="ads-no-project"`). **Create project** may be present. That is success when the header scope is **All projects**.
- `ads-gated` is covered by the shared app auth gate (anonymous users bounce to sign-in).

## How to get to it (user POV)

- Choose **Ads** in the desktop sidebar **Marketing** group (after **SEO**).
- Open `/ads` directly. A project-scoped URL is `/ads?projectId=…`.

## Driving it with agent-browser

Preconditions:

- Signed in (see [Sign in](./sign-in.md)).
- `verify-sokosumi doctor` ok.

- **Open Ads.** Run `agent-browser open $WEB_URL/ads` then `agent-browser wait --load load` and `agent-browser snapshot -i`. URL stays `/ads` (not `/signin`).
- **Confirm shell.** With no project selected, snapshot shows heading **Pick a project** and sample ads (for example **Single-origin beans**). Do not require a connected ad account, and do not create a project.
- **Proof.** `mkdir -p .cursor/verify-sokosumi-artifacts/ads` then screenshot + snapshot.

## Gotchas

- **Ads** is its own row. It is not [Social posts](./social.md) and not the Content Studio empty state.
- The row is always in Marketing, including workspaces where **Newsletter** is absent.
- Connecting an account or opening a campaign is out of scope for this landing check.
