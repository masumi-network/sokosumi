# 03: Chat notifications open a Room visit

**What to build:** Clicking a chat notification for a room in another workspace starts a Room visit, so reading a chat never switches workspace. Spec: `../spec.md`. Decision: ADR-0061.

**Blocked by:** 01: Room visit

**Status:** resolved

- [x] A chat notification for another workspace's room opens the room, and the active workspace does not change
- [x] No workspace-switch notice shows for it
- [x] Task and job notifications still switch, with the usual notice
- [x] A chat notification for a room the reader has left behaves as it does today
