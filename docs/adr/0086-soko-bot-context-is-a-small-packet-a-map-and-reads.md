# A Soko Bot's context is a small packet, a map and reads

- Status: Accepted
- Date: 2026-11-25

From v38, a Soko Bot (a personal, team or Project bot, not Cuso) no longer gets a fixed dump of the board, the Coworker list and the conversation on every turn. Core builds a small packet: what every turn needs, what this kind of turn adds, and a **map** of every source with how many items exist, how many the packet shows and how to read the rest. With a version that loads skills on demand (v39, [ADR 0085](0085-skills-are-an-index-and-reads.md)), the packet goes in the turn's first message, so the system prompt stays the same between turns and the provider caches it. Cuso has had the same shape since cmo-v23 ([ADR 0084](0084-cuso-context-is-a-core-a-map-and-reads.md)).

**Why:** the harness audit of 2026-11-25 (problem 8). In the week before, 25% of Soko Bot packets hit the 48 KB cap, up to 1,534 Tasks and 231 recent turns were dropped in a fixed order, the latest answer appeared twice (inside the packet and as the latest exchange), every item carried its own `trust` label, and a dreaming or meeting-prep turn carried the same 25 to 50 KB as an owner's question, though meeting prep shows the model only the recipient. What was dropped could not be read back: there was no tool for older turns or Projects.

## What a turn sees

| Part            | What                                                                                                                                                                                                                                                                                                                                         |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| always          | trigger (who asks, route, hints), actor, credits, reminders, pending decisions, Tasks that wait on the owner (`INPUT_REQUIRED`, `APPROVAL_REQUIRED`, `AUTHENTICATION_REQUIRED`, `OUT_OF_CREDITS`, `GRANT_PENDING`; 12 at most) and the Tasks the message names, open Jobs (6), memory, Project names, the last messages of this conversation |
| by kind         | the board (16 Tasks) on work routes and when Jev says the message is about Tasks; Coworkers by name and caption (12) on routes that assign; the marketplace (24) on routes that hire; 12 turns instead of 8 when Jev says the message points back                                                                                            |
| map             | per source: `total`, `shown`, and `read` (the tool): tasks (with open, waiting on the owner and finished this week), projects, coworkers, agents, jobs, conversation, decisions, memory (bytes, bytes shown, entries per section), mail and calendar (connected providers), contacts, files, and `messages`                                  |
| latest exchange | once, after the packet; the turns it repeats are left out of the packet                                                                                                                                                                                                                                                                      |

The kind comes from Core's ids (`context-organizer.ts`), never from the message: a chat or a background run, an event, an ingest, a briefing rhythm (stand-up, Monday plan, weekly wrap, end of day, follow-ups, monthly review: their prompt lists the Tasks, mail and calendar they report on, so they get no board), dreaming (6 turns, memory), memory cleanup (memory), meeting prep (nothing: the model sees only the recipient), and a schedule the owner set (by route). The picks reuse the classifier's signals, which Jev already computes, so the organizer adds no model call and no latency.

## Reads

- Tasks: `list_tasks` (query, status, project, finished, idle days) and `get_task_status`.
- Coworkers and teammates: `find_coworkers`. Marketplace: `find_agents`.
- Mail, calendar, contacts, files and chats: the tools they already had.
- New: `read_context` with `section` conversation (earlier turns of this conversation, `before` to page back, `query` for words), projects (summaries and open Task counts) or jobs. It rebuilds the packet's own filters from the turn (`contextPacketScope`), so it never shows what the packet could not: a teammate's turn reads only that room's turns, a shared bot only its scope.
- Only a version with the `context-on-demand` skill is offered `read_context` (`applyVersionCapabilities`).

## Messages sources

`map.messages` lists where the bot can read messages beyond its own chat. Today: chat rooms (`list_chats`, `read_chat`). A new source (X DMs, Telegram) adds one entry to `SOKO_BOT_MESSAGE_SOURCES` with when it is available (the bot's ACTIVE integrations, whether the turn is the owner's) and how to read it.

## What stays

- The packet keeps its shape (`schemaVersion` 1, every collection present), so the claim check, citations, grants, evals and the admin view read it as before. Collections are shorter, items carry no empty fields and no `trust` label (the header says it once), and `sourceCoverage` gives way to `map`.
- Nothing that waits on the owner is cut silently: the map counts every waiting Task the packet does not show. On prod in the week measured, no bot had more than 3.
- The 48 KB cap and its trim order stay as a guard.
- Older versions and Cuso are unchanged: the small packet follows `readsContextOnDemand(version.skills)`.

## Considered

- **Jev picking per map item, as Cuso's organizer does:** a second model call before every turn, 120 to 370 ms. The classifier's signals already say what a typed message is about; rhythms and events are known from their ids.
- **A bigger cap and a smarter trim order:** keeps the drops invisible and the latest answer twice.
- **The whole packet behind reads:** what waits on the owner and the last exchange must be there without a call, or the bot answers "yes" to the wrong question.
