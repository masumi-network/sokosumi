# A pin follows the reader across workspaces

- Status: Accepted
- Date: 2026-10-30

A pin listed only in its room's own workspace, so the rooms someone cared about most disappeared whenever they switched. A **Pinned room** now shows in every workspace, in one order, and a room of another workspace opens as a Room visit ([ADR-0061](0061-reading-a-room-never-switches-workspace.md)). Every existing pin changed meaning at once, with no data change: Personal Directs and External channels already behaved this way, and the rest now match them.

## Considered Options

- **A separate "Follow a room everywhere"** keeps a pin workspace-bound and leaves that meaning undisturbed, but adds a second personal state per room, a second menu item, and a question about which one a reader wants. Someone who wants a room everywhere has already said so by pinning it.
- **Active workspace's pins first** keeps the rooms of where the reader is on top, but moves rows on every switch, and Pinned exists so that rows stay put.
- **A subheading per workspace** names each workspace once, but adds headings to the list and rules out one order.
- **Naming the workspace on a second line**, as an Elsewhere row does, is the clearest, but makes rows uneven in a list arranged by hand. A **Workspace tile** in the room menu's column costs no name beyond what a row already gives up on hover.

## Consequences

- A reorder rewrites one list, which leaves no way back to separate orders per workspace. An existing reader's first view can look shuffled, since each workspace's rooms sort by when that sidebar was last reordered. There is no backfill; one drag fixes it.
- A reader with many pins sees all of them everywhere, and the only way to keep a room out of a workspace is to unpin it.
- Pinned beats Elsewhere: a Pinned room never takes an Elsewhere row or a place among the five, and its unread marks show on its Pinned row, so a mention in it stays in the row's fixed place rather than rising to the top. Catch up's page still lists it, because that page means everything unread elsewhere.
- Elsewhere rows now offer Pin, which a spec for ADR-0061 ruled out because it would have seemed to do nothing.
- A Pinned room stays open across any workspace switch, because the new sidebar still lists it. A room closes on a switch only when the new sidebar does not.
- Only what is on screen widens. Pinned rooms of other workspaces count in the folded Chats heading, the sidebar toggle and the tab title, and Mark all as read clears them. The written Catch up summary, open loops and the Threads view stay on the active workspace, because widening them would read another workspace's messages and bill the active one.
- The Apple apps have no Room visits yet, so they keep listing the active workspace's pins until they do, and `GET /chats/rooms` keeps its answer for them. A reorder from one of them moves only that workspace's rooms, within the places they already hold in the one order.
