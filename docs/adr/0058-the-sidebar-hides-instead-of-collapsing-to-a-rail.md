# The sidebar hides instead of collapsing to a rail

- Status: Accepted
- Date: 2026-10-27
- Linear: [SOK-1488](https://linear.app/masumi/issue/SOK-1488) (spec [SOK-1487](https://linear.app/masumi/issue/SOK-1487))

On desktop the App chrome sidebar used to collapse to a 48px icon rail. A reader who wanted the full width for a Task, a Channel or a document still had a strip of 32px squares beside it, and the rail needed rules of its own that the expanded list did not: the Rail attention pill, the Rail selection bar, Rail section headers, Rail actions, the Channel tile, name tooltips and the inset Thread flyout. The glossary recorded those as decided, not oversights.

The sidebar now either shows in full or hides completely, as Linear's does. A sidebar toggle at the start of the top bar shows and hides it, ⌘B / Ctrl+B still toggles it, and the choice persists as before. While it is hidden the toggle carries a dot whenever any chat has something unread — the signal the phone's Chats tab already shows — so hiding the sidebar never hides a message. Everything that existed only for the rail is gone, and with it the glossary terms above. The phone sheet is unchanged.

This reverses the rail decisions on purpose without contradicting their reasoning: each one solved a problem the rail created, and with no rail the problems are gone.

## Considered Options

- **Keep the rail and add a hidden state.** Three states to toggle through, and every rail rule kept alive for a mode few readers would choose.
- **Hide the sidebar without an unread signal.** Simpler, but a reader who hides the sidebar would stop seeing that a Direct is waiting, which the rail's attention pill used to tell them.

## Consequences

- A window narrower than 1024px starts with the sidebar hidden rather than on the rail; opening it there is still a look, not a stored preference.
- Losing the rail costs a rail user at most one click, from the same corner.
