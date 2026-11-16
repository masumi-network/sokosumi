# 07: A refund writes off the rest

Spec: `.scratch/cmo-polar/spec.md` (SOKD-204), story 37.

**What to build:** When an operator refunds an order in Polar's dashboard, Core removes what is left of the credits that order granted, so the refund and the balance agree. Credits already spent stay spent.

**Blocked by:** 02 A paid plan order grants a month of Project credits

**Status:** done

- [x] `order.refunded` finds every bucket granted from that order (all month indexes) and writes off its unspent remainder through the existing write-off path.
- [x] A bucket that is fully spent or already expired is left alone.
- [x] A redelivered refund writes off nothing more.
- [x] A refund for an order Core never granted from is acknowledged and reported.
- [x] The write-off shows in the organization's transaction history under its Project.
- [x] Route-level tests cover a partly spent grant, a fully spent grant, a yearly order with several monthly grants, and a redelivery.
