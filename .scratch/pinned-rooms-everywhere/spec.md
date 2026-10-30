# Pinned rooms in every workspace

## Problem Statement

People who work in several workspaces pin the rooms they care about most, but a pin lists only in its room's own workspace. Switching workspace takes those rooms out of the sidebar. Room visits (ADR-0061) made it possible to open a room of another workspace without switching, and Elsewhere rows show one while it holds something unread, but neither gives a reader a fixed place for a room they always want at hand.

## Solution

A Pinned room shows in the sidebar's Pinned section in every workspace, in one order the reader arranges. A room of another workspace carries a muted Workspace tile, and opening it starts a Room visit. Every existing pin behaves this way from the first load, with no opt-in and no data change.

Vocabulary is in `GLOSSARY.md`. The decision and the rejected alternatives are in ADR-0062, and the options were compared in a mock: https://claude.ai/artifact/NMZu6dqWwoRpEziz8KDB3J

## User Stories

1. As a person in two workspaces, I want my pins in the sidebar whichever workspace is active, so that the rooms I care about stay in reach.
2. As a reader with existing pins, I want them to show everywhere without doing anything, so that I do not have to set this up.
3. As a reader, I want every kind of room I pinned to show, Channels and Directs alike, including a coworker or Soko Bot Direct of another workspace, so that a pin means one thing.
4. As a reader, I want an archived room's pin to leave the list and come back when the room is restored, so that it behaves as it does today.
5. As a reader who left a workspace, I want its rooms gone from Pinned, so that the list never offers a room I cannot open.
6. As a reader, I want a room of another workspace to carry a Workspace tile, so that I can see it is not from here.
7. As a reader, I want rooms of the active workspace, and rooms shown in every workspace, to carry no tile, so that the list stays quiet.
8. As a reader, I want a Pinned row to stay one line, so that the list I arranged by hand keeps even rows.
9. As a reader, I want the tile muted at rest, so that a long list stays calm.
10. As a reader, I want the tile to show the workspace's logo or favicon, so that I recognise it as I do in the Workspace switcher.
11. As a reader of a workspace with no logo or website, I want the tile to show the initial of its name, so that it is not the same generic icon as every other such workspace.
12. As a reader, I want a room of my personal workspace to show my own avatar as its tile, so that it matches the Workspace switcher.
13. As a reader, I want the row's tooltip to give the workspace's full name, so that I can tell two workspaces with the same initial apart.
14. As a screen reader user, I want the row announced with its workspace, so that I get what the tile shows.
15. As a reader hovering a row with no count, I want the tile to give way to the room menu, so that the row does not lose more name than any other row does on hover.
16. As a reader, I want a tile beside a count to return to full colour when I hover its row, so that I can recognise it when I look closely.
17. As a reader on a touch screen, I want the tile beside the always-visible menu, so that neither covers the other.
18. As a reader in reorder mode, I want the tile just left of the drag handle, so that I can still tell rooms apart while arranging them.
19. As a reader, I want one Pinned order, the same in every workspace, so that rows do not move when I switch.
20. As a reader, I want a reorder to apply in every workspace, so that I arrange the list once.
21. As a reader with existing pins, I want the list usable from the first view even if the workspaces interleave, so that one drag puts it right.
22. As a reader, I want a room I pin to land at the end of the list, so that pinning does not disturb my order.
23. As a reader, I want opening a Pinned row of another workspace to start a Room visit, so that the active workspace stays as it is.
24. As a reader, I want that room to stay open when I switch to any workspace, so that a switch does not close a room my sidebar still lists.
25. As a reader, I want a Pinned room never to take an Elsewhere row, so that no room shows twice.
26. As a reader, I want a Pinned room not to count toward the five Elsewhere rows, so that it does not push another room out.
27. As a reader, I want a Pinned row to carry its own unread marks and inset Thread rows, so that it is an ordinary row wherever it is from.
28. As a reader, I want Pin on an Elsewhere row, so that I can keep a room I just noticed.
29. As a reader who pins from an Elsewhere row, I want the room to move to Pinned, so that it shows once.
30. As a reader who unpins a room of another workspace, I want the row to leave Pinned at once, so that Unpin does what it says.
31. As a reader who unpins a room with something unread, I want it back as an Elsewhere row, so that I still see it.
32. As a reader who unpins an open room, I want the room to stay open, so that I do not lose my place.
33. As a reader who folded Chats, hid the sidebar or moved to another tab, I want a Pinned room of another workspace counted once in that signal, so that nothing is hidden or counted twice.
34. As a reader with the Unreads filter on, I want every pin still listed, so that the filter behaves as it does today.
35. As a reader with the filter on, I want "All caught up" only when nothing on screen is unread, so that it never stands above an unread row.
36. As a reader, I want Mark all as read to clear Pinned rooms of other workspaces, so that it does not leave bold rows on screen.
37. As a reader, I want Mark all as read to leave Elsewhere rows alone, as it does today, so that a mention is not cleared from where I cannot see it.
38. As a reader, I want Catch up's page to go on listing unread rooms of my other workspaces, pinned or not, so that it stays the full list.
39. As a reader, I want the written Catch up summary, open loops and the Threads view to stay on the active workspace, so that nothing reads or bills across workspaces.
40. As a reader of the Apple apps, I want my pins to keep working as they do today, so that nothing breaks before those apps get Room visits.
41. As a reader of the Apple apps, I want a reorder there to leave my other workspaces' pins where they are, so that it does not rearrange my list on the web.
42. As someone in one workspace, I want nothing to change, so that this adds nothing for most people.

