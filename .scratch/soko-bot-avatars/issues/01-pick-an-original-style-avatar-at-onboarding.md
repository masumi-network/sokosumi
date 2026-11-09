# 01: Pick an original-style avatar at onboarding

**What to build:** A new user setting up their Soko Bot picks a Soko Bot avatar in the original style again, as before #6710: six unused avatars at once, "show others" for more, and skipping gives the orb. When the pool runs low, opening the picker draws new original-style avatars on demand through the AI Gateway image model, within the per-user hourly cap. There is no avatar cron any more. Spec: `../spec.md`. Decision: ADR 0064. Reference behaviour: the commit before #6710.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] The pool listing offers only unused original-style avatars, never crafted-style ones
- [ ] Original-style avatars released by a crafted pick are offered again
- [ ] Onboarding shows six avatars at once and "show others" for more
- [ ] Skipping the pick finishes setup and the bot shows the orb
- [ ] Picking claims the avatar for the bot and copies its picture URL to the bot
- [ ] Opening the picker tops the pool up on demand with original-style avatars drawn by `google/gemini-3.1-flash-image` through the AI Gateway (not fal), with the pre-#6710 prompt
- [ ] The cap of 24 generations per user per hour still holds
- [ ] The picker shows a loading state while new avatars are drawn
- [ ] The avatar cron is gone from Core's Vercel config
- [ ] Core route tests cover listing, top-up (style, cap) and claim, with Prisma and the image model mocked beside the route
- [ ] The Web picker has component tests for six offered, "show others" and skip
