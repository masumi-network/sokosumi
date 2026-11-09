# 04: One still picture everywhere

**What to build:** Every surface shows a Soko Bot's avatar as one still picture, or the orb, whatever state the bot is in: sidebar, console, chat rooms and message rows, rosters, hover cards, tasks, welcome. State cues that existed before #6710 keep working. The avatar studio pages and endpoints (drafts, keep, regenerate, for `me` and admins), the per-state stills and loops, and the crafted API fields (`avatar` view, `avatarState`, per-state assets) are gone. Spec: `../spec.md`.

**Blocked by:** 02: Change the avatar in the console and admin; 03: Switch bots off crafted avatars

**Status:** ready-for-agent

- [ ] No Web surface renders per-state avatar pictures or loops
- [ ] The studio pages and their Web route are gone, and their translation keys are removed in every locale
- [ ] Core no longer serves the studio endpoints or the crafted fields; `avatarImageUrl`, `avatarSeed`, the pool listing, top-up and claim stay
- [ ] The Core client snapshot is regenerated and Web typechecks
- [ ] The Apple OpenAPI copy is refreshed; its structural diff shows only removed optional fields and removed studio operations
- [ ] Existing tests for the touched surfaces pass with the still picture or the orb