## Implementation Decisions

- **Core: the Elsewhere read also answers Pinned rooms.** It lists the reader's rooms outside the active workspace's sidebar that hold something unread or are pinned, so one read and one refetch serve Elsewhere rows, Catch up and Pinned, and no message costs a second request. The rules that decide what the active workspace lists stay as they are, so a room is never in both answers. The access rule stays: membership of the room and of its Organization. Human-only, as today.
- **Core: the room list keeps its answer.** Shipped Apple apps read it, have no Room visits, and would list rooms they cannot name or open.
- **Core: the shared visibility rule is unchanged.** The Catch up summary, open loops and Threads read through it and stay on the active workspace.
- **Core: reorder covers all the reader's pins.** Listed rooms take the places those same rooms already hold in the one order, and every other pin keeps its place. A client that lists every pin sets the whole order; a client that lists one workspace's pins rearranges only those. The rule that it never stars or unstars a room stays, as does its tolerance of a room unstarred since the read. Today it moves listed rooms to the front, so this changes it.
- **Core: the room DTO gains what a tile needs.** The Organization's logo and website beside its name, for the sidebar's rooms. Additive. Regenerate the client after.
- **Web: one list.** Pinned is the active list's pinned rooms plus the Elsewhere read's pinned rooms, sorted by the one key. Web splits that read in one place: pinned rooms go to Pinned, and unread unpinned rooms go to row selection. Catch up's page takes every unread room from it, pinned or not. A reorder writes through to both stores optimistically.
- **Web: Workspace tile.** Reuses the workspace face the Workspace switcher draws, with the initial of the name in place of the generic building icon, including when a favicon fails to load. 14px, at the size of a project row's tile. Grey and softened at rest, by a filter rather than a new color. It takes the room menu's column and fades as the menu appears; beside a count, in reorder mode or on touch it stands just left of what holds that column. A row beside a count returns it to full colour on hover. The row's accessible name and tooltip give the workspace's name.
- **Web: a room stays open if the new sidebar lists it.** The rule that decides whether a room belongs to a workspace also counts a pin, wherever that rule is used: the room page, the workspace switch and the transcript cache.
- **Web: Pin on Elsewhere rows.** The row's menu gives up its special case. The hold that keeps an open Elsewhere row must not keep a room that was just unpinned, is read, and is open.
- **Signals.** The folded Chats heading, the sidebar toggle's dot and the tab title each count a room once, now that the Elsewhere read can hold a pinned room. They count unread rooms only, so a read pin adds nothing.
- **Mark all as read.** Its targets include Pinned rooms of other workspaces, and still not Elsewhere rows.
- **Translations.** New strings in all supported locales. The personal workspace's name reuses the existing one.

## Testing Decisions

- A good test drives the feature from the outside and asserts what the reader sees or what the API answers, never how it got there.
- **Elsewhere read:** mocked-Prisma tests beside the route: a read pinned room qualifies, an unread one comes once, a muted room still does not, and a room the active workspace lists still does not. Prior art: its existing tests.
- **Reorder:** beside the route: all pins set the whole order, one workspace's pins move only within the places they hold, and an unstarred room stays unstarred. Prior art: its existing tests.
- **Chat list:** the existing chat list harness, asserting Pinned holds both sources in one order, the tile on the right rows only, no room in both Pinned and Elsewhere rows, Pin on an Elsewhere row, and Unpin's three outcomes. Prior art: the Pinned and Elsewhere list tests.
- **Row selection:** its table test gains a pinned room that takes no row and no place among the five.
- **Workspace rule:** the existing scope tests and workspace switch room tests: a pinned room stays open on a switch to a third workspace, and closes once unpinned.
- **Signals:** the tab title and sidebar toggle tests: a pinned room counts once, and a read one not at all.
- **Real browser check:** before merge, on a preview or local stack with a reader in two workspaces: a pin shows after a switch and carries a tile, a reorder holds across a switch, a visit from a Pinned row sends a message, and the tile is checked at phone width and in reorder mode, which the mock did not draw. The list also has to be checked with real logos, which the mock's placeholders cannot stand in for.

## Out of Scope

- The native Apple apps, as a separate follow-up once they have Room visits.
- Pin in the room itself, including a Room visit's header. A visit to a read room with no row is pinned by switching first.
- An opt-in, or a way to keep a pin in one workspace.
- A backfill of the existing order.
- Muting a pinned room, which still waits on Unpin.
- Moving Elsewhere rows to the Workspace tile. They keep their second line.
- Written Catch up summaries, open loops or the Threads view across workspaces.

## Further Notes

- The Elsewhere read now also loads rosters for read pinned rooms on each refetch. ADR-0061's spec already left this query unmeasured, so check it during the real browser check with a reader who has many pins.
- Two workspaces with the same initial and no logo look alike until hovered. This was accepted; a workspace color is the later fix if it matters.
