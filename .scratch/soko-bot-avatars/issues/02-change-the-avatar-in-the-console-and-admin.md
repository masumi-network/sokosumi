# 02: Change the avatar in the console and admin

**What to build:** A Soko Bot owner changes their bot's Soko Bot avatar later from the console, and an admin sets a bot's avatar from admin, both with the same picker as onboarding. The avatar studio's entry points in the console and admin go; the studio itself is removed in 04. Spec: `../spec.md`. Reference behaviour: the console and admin picker before #6710.

**Blocked by:** 01: Pick an original-style avatar at onboarding

**Status:** ready-for-agent

- [ ] The console opens the picker for the owner's bot; picking replaces the bot's avatar everywhere
- [ ] Admin opens the same picker for any bot and sets its avatar
- [ ] The previous avatar goes back to the pool when a new one is picked
- [ ] No console or admin control leads to the avatar studio
- [ ] Component tests cover changing the avatar from the console and from admin
