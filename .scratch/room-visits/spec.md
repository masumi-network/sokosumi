# Room visits and Elsewhere rows

## Problem Statement

People who work in several workspaces only see the rooms of the one they have open, so a message in another workspace goes unnoticed. Phil works in two and worries about missing important messages. When they do find out, reading the message means switching workspace, which moves the whole app: the sidebar, Tasks and projects all change just to read one chat.

## Solution

Rooms with something unread in the reader's other workspaces show up in their sidebar as **Elsewhere rows**, under Catch up. Opening one starts a **Room visit**: the room works in full while the active workspace stays as it is. Nothing is added while everything is read. At most five rows show, mentions first, except that every room naming the reader always gets a row. The rest share one row that opens Catch up, whose page lists the unread rooms of the reader's other workspaces.

Vocabulary is in `GLOSSARY.md`. The decision and the rejected alternatives are in ADR-0061.

## User Stories

1. As a person in two workspaces, I want to see a room's name and workspace in my sidebar when it has unread messages, so that I know something came in elsewhere.
2. As a person in two workspaces, I want that row to appear without reloading, so that I notice a message when it arrives.
3. As a reader, I want a row for a room that names me to always show, so that a mention is never hidden behind a cap.
4. As a reader, I want rooms that name me listed first, so that what is addressed to me is what I see first.
5. As a reader, I want other rooms ordered newest first, so that the most recent activity is nearest the top.
6. As a reader with many unread rooms elsewhere, I want at most five rows plus one overflow row, so that my own rooms stay in view.
7. As a reader, I want the overflow row to say how many rooms it holds, so that I can judge whether to look now.
8. As a reader, I want the overflow row to open Catch up, so that I can see every unread room elsewhere.
9. As a reader with nothing unread elsewhere, I want my sidebar unchanged, so that this costs me nothing when it has nothing to say.
10. As a reader, I want a muted room to get no row, so that muting keeps meaning silence.
11. As a reader, I want Personal Directs and External channels to get no row, so that a room already in my sidebar does not show twice.
12. As a reader, I want a coworker or Soko Bot Direct of another workspace to get a row, so that I do not miss what it wrote.
13. As a reader, I want a room whose only unread is a Thread reply I take part in to get a row with its number, so that it counts as it does on a room row today.
14. As a reader, I want a row from my personal workspace labelled Personal, so that it does not read like a Direct with myself.
15. As a reader, I want to open a row and stay in my current workspace, so that reading does not move the rest of the app.
16. As a reader on a Room visit, I want to reply, react, mention coworkers and use pins, so that I never need to switch just to answer.
17. As a reader on a Room visit, I want the member list to be that room's, so that mentions and the roster are right.
18. As an owner or admin of the room's Organization on a visit, I want to manage the room as usual, so that my role follows the room.
19. As a reader on a Room visit, I want the header to name the room's workspace, so that I know where I am writing.
20. As a reader on a Room visit, I want to choose that name to switch there, so that staying in that workspace is one click.
21. As a reader who switches to the room's workspace during a visit, I want the room to stay open, so that I do not lose my place.
22. As a reader who switches to a third workspace during a visit, I want the room to close, as any room of the workspace I left does, so that switching behaves the same everywhere.
23. As a reader on a Room visit, I want the sidebar's nav to keep meaning my active workspace, so that Tasks and projects do not change under me.
24. As a reader on a Room visit, I want a link to that workspace's task to switch there with the usual notice, so that I can see the task.
25. As a reader, I want a row to stay while its room is open, with its mark cleared, so that the row I am reading does not vanish under my cursor.
26. As a reader, I want a read row to leave once I move on, so that the sidebar goes back to being quiet.
27. As a reader, I want a row's menu to offer Mute and Mark as unread, so that I can deal with a noisy room from where I see it.
28. As a reader, I want no Pin on a row, so that I am not offered something that would seem to do nothing here.
29. As someone sent a link to a room I belong to in another workspace, I want it to open as a Room visit, so that a link works wherever I am.
30. As someone sent a link to a room I do not belong to, I want the same unavailable result as today, so that visits widen nothing.
31. As a reader, I want clicking a chat notification for another workspace's room to open a Room visit, so that reading a chat never switches workspace.
32. As a reader, I want task and job notifications to keep switching, so that their pages still have their workspace.
33. As a reader who folded Chats, I want the heading to count Elsewhere rows, so that folding does not hide a message.
34. As a reader who hid the sidebar, I want the toggle's dot to count Elsewhere rows, so that hiding it does not hide a message.
35. As a reader in another tab, I want the tab title to count them, so that I notice from there.
36. As a reader, I want Catch up's own count to stay as it is, so that one row does not say the same thing twice.
37. As a reader, I want Mark all as read to leave Elsewhere rows alone, so that a mention elsewhere is not cleared from where I cannot see it.
38. As a reader with the Unreads filter on, I want Elsewhere rows to stay, so that the filter does not hide what is unread.
39. As a reader, I want Catch up's page to list the unread rooms of my other workspaces by workspace, above the summary, so that I can see all of them in one place.
40. As a reader on the phone, I want the same rows on the Chats page, so that the problem is solved there too.
41. As a keyboard or screen reader user, I want rows, overflow row and header name announced with their workspace and counts, so that I get the same information.
42. As someone in one workspace, I want nothing to change, so that this adds nothing for most people.

