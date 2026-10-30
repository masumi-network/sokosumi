# 06: Add a coworker during a Room visit

**What to build:** On a Room visit, the add-member picker offers the Coworkers of the room's own workspace, so a reader can add one without switching there. Today the picker offers none, because the list it holds is the active workspace's and Core refuses those. Spec: `../spec.md`. Decision: ADR-0061.

**Blocked by:** 01: Room visit

**Status:** ready-for-human

- [ ] On a visit, the picker lists the Coworkers of the room's workspace, read by room rather than from the active workspace
- [ ] Adding one works and shows in the room's member list
- [ ] Coworkers of the active workspace are not offered unless the room's workspace has them too
- [ ] The picker outside a visit is unchanged
