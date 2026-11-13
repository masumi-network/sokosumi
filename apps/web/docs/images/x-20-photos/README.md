# X 20-photo screenshots

Real Chromium screenshots, captured locally on 2026-11-13 at 1440 and 390 px wide.

- `preview-20-*`: X preview with 20 images, as a carousel (1440 is hovered, so the next arrow shows).
- `preview-20-end-*`: the same carousel scrolled to the last image.
- `preview-5-*`, `preview-4-*`: 5 and 4 images use the same carousel.
- `composer-20-*`: the composer with 20 attachments and the live preview.

The production `SocialPostComposerDialog` and `SocialPostPreview` were rendered in
a local Vite harness with a mocked X account and mocked uploads. They don't come
from a signed-in Project, and nothing was posted, scheduled or saved. Fixture
images come from the repo (`docs/images` fixtures and `public/studio/empty-ads`).
The capture checked the item counts, that there's no "+N" badge, no page-level
horizontal scroll, and a clean browser console at both widths.