## Implementation Decisions

- **Core: one new read.** A versioned, session-user route under the chat rooms API lists the reader's unread rooms in their other workspaces, as the sidebar's room DTO with its unread and mention counts and its Organization's name. It answers the whole list, mentions first and then newest, because Catch up needs all of it. It is human-only; coworker and Soko Bot credentials get nothing.
- **What qualifies.** The rooms the reader is a member of, not archived, not muted, not shown in the active workspace's sidebar and not shown in every workspace, with something unread by the existing room unread rule. Reuse the existing unread and mention count helpers. The rule that decides what the active workspace lists stays the one source; this read is its complement.
- **Who may see it.** Existing room access already checks the reader's membership of the room and its Organization. No new access rule.
- **Web: row selection is one pure function.** Given the ordered list it answers the rows and the overflow count: at most five, every room naming the reader included even past five. Rows are real room rows on their second line, as a guest room's host line is, without Pin.
- **What names the reader.** A room with an unread mention count above zero. `@all` counts, because a mention notification does not say which kind it was. A Direct of two counts every message toward that count, so it also passes the cap, though it draws the number and not the `@` pill, as it does today.
- **Live updates.** No polling. Every new message already sends each member a rooms-changed event on their personal control channel in any workspace, and the realtime token already covers all their rooms. The list refetches on that event, coalesced so a busy room does not cost one request per message.
- **Room visit.** The room page stops redirecting away from a room outside the active workspace. Its member list and the reader's role come from the room's Organization. The room's realtime channel is attached as for any open room.
- **Header.** The room header names the workspace on a visit, and choosing it switches through the existing workspace switch path. The room stays open across a switch to its own workspace and closes otherwise, using the rule that already keeps rooms shown in every workspace open.
- **Open room's row.** The row of the room being read stays until the reader leaves, even though the read drops it from the list.
- **Notifications.** The rule that opens a chat notification in place for rooms shown in every workspace widens to every room the reader belongs to. Task and job notifications are unchanged.
- **Signals.** The folded Chats heading, the sidebar toggle's dot and the tab title count Elsewhere rooms with the same attention rule. Catch up's own count and Mark all as read do not change.
- **Catch up.** Its page gains a plain list of other workspaces' unread rooms, by workspace, above the written summary. The summary keeps its current scope.
- **Translations.** New strings in all supported locales. The personal workspace's label reuses the existing one.

## Testing Decisions

- A good test drives the feature from the outside and asserts what the reader sees or what the API answers, never how it got there.
- **Core route:** mocked-Prisma tests beside the route, covering each qualifying rule, ordering and refusal of non-session credentials. Prior art: the chat room list and thread unread routes.
- **Chat list:** the existing chat list harness, asserting rows, cap, uncapped mentions, overflow count and the no-row cases. The selection function gets its own small table test. Prior art: the Unreads filter and Chats heading tests.
- **Room visit:** the existing workspace-switch room tests for the open and close rules, plus the room page's gate. Prior art: the room workspace switch test.
- **Notifications:** the existing notification navigation tests, extended with the in-place case and task and job cases still switching.
- **Real browser check:** before merge, on a preview or local stack with a reader in two workspaces: a message arrives live, a visit sends a message billed to the room's workspace, and a switch keeps the room open.

## Out of Scope

- The native Apple apps, as a separate follow-up.
- A setting to hide Elsewhere rows.
- Browsing or starting from a read room of another workspace, which still means switching.
- Separating `@all` from personal mentions.
- Written Catch up summaries across workspaces, including who pays for them.
- Chat mentions in the Notification Center.

## Further Notes

- Each refetch reads unread counts across all of the reader's rooms in other workspaces. The room list does the same for one workspace, but this query has not been measured, so check it during the real browser check.
- The alternatives were compared in a static mock: https://claude.ai/artifact/5wmBy7inSe7rrFBrL292MK
