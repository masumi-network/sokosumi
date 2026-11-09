# 05: Remove the crafted pipeline and ffmpeg

**What to build:** Core no longer contains anything that draws, renders or encodes crafted-style avatars, and neither its install nor its runtime needs ffmpeg, so a GitHub Releases outage can't break a deploy again. Spec: `../spec.md`.

**Blocked by:** 04: One still picture everywhere

**Status:** resolved

- [x] The crafted style, drawing, media and provider code, and the studio and render services are gone
- [x] The render cron and the crafted avatar asset bundle are gone from Core's Vercel config
- [x] `ffmpeg-static` is gone from Core's dependencies, the workspace build permissions and the lockfile
- [x] Core's Vercel install command no longer sets `FFMPEG_BIN`, CI's setup no longer fetches ffmpeg, and the CI checks asserting either are removed
- [x] The crafted avatar env vars are gone from Core's config and its example env
- [x] The Soko Bot deployment doc no longer describes crafted avatars
- [x] `pnpm typecheck`, `pnpm test` and `pnpm build` pass
