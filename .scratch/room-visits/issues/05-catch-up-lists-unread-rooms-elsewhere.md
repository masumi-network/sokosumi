# 05: Catch up lists unread rooms elsewhere

**What to build:** Catch up's page lists the unread rooms of the reader's other workspaces, by workspace, above the written summary. This is where the overflow row lands. Spec: `../spec.md`. Decision: ADR-0061.

**Blocked by:** 02: Elsewhere rows

**Status:** ready-for-agent

- [ ] Every unread room elsewhere is listed under its workspace, with the same mark its row would show
- [ ] Opening a listed room starts a Room visit
- [ ] The list is absent when nothing is unread elsewhere
- [ ] The written summary keeps its current scope and content
- [ ] New strings exist in every supported locale
