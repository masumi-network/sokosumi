# ADR 0009: User and Organization deletion blocks instead of canceling Stripe

- Status: Accepted
- Date: 2026-08-20
- Deciders: sokosumi core team
- Technical story: SOK-840 / SOK-842 — allowed User deletion and Organization
  deletion must succeed without canceling billing or leaving Restrict leftovers

## Context

A User can delete themselves, and an Organization owner can delete the
Organization. Today those wipes only gate a few local conditions (task payment
claims for User deletion; extra members and last workspace for Organization
deletion). They do not encode billing or in-flight work, they can 500 on
`ChatRoom.createdByUserId` Restrict, and they can leave a Stripe customer
behind — or fail the wipe when Stripe is down.

The product already has a Stripe billing portal. Canceling a subscription is
that portal, not an in-app cancel on delete.

## Decision

**Block, do not cancel Stripe.** A running subscription (paid Stripe
subscription whose status is `active`, `trialing`, `past_due`, or `unpaid`,
including `cancelAtPeriodEnd` until the period ends) refuses User deletion
(`referenceId = userId`) and Organization deletion (`referenceId =
organizationId`). An active enterprise contract refuses Organization deletion
only. This path never calls Stripe subscription cancel. Evaluate blockers for
running subscription / enterprise / in-flight land in SOK-843/844; until then
best-effort `customers.del` skips when a local running subscription remains.

**Free is not running.** A local free subscription (`plan: free`, no Stripe
subscription id) does not block deletion.

**Forfeit unused credits.** Leftover credit balance is not a blocker. When the
wipe is allowed, unused credits go away with the User or Organization.

**In-flight includes unsettled on-chain.** An in-flight Job is a non-terminal
agent status **or** a purchase whose on-chain status is not finalized
(`DISPUTED_WITHDRAWN`, `FUNDS_WITHDRAWN`, `REFUND_WITHDRAWN`,
`FUNDS_OR_DATUM_INVALID`). An in-flight Task is not `COMPLETED`, `FAILED`, or
`CANCELED`. Those refuse deletion; terminal + finalized work does not.

**After allow, the wipe must actually succeed.** User-deletion prep re-points
cheap Restrict leftovers (`Task.creatorUserId`, `ChatRoom.createdByUserId`) so
Better Auth can delete the User. Stripe customer delete for the User or
Organization is best-effort: failure is logged and does not fail the wipe.

## Rejected

- Auto-cancel Stripe (or refund) on delete
- Treating local free as a running subscription
- Blocking on leftover credit balance
- Cooling-off, scheduled deletion, anonymization, or a GDPR 30-day job
- Schema change to make `ChatRoom.createdByUserId` nullable / SetNull
