# Reading a room never switches workspace

- Status: Accepted
- Date: 2026-10-30

People who work in several workspaces missed messages in the ones they did not have open, and reading one meant moving the whole app there. A room of another workspace now opens as a **Room visit**: it works in full and the active workspace stays as it is. **Elsewhere rows** tell the reader such a room holds something unread, at most five with the rest behind one row into Catch up, except that every room naming the reader always gets a row. Workspace stays the context for everything else, so the sidebar's nav, Tasks and projects still mean the active workspace.

## Considered Options

- **All Channels grouped by workspace** is what was asked for first. The list would grow with every channel of every workspace, and the reason behind the ask was not missing messages.
- **A chat with its own active workspace** gives "current workspace" two answers: a reader could write in one workspace and land in another on the next click.
- **A mark on the Workspace switcher** left the channel list alone, but in a 14rem sidebar it shortened the workspace's name, read as a count for the active workspace, and still ended in a switch.
- **A folded section per workspace** keeps one row per workspace at rest even when nothing is unread, and needs each workspace's full room list.
- **A peek popover** answers without opening the room, but shows only the unread messages and adds a surface with its own read rule.

## Consequences

- A link to any room the reader belongs to opens as a Room visit, from wherever they are. Chat notifications follow the same rule, including mentions; task and job notifications still switch.
- Inside a visit, the room's own Organization decides the member list and who may manage the room, not the active workspace. A link from the room to a task of that workspace still switches.
- The header names the room's workspace and switching there is one click, which keeps the room open. Switching anywhere else closes it, as it does for any room of the workspace being left.
- `@all` counts as naming the reader, because a mention notification does not say which kind it was. One room still takes one row however many mentions it holds.
- Mark all as read stays within the active workspace, so a mention elsewhere is never cleared from a place the reader cannot see it.
