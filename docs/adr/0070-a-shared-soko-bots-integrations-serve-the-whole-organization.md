# A shared Soko Bot's integrations serve the whole Organization

- Status: Accepted
- Date: 2026-11-17

A shared Soko Bot works for every member of its Organization ([ADR 0061](0061-cuso-is-a-shared-project-bot.md)). An account connected to it, such as a Gmail inbox, belongs to the bot, not to the member who connected it. Core finds a bot's accounts by bot only: `activeIntegrationsForBot` in `apps/core/src/services/soko-bot-integrations.service.ts` filters `SokoBotIntegration` rows by `sokoBotId` and status. So any member's turn may use them, for example `search_inbox`, and the results land in turns that every member can read. This is by design. An account connected to a shared bot is a team account, such as a public support inbox.

## Decisions

- **Integrations follow the bot, not the asker.** Any member's turn on a shared bot may read its connected accounts.
- **Everything else stays refused.** A shared bot sees only public Tasks (`buildSokoBotScopeTaskWhere`), never reads a member's Directs (`ownerDirectReader`), opens no Direct chats (`SHARED_SOKO_BOT_NO_DIRECTS`), and never sends mail (`mailSendRefusal`).

## Considered Options

- **Per-asker access.** Each turn could use only the accounts its asker connected. Rejected: shared bots exist to serve the whole team, and a team inbox would then answer only one person.

## Consequences

- A review does not flag a member reading, through a shared bot, an account another member connected. That is the intended behaviour.
- A review does flag any path that lets a shared bot reach data outside its integrations that is not public: a private room, a private Task, or a member's personal Drive.
- A member who connects a private account to a shared bot shares it with the Organization. Connect private accounts to a personal Soko Bot.
