# 08: Ending a Cuso ends his subscription

Spec: `.scratch/cmo-polar/spec.md` (SOKD-204), stories 48 to 50.

**What to build:** Start over, archive, delete and moving a Cuso to a version outside CMO end him. For a subscribed Cuso the person first confirms a message saying the subscription ends now without a refund and his credits are removed. Core then revokes the subscription at Polar and writes off his Project credits, so Polar stops charging at once. If Polar cannot be reached, nothing is ended.

**Blocked by:** 02 A paid plan order grants a month of Project credits

**Status:** ready-for-agent

- [ ] Every path that makes a Cuso stop being live revokes his non-ended Polar subscription first, then runs the existing write-off in one transaction.
- [ ] If Polar refuses or fails, the Cuso stays live, nothing is written off, and the person sees an error.
- [ ] The write-off covers plan grants and top-ups as well as Starter credits.
- [ ] Ending a Cuso without a subscription behaves as today.
- [ ] CMO's confirmation for these actions names the immediate end, no refund and the loss of credits when the Cuso is subscribed.
- [ ] A new hire after Start over has no subscription and runs the checkout again.
- [ ] Tests cover revoke-then-write-off, the Polar failure, and the unsubscribed case; a component test covers the confirmation text.
