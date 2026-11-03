# 05: Catch up lists unread rooms elsewhere

**What to build:** Catch up's page lists the unread rooms of the reader's other workspaces, by workspace, above the written summary. This is where the overflow row lands. Spec: `../spec.md`. Decision: ADR-0061.

**Blocked by:** 02: Elsewhere rows

**Status:** resolved

- [x] Every unread room elsewhere is listed under its workspace, with the same mark its row would show
- [x] Opening a listed room starts a Room visit
- [x] The list is absent when nothing is unread elsewhere
- [x] The written summary keeps its current scope and content
- [x] New strings exist in every supported locale
