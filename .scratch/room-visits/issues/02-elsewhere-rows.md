# 02: Elsewhere rows

**What to build:** Rooms with something unread in the reader's other workspaces appear live as Elsewhere rows under Catch up, in the sidebar and on the phone's Chats page. Opening one starts a Room visit. Spec: `../spec.md`. Decision: ADR-0061.

**Blocked by:** 01: Room visit

**Status:** ready-for-agent

- [ ] A message in another workspace's room adds its row without a reload, and without polling
- [ ] A row names the room and its workspace, with the personal workspace labelled Personal
- [ ] Rooms naming the reader come first, then newest first
- [ ] At most five rows show, except that every room naming the reader always gets one
- [ ] The rest share one row that states how many rooms it holds and opens Catch up
- [ ] Muted rooms, Personal Directs, External channels and rooms the active workspace already lists get no row
- [ ] Coworker and Soko Bot Directs of another workspace do get a row
- [ ] A room whose only unread is a Thread reply the reader takes part in gets a row with its number
- [ ] A row stays while its room is open, with its mark cleared, and leaves once the reader moves on
- [ ] A row's menu offers the normal room actions without Pin
- [ ] Rows stay with the Unreads filter on
- [ ] Someone in one workspace sees no change
- [ ] Rows and the overflow row are announced with their workspace and counts
- [ ] Core's route refuses coworker and Soko Bot credentials
- [ ] New strings exist in every supported locale
