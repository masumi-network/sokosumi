# Soko Bot avatars: back to the original style, crafted style removed

## Problem Statement

The crafted Soko Bot avatar style (SOKD-122, #6710/#6711) replaced the original style ten days ago. It brought an avatar studio, per-state stills and video loops, a render cron and an ffmpeg dependency. Drawing new crafted avatars is broken on main (its image model was removed; #6956 is open to fix it), ffmpeg's GitHub download has already broken deploys, and the result is more machinery than the product needs. Users who want a face for their Soko Bot now depend on a fragile multi-step pipeline.

## Solution

Every Soko Bot avatar is an original-style picture again: one still image, the same in every state. Users pick it the way they did before #6710: onboarding offers six unused avatars from a shared pool plus "show others", skipping shows the orb, and the owner can change it later in the console. Admins get the same picker. New original-style avatars are generated on demand when the picker needs them; there is no cron. Soko Bots that hold a crafted-style avatar get a random unused original-style avatar (or the orb when none is left). Once no release reads the crafted data, it is deleted.

New Sokosumi brand colours for the original style are a separate, later spec, decided with a prototype.

## User Stories

1. As a new user setting up my Soko Bot, I want to see six ready Soko Bot avatars at once, so that I can pick a face without waiting.
2. As a new user, I want a "show others" option, so that I can see more avatars when none of the first six fits.
3. As a new user, I want to skip picking an avatar, so that I can finish setup quickly and still get a distinct face (the orb).
4. As a new user, I want every avatar I'm offered to be unused, so that my Soko Bot doesn't look like anyone else's.
5. As a Soko Bot owner, I want to change my Soko Bot's avatar later from the console, so that I'm not stuck with my first pick.
6. As a Soko Bot owner whose bot has a crafted-style avatar, I want it to get an original-style avatar automatically, so that my bot never ends up without a face.
7. As a Soko Bot owner whose bot got an automatic avatar, I want to change it in the console, so that I can pick one I like.
8. As a Soko Bot owner, I want my bot's avatar to stay the same whether it's idle, thinking, working, done or needing me, so that it's recognisable everywhere.
9. As a Soko Bot owner, I want my bot's existing state cues (from before #6710) to keep working, so that I still see what it's doing.
10. As a chat participant, I want a Soko Bot's avatar in rooms, message rows, rosters and hover cards to be the same still picture, so that I recognise it.
11. As a user browsing tasks, I want Soko Bot assignees to show the same avatar, so that I can tell bots apart.
12. As a user of the sidebar, I want my Soko Bot shown with its avatar or its orb, so that it looks the same as elsewhere.
13. As a user, I want the picker to fill itself up with new avatars when the pool runs low, so that there's always a choice.
14. As a user who opens the picker when the pool is empty, I want a clear loading state while new avatars are drawn, so that I know to wait.
15. As a user, I want avatar generation to be capped per user per hour, so that one person can't run up image costs.
16. As an admin, I want to set a Soko Bot's avatar with the same picker, so that I can fix a bot's face for a user.
17. As an admin, I no longer want a studio for crafting looks, so that there's one way to set an avatar.
18. As a Mac or iPhone app user, I want Soko Bot avatars to keep showing, so that the change doesn't break the app.
19. As an operator, I want no avatar cron and no render pipeline, so that there's less to watch and less to fail.
20. As an operator, I want Core's install and runtime free of ffmpeg, so that a GitHub outage can't break deploys again.
21. As an operator, I want crafted-style data and files deleted once nothing reads them, so that the database and Blob store hold no dead data.
22. As a developer, I want the crafted columns and table gone from the schema, so that the Prisma types don't mislead me.
23. As a developer, I want the glossary to name the picture "Soko Bot avatar", so that "mascot" stays Cuso's word.

## Implementation Decisions

- **Reference point.** The original-style behaviour at the commit before #6710 is the reference: pool, picker, claim, top-up, rate cap. Restore it from history rather than rebuilding it, and keep later unrelated changes in the same files.
- **Pool offers only the original style.** The pool listing and the picker never offer crafted-style rows. Original-style rows that a crafted pick released are back in the pool.
- **On-demand generation only.** The picker's existing top-up call refills the pool (target and per-run limit as before #6710). The avatar cron and the render cron are removed from Core's Vercel config. The per-user cap of 24 generations per hour stays.
- **Image model.** Original-style generation uses the AI Gateway image model `google/gemini-3.1-flash-image` (the replacement #6956 adopts; the preview model is gone), not fal. The original-style prompt is unchanged in this spec.
- **Switch-over migration.** A forward migration claims a random unclaimed original-style avatar for every Soko Bot that holds a crafted-style one and copies its picture URL to the bot. When the pool runs short, the remaining bots lose their avatar and show the orb. It never waits for generation.
- **API.** Remove the avatar studio endpoints (drafts, keep, regenerate, for `me` and for admins) and the crafted fields (`avatar` view, `avatarState`, per-state assets). Keep `avatarImageUrl`, `avatarSeed`, the pool listing, the top-up and the claim. All removed fields are optional, so the Apple client stays compatible. Regenerate the Core client snapshot and refresh the Apple OpenAPI copy.
- **Web.** Restore the picker in onboarding, the console and admin. Remove the studio pages, the avatar loop/state components and the per-state visuals; every surface shows the still avatar or the orb. Remove the studio's translation keys in every locale.
- **Crafted code removed.** Style, drawing, media and provider modules; studio and render services; the avatar asset bundle; ffmpeg-static with its build permission, the install-time `FFMPEG_BIN` trick, CI's ffmpeg setup step and the checks that assert them; the crafted avatar env vars.
- **Data deletion, last.** After a release that no longer reads it: delete crafted-style avatar rows, drop the render table and its enums, and drop the columns and unique index #6710 added to `soko_bot_avatar` (including the trait key). Delete crafted stills and loops and the vendored ffmpeg copy from Blob with a one-off script a person runs with the store's token.
- **Docs.** The glossary entry "Soko Bot avatar" and ADR 0064 ship with the first PR. The Soko Bot deployment doc drops the crafted steps.

- **WebP for new original-style avatars (07).** The top-up stores newly drawn avatars as WebP under `soko-bots/avatars/original/`, encoded with `sharp`. Avatars in use keep their PNG.

## Testing Decisions

- A good test drives the public seam and checks what a user or client sees: which avatars are offered, what a claim changes, what the API returns. It never asserts internal calls.
- **Seam 1, Core avatar routes:** the pool listing, the top-up and the claim, with Prisma and the Gateway image model mocked beside the route. Cases: only original style is offered; top-up generates original style and respects the hourly cap; claiming and changing an avatar; crafted fields are absent. Prior art: the avatar top-up route test, the `me/avatar` claim route test and the avatar service test.
- **Seam 2, the Web picker component:** six offered plus "show others", skip leads to the orb, change from the console, admin use. Prior art: the picker exclusion test and the console test as they were before #6710, and the sidebar nav test.
- **Migrations:** applied to a throwaway Postgres with seeded rows (crafted bots with enough and with too few unused avatars; the deletion migration on top), plus CI's migration checks. No new DB-backed unit tests.
- **Contract:** Core client snapshot regenerated, Web typecheck, Apple OpenAPI refresh whose structural diff shows only removed optional fields and removed studio operations.

## Out of Scope

- New Sokosumi brand colours for the original style (separate spec after a prototype). Only newly drawn avatars will get them; avatars in use keep theirs.
- Redrawing avatars that bots already hold.
- Any change to the orb or to Cuso (CMO's mascot).
- Apple UI changes beyond the API refresh.

## Further Notes

- Before any work starts, Andreas tells Francis (author of #6710) and Patrick (#6956). #6956 is not merged.
- Related: SOKD-122 (the crafted style).
- Tickets: `issues/01`–`07`. 01–05 and 07 land together on the integration branch (one PR). 06 is built in the same run on its own branch stacked on the integration branch (a second draft PR), and is merged only after 01–05 run in production.
