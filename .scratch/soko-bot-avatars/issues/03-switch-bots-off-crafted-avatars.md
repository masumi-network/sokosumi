# 03: Switch bots off crafted avatars

**What to build:** Every Soko Bot that holds a crafted-style avatar gets a random unused original-style avatar when this ships, so no bot keeps a crafted face. When the pool runs short, the remaining bots lose their avatar and show the orb; the switch never waits for generation. Nothing records a bot's earlier original-style avatar, so the assignment is random. Spec: `../spec.md`. Decision: ADR 0064.

**Blocked by:** 01: Pick an original-style avatar at onboarding

**Status:** resolved

- [x] A forward migration claims one random unused original-style avatar per bot holding a crafted-style one and copies its picture URL to the bot
- [x] No original-style avatar is given to two bots
- [x] Bots left over when the pool runs short have no avatar and show the orb
- [x] Crafted-style rows are released, not deleted (deletion is 06)
- [x] Verified on a throwaway Postgres with seeded rows: enough unused avatars, and too few
- [x] CI's migration checks pass
