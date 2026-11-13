# 14: Keep my plan

Spec: `.scratch/cmo-polar/spec.md` (SOKD-204), stories 26 and 27. Decisions: `docs/adr/0068-cmo-sells-its-plans-through-polar.md`.

**What to build:** An owner or admin who scheduled a downgrade can take it back. Choosing the current tier while a downgrade is pending clears the pending change at Polar instead of being refused, the pending tier is cleared on the subscription, and Settings shows a "Keep my plan" action beside the pending notice, only for viewers who may manage billing. First verify in Polar's current docs and SDK that a scheduled plan change can be cleared. If it cannot, do not fake it: keep the refusal, make Settings say plainly that a pending downgrade cannot be undone, and report it as a follow-up.

**Blocked by:** 10 The subscription gate and existing Cusos, 11 Change plan and open the portal

**Status:** ready-for-agent

- [ ] Polar's current docs and the installed SDK are checked for a way to clear a scheduled plan change; the finding is in the report.
- [ ] Choosing the current tier while a downgrade is pending clears the pending change at Polar and the pending tier on the subscription row.
- [ ] Choosing the current tier with nothing pending is still refused with the same reason.
- [ ] Only owners and admins may do it; the route answers 503 without Polar configuration.
- [ ] Settings shows "Keep my plan" beside the pending-downgrade notice, only when the viewer may manage billing.
- [ ] Grants after the kept plan use the current tier, not the cleared downgrade.
- [ ] The core client snapshot is regenerated.
- [ ] Route-level tests cover clearing a pending downgrade, the unchanged refusal when nothing is pending, and the role check; a component test covers Settings.
- [ ] If Polar cannot clear a scheduled change: the refusal stays, Settings says plainly that a pending downgrade cannot be undone, and the report names it as a follow-up.
