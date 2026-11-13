# X 20-photo screenshots

Real Chromium screenshots at 1440 × 1000 and 390 × 1000, captured locally on
2026-11-13. `composer-*.png` shows eight attached images; `preview-*.png`
shows the real X preview with four visible tiles and a `+4` overlay.

These are **component-harness screenshots with mocked data**, not an authenticated
Project or a connected X account. `verify-sokosumi doctor` found no local Core/Web
stack, no configured sign-in credentials, and no `agent-browser` executable.

The temporary Vite harness imported the production `SocialPostComposerDialog`,
`SocialPostPreview`, modal, media chips, styles, translations, and date formats.
Playwright selected eight existing repository photos through the real composer
file input. The mocked Drive uploader returned local fixture URLs; mocked session
and Core reads supplied a single active X connection. All mutation functions
threw if called. Next Image/Link used local browser adapters; the browser used
its sans-serif fallback rather than Next's downloaded Inter font. Account
settings, Drive picker, quote picker, and document viewer were inert harness
stubs. No post was published, scheduled, or saved to an account.

The capture checked eight composer attachments, the `+4` preview, loaded images,
and a clean browser console at both widths. Harness files remain in the ignored
`.cursor/verify-sokosumi-artifacts/x20/harness/` directory for this worktree.
The local Vite server and Chromium were stopped after capture.
