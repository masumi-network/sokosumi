# 06: Delete the crafted data and files

**What to build:** Once production runs a release with 01–05, the crafted-style data is deleted: the database holds only original-style avatars and the Blob store holds no crafted stills, loops or the vendored ffmpeg copy. This must ship in a later release than 05, because dropping columns in the same release breaks the code still serving requests during the deploy. Spec: `../spec.md`. Decision: ADR 0064.

**Blocked by:** 05: Remove the crafted pipeline and ffmpeg; and 01–05 released to production (a person confirms)

**Status:** blocked (not for the `/implement-spec` run of 01–05; run on its own after the release)

- [ ] A forward migration deletes crafted-style avatar rows
- [ ] It drops the render table and its enums, and the columns and unique index #6710 added to `soko_bot_avatar` (including the trait key)
- [ ] Verified on a throwaway Postgres on top of 03's migration; CI's migration checks pass
- [ ] A one-off script lists and deletes crafted stills, loops and the vendored ffmpeg copy from Blob; a person runs it with the store's token, after a dry run that prints what it would delete
