# Competitors

Competitors is a Marketing destination at `/competitors`. A project's competitors, and the weekly check, belong to one project. With no project in scope the page asks you to pick one.

## Sub-features

- `competitors-open` loads `/competitors` while authenticated.
- `competitors-no-project` shows heading **Pick a project** (`data-testid="competitors-no-project"`) and the body that competitors belong to one project. **Create project** may be present when the workspace has no projects. That is success when the header scope is **All projects**.
- `competitors-gated` is covered by the shared app auth gate (anonymous users bounce to sign-in).

## How to get to it (user POV)

- Choose **Competitors** in the desktop sidebar **Marketing** group (after **Ads**, before **Newsletter** when that row exists).
- Open `/competitors` directly. A project-scoped URL is `/competitors?projectId=…`.

## Driving it with agent-browser

Preconditions:

- Signed in (see [Sign in](./sign-in.md)).
- `verify-sokosumi doctor` ok.

- **Open Competitors.** Run `agent-browser open $WEB_URL/competitors` then `agent-browser wait --load load` and `agent-browser snapshot -i`. URL stays `/competitors` (not `/signin`).
- **Confirm shell.** With no project selected, snapshot shows heading **Pick a project**. **Create project** is expected when the workspace has no projects. Do not add a competitor or run a check.
- **Proof.** `mkdir -p .cursor/verify-sokosumi-artifacts/competitors` then screenshot + snapshot.

## Gotchas

- This is not the SEO audit's competitor list and not [Ads](./ads.md), which uses the same **Pick a project** heading on its own route.
- The row is always in Marketing. **Newsletter** sits after it only for the newsletter beta organization.
- The watch list, weekly check, and findings are out of scope for this landing check.
