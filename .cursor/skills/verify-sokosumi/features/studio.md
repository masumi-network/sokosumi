# Content Studio

Content Studio lets a signed-in user open `/studio` and generate images. With no project in the URL it shows the workspace image studio (curated styles). A `?projectId=` that names a visible project opens that project's gallery.

## Sub-features

- `studio-open` loads `/studio` while authenticated.
- `studio-workspace` shows the image studio with no `?projectId=` — heading **Create your first image**, template chips, and the prompt composer. Fixture users with no projects land here. Do not expect the project picker on this path.
- `studio-project-picker` is a repair path: **Pick a project** / **Choose a project** (`data-testid="studio-no-project"`) when `?projectId=` is present but Core returns 404 for that id. `ProjectScopeGuard` often then clears the unknown id and lands on `studio-workspace`. Invalid UUIDs error (422) rather than picker.
- `studio-gated` is covered by the shared app auth gate (anonymous users bounce to sign-in).

## How to get to it (user POV)

- Choose **Content Studio** in app navigation (desktop sidebar after Schedules; also on the You page).
- Open `/studio` directly. A project-scoped URL is `/studio?projectId=…`.

## Driving it with agent-browser

Preconditions:

- Signed in (see [Sign in](./sign-in.md)).
- `verify-sokosumi doctor` ok.

- **Open studio.** Run `agent-browser open $WEB_URL/studio` then `agent-browser wait --load networkidle` and `agent-browser snapshot -i`. URL stays `/studio` (not `/signin`).
- **Workspace studio.** With no `projectId`, snapshot shows **Create your first image** (and usually a **Templates** region plus textbox **Describe the image…**). The shell `h1` **Content Studio** is `sr-only` (breadcrumb / tab title still say it). That is success for a fixture user with no projects. Do not require **Pick a project** / **Choose a project** on this URL. Do not require generating an image or opening a real `projectId`.
- **Proof.** `mkdir -p .cursor/verify-sokosumi-artifacts/studio` then screenshot + snapshot.

## Gotchas

- The shell `h1` / tab title **Content Studio** is not a visible product headline; the visible empty-state heading is **Create your first image**.
- The picker (`studio-no-project`) is not the empty-query landing. Opening `/studio?projectId=<unknown-uuid>` may flash the picker, then `ProjectScopeGuard` `router.replace`s to `/studio`. A non-UUID `projectId` hits Core 422 and the Web error UI (**Try again**) before the guard rewrites.
- Eve image-studio (`/eve/image-studio/…`) needs Node 24. A red Next.js issues badge from a dummy/local eve process is an environment gap, not proof the route is missing.
- Generating images is out of scope; landing + workspace studio (or in-project gallery) only.
