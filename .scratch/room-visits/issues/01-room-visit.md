# 01: Room visit

**What to build:** A room the reader belongs to in another workspace opens as a Room visit, from a link or an address, while the active workspace stays as it is. The room works in full, and its header names the workspace it belongs to. Spec: `../spec.md`. Decision: ADR-0061.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] A link to a room in another workspace opens it, and the Workspace switcher still shows the active workspace
- [ ] A room the reader does not belong to stays unavailable, as it is today
- [ ] Replying, reactions, mentions and pins work on a visit, and a message is charged to the room's workspace
- [ ] The member list is the room's, and the reader's role in the room's Organization decides who may manage it
- [ ] The header names the room's workspace on a visit, and not in the reader's own workspace
- [ ] Choosing that name switches there and keeps the room open
- [ ] Switching to any other workspace closes the room
- [ ] The sidebar's nav keeps meaning the active workspace
- [ ] A link to that workspace's task still switches, with the usual notice
- [ ] New strings exist in every supported locale
