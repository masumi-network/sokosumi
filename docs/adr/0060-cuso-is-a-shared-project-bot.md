# Cuso is a shared Project bot

Cuso was a personal Soko Bot pinned to his marketing Project, so only the person who hired him could use him, and Core needed a pinned-bot shape no other bot has. CMO is a Sokosumi wrapper: the business's people should reach the same Cuso, in CMO and in Sokosumi. Cuso is now an ordinary shared Project bot (Project set, no personal owner) in the organization [ADR 0059](0059-every-cuso-hire-gets-its-own-organization.md) creates for each hire, so every member of that organization works with him.

## Decisions

- **Every member acts in the brand's name.** A member's turn on Cuso may change the Brand Brain, strategy and reports, use the Project's social tools and answer Social comments. On any other shared bot a member's turn stays a teammate's.
- **Owners and admins commit.** Approving the strategy and starting the paid month need the organization's owner or admin role, because they spend money and publish in the brand's name.
- **The chat is Cuso's shared room.** Cuso talks in the public room every shared bot gets, with all the organization's members. Shared bots have no Direct chats, so Cuso's reports land there too.
- **CMO shows the active organization's Cuso.** A hire belongs to its Project, not to a person; the CMO hire records who hired Cuso, and a person may reach several hires through several organizations.

## Considered Options

- **Keep the pinned personal bot.** One person per Cuso, and a `soko_bot` shape (personal owner and Project together) that every personal-bot query has to filter out.
- **A plain personal bot in the hire's organization.** Drops the pin, but still serves one person.

## Consequences

- `soko_bot` keeps main's owner-scope check and its one-personal-bot-per-workspace index; the pinned-bot index and every `projectId: null` filter that hid Cuso go away.
- The CMO hire migration changes in place, which holds only while it has reached no production database; previews that applied it need `/reset-db`.
- Cuso's turns draw on the organization's credit pool: a member's turn through that member's Seat, his scheduled runs on the pool alone.
- His memory is shared by everyone who works with him, and he sees only public Tasks.
