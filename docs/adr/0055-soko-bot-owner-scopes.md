# Soko Bots have an owner scope

A Soko Bot belonged to one user: `SokoBot.userId` was required, one live bot per user and workspace, and its API key acted as that user. Teams asked for a bot that works for a whole Organization or for one Project ([SOK-1356](https://linear.app/masumi/issue/SOK-1356/soko-bots-owned-by-an-organization-or-a-project)). Every Soko Bot now keeps its `workspaceId` and has exactly one owner scope: personal (`userId` set), project (`projectId` set) or workspace (both null). A raw-SQL CHECK allows at most one of the two columns. Project and workspace bots, called shared bots, exist only in Organization workspaces, and Core checks that a project belongs to the bot's workspace. Personal bots keep their behaviour, their unique index and their `me` routes.

A shared bot is its own principal. Its key resolves to `{ actor: "sokoBot", sokoBotId, userId: null }`, and `requireUserContext` refuses it unless a route has an explicit branch. It sees PUBLIC data in its scope only: a project bot sees its Project's public Tasks, a workspace bot sees every public Task and all Projects. Records it creates belong to the member who asked, and its Tasks are always PUBLIC. Turns, pending decisions and schedules keep a required `userId` that holds the requesting member, or the trigger's member for self-started turns. Every lookup goes by `sokoBotId`.

A shared bot is fully visible: one room, readable and postable by every member, with its memory and console readable too. Any member creates and configures it. Organization OWNER/ADMIN archive it, delete it and reset its memory. It bills the Organization credit pool, attributed to the turn's member, whose seat still gates spend. The decisions, with code evidence, are in the map [Wayfinder: Soko Bot owner scopes](https://linear.app/masumi/issue/SOK-1357/wayfinder-soko-bot-owner-scopes).

## Considered Options

- **A separate owner table or a polymorphic `ownerType`/`ownerId` pair.** It gives one column per meaning, but every existing `userId` read would move to a join, and Prisma cannot put a foreign key on a polymorphic id. Two nullable columns keep real foreign keys (`projectId` cascades on Project delete) and leave personal rows unchanged.
- **An `organizationId` on the bot.** A Workspace is already 1:1 with a user or an Organization, so the workspace says which Organization a bot belongs to. A third owner column would only repeat it.
- **The shared bot acts as its creator.** That would reuse today's key path, but the bot would then read the creator's private Tasks and stop working when the creator left. The creator is recorded in `createdByUserId` as provenance and authorizes nothing.
- **Billing at Organization level with no seat check.** Any member, including a member without a seat, could then spend the pool through a shared bot. Attributing the turn to its member reuses `resolveCreditBucketScopeContext` unchanged.
- **Private directs with a shared bot.** They would split one bot's memory between private and team conversations. One shared room keeps the full-visibility rule simple.

## Consequences

- At least 376 places read the owner `userId` (inventory in [SOK-1359](https://linear.app/masumi/issue/SOK-1359/inventory-every-userid-dependency-of-a-soko-bot); a floor). A shared bot's `userId` must be `null`, never `undefined`: Prisma drops an `undefined` filter, which silently removes the private-Task guard.
- `/v1/soko-bots/me/*` keeps meaning "my personal bot". Shared bots get `/v1/soko-bots/{id}/*` routes and a response schema with `scope`.
- `ChatRoomSokoBotParticipant.ownerUserId` becomes nullable. Installed Apple builds that predate that client may fail to decode a room that contains a shared bot, so the Apple release ships before the shared-bot flag turns on. If an older build is still in use, raise `MACOS_MINIMUM_BUILD` ([ADR 0053](0053-core-turns-away-outdated-apple-builds.md)) to that release first.
- Closing a Project archives its bots, and reopening needs a manual reactivation. A member leaving never affects a shared bot or its key, except that integrations they connected to it disconnect.
- Project roles are not part of this decision. Only Organization roles manage a shared bot.
