# Content Studio

Content Studio lets a signed-in user open `/studio` and generate images. With no project in the URL it shows the workspace image studio (curated styles). A `?projectId=` that names a visible project opens that project's gallery.

## Sub-features

- `studio-open` loads `/studio` while authenticated.
- `studio-workspace` shows the image studio with no `?projectId=` — heading **Create your first ad**, the floating ad preview canvas, the prompt composer with an **Ad templates** menu, **Choose what to make**, and a **Select project** button (`data-testid="studio-no-project"`). When the catalog includes video models, the composer also shows **Image** / **Video**. Fixture users with no projects land here. That button is not the headings **Pick a project** / **Choose a project**.
- `studio-project-picker` is the same **Select project** control when `?projectId=` is present but Core returns 404 for that id (`pickUnavailable` body, still `data-testid="studio-no-project"`). `ProjectScopeGuard` often then clears the unknown id and lands on `studio-workspace`. Invalid UUIDs error (422) rather than picker.
- `studio-gated` is covered by the shared app auth gate (anonymous users bounce to sign-in).

## How to get to it (user POV)

- Choose **Content Studio** in the desktop sidebar **Marketing** group (after the **Records** group, before **Social posts**; also on the You page).
- Open `/studio` directly. A project-scoped URL is `/studio?projectId=…`.

## Driving it with agent-browser

Preconditions:

- Signed in (see [Sign in](./sign-in.md)).
- `verify-sokosumi doctor` ok.

- **Open studio.** Run `agent-browser open $WEB_URL/studio` then `agent-browser wait --load networkidle` and `agent-browser snapshot -i`. URL stays `/studio` (not `/signin`).
- **Workspace studio.** With no `projectId`, snapshot shows **Create your first ad**, a **Select project** button, **Choose what to make**, and the **Describe the ad you want to create…** textbox with an **Ad templates** button. The shell `h1` **Content Studio** is `sr-only` (breadcrumb / tab title still say it). That is success for a fixture user with no projects. Do not require the headings **Pick a project** / **Choose a project** on this URL. Do not require generating an image or opening a real `projectId`.
- **Explore the canvas.** Drag previews diagonally. The composer stays in place. Click **Choose what to make**, confirm the nine choices, and choose one to fill the brief. Use **Other** to return to the existing brief.
- **Proof.** `mkdir -p .cursor/verify-sokosumi-artifacts/studio` then screenshot + snapshot.

## Gotchas

- The shell `h1` / tab title **Content Studio** is not a visible product headline; the visible empty-state heading is **Create your first ad**.
- Bare `/studio` already shows **Select project** (`studio-no-project`). That is the scope button, not the headings **Pick a project** / **Choose a project**. Opening `/studio?projectId=<unknown-uuid>` may flash that same control, then `ProjectScopeGuard` `router.replace`s to `/studio`. A non-UUID `projectId` hits Core 422 and the Web error UI (**Try again**) before the guard rewrites.
- Eve image-studio (`/eve/image-studio/…`) needs Node 26. A red Next.js issues badge from a dummy/local eve process is an environment gap, not proof the route is missing.
- **Image** / **Video** shows only when the catalog has video models. Landing proof stays on the image empty state. Generating an image or a video is out of scope.
