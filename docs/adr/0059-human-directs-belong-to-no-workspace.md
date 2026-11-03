# Human Directs belong to no workspace

- Status: Accepted
- Date: 2026-10-28

A human Direct (Self Direct, 1:1 or group) used to belong to the Organization whose workspace it was started in, showed only in that workspace, and removed a member who left the Organization. People talk to the same colleagues whichever workspace they have open, so a Direct split by workspace hid conversations and could exist twice for the same people. Every Direct whose members are all human is now a Personal Direct: owned by no Organization or workspace, shown in every workspace, and kept when a member leaves an Organization. The Organization gives up the ability to cut a former member off from Directs with its people; what it must control belongs in Channels, which it owns and which still drop a leaving member.

## Consequences

- A Direct with any coworker or Soko Bot stays owned by one workspace, because that workspace pays for its AI work. It shows only there and still drops a member who leaves its Organization.
- Who a user can start a Direct with no longer depends on the active workspace: anyone they share an Organization or an External channel with, in a group across Organizations too. A started Direct stays writable after its members stop sharing anything.
- Existing human Directs with the same participants (an Org Direct beside a Personal Direct, or Org Directs in several Organizations) are merged into one Personal Direct: messages in time order, members combined, each reader's last read the latest of their copies. The merge is one-way. The oldest room survives; links, Quotes and notifications that point at a merged-away room are not redirected and open as not found, because few such duplicates are expected.
- Personal Directs and External channels count toward Catch up and unread in every workspace, with the same marks in each, and stay open across a workspace switch. Opening a notification for one opens it in the current workspace instead of switching.
- "Org Direct" is retired from the glossary.
