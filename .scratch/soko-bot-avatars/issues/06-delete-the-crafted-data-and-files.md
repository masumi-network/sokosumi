# 06: Delete the crafted data and files

**What to build:** Once production runs a release with 01–05, the crafted-style data is deleted: the database holds only original-style avatars and the Blob store holds no crafted stills, loops or the vendored ffmpeg copy. Spec: `../spec.md`. Decision: ADR 0064.

**Blocked by:** 05: Remove the crafted pipeline and ffmpeg

**Status:** ready-for-agent

**Branch:** its own branch stacked on the integration branch, never merged into it, opened as a second draft PR based on the integration branch. A person merges it only after 01–05 run in production. Core applies migrations at the end of its Vercel build while the old deployment still serves, so dropping these columns in the same release as 05 breaks avatar reads during the deploy and makes an instant rollback unsafe.

- [ ] A forward migration deletes crafted-style avatar rows
- [ ] It drops the render table and its enums, and the columns and unique index #6710 added to `soko_bot_avatar` (including the trait key)
- [ ] Verified on a throwaway Postgres on top of 03's migration; CI's migration checks pass
- [ ] A one-off script lists and deletes crafted stills, loops and the vendored ffmpeg copy from Blob; a person runs it with the store's token, after a dry run that prints what it would delete; it never touches `soko-bots/avatars/original/` (07's WebP avatars) or any `.png`
