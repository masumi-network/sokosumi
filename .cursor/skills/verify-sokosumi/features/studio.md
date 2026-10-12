# Content Studio

Content Studio lets a signed-in user open `/studio` and either pick a project or see that project's image studio.

## Sub-features

- `studio-open` loads `/studio` while authenticated.
- `studio-project-picker` shows **Pick a project** / **Choose a project** when `?projectId=` is missing (or the id is not visible to this workspace).
- `studio-gated` is covered by the shared app auth gate (anonymous users bounce to sign-in).

## How to get to it (user POV)

- Choose **Content Studio** in app navigation (desktop sidebar after Schedules; also on the You page).
- Open `/studio` directly. A project-scoped URL is `/studio?projectId=…`.

## Driving it with agent-browser

Preconditions:

- Signed in (see [Sign in](./sign-in.md)).
- `verify-sokosumi doctor` ok.

- **Open studio.** Run `agent-browser open $WEB_URL/studio` then `agent-browser wait --load networkidle` and `agent-browser snapshot -i`. URL stays `/studio` (not `/signin`).
- **Picker or gallery.** With no `projectId`, snapshot shows heading **Content Studio** and **Pick a project** plus **Choose a project**. That is success for a fixture user with no projects. Do not require opening the eve image gallery unless a real `projectId` is in hand.
- **Proof.** `mkdir -p .cursor/verify-sokosumi-artifacts/studio` then screenshot + snapshot.

## Gotchas

- The page has no visible product headline besides the shell `h1` / tab title **Content Studio**.
- Eve image-studio (`/eve/image-studio/…`) needs Node 24. A red Next.js issues badge from a dummy/local eve process is an environment gap, not proof the route is missing.
- Generating images is out of scope; landing + picker (or in-project gallery) only.
