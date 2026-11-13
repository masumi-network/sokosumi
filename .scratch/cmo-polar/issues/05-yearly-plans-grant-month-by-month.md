# 05: Yearly plans grant month by month

Spec: `.scratch/cmo-polar/spec.md` (SOKD-204), stories 17 and 32.

**What to build:** A yearly CMO subscription is paid once a year but grants the plan's monthly credits twelve times, once a month, each grant expiring after a month. The first month comes with the paid order; a scheduled Core job grants months two to twelve. A yearly subscriber who cancelled still receives every month until the paid year ends.

**Blocked by:** 02 A paid plan order grants a month of Project credits

**Status:** done

- [x] A paid yearly order grants month index 0 only, not the whole year.
- [x] A scheduled job, modelled on the free-subscription sync, grants the monthly amount for each active yearly subscription whose next grant month has begun, keyed by the last paid order id and month index 1 to 11.
- [x] Running the job twice in the same month grants once.
- [x] The job grants nothing for a past-due or ended subscription, and keeps granting for a subscription with a scheduled cancel until its period ends.
- [x] The amount is the subscription's current tier at grant time.
- [x] A yearly renewal order starts the next twelve months from index 0.
- [x] Service tests with a fixed clock cover twelve grants, the repeat run, past due and a scheduled cancel.
