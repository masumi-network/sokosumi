# Cuso's context is a core, a map and reads

- Status: Accepted
- Date: 2026-11-25

From cmo-v23, Cuso (CMO.xyz's Soko Bot) no longer gets the whole Brand Brain, strategy and 31 days of calendar on every turn. Before each turn Core builds a small fixed **core**, adds what this kind of turn needs (the **picked** part), and gives him read tools for everything else. A strategy turn still sees the whole fitted context, because it rewrites the plan and its calendar.

**Why:** the owner, 2026-11-25: "cuso should have a read before the actual turn that organizes the context and adds whats relevant. obviously cuso should be able to request more info via tools and all. but the core stuff should not be this much." Before this, `loadCmoMarketingContext` pushed about 28 KB of marketing on every turn and shed detail in a fixed order to fit 32 KB. A big month once overflowed the 48 KB packet and every turn failed (SOKD-306), and the shed parts were out of reach: Cuso had no tool to read a calendar range, a strategy part, a report or a Brand Brain section back.

## What a turn sees

| Part   | What                                                                                                                                                                                                                                                                       | Size                       |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| core   | business, today, what this turn is for, the strategy's month, approval, goals, pillars, mix and channels in one line each, subscription and plan, connected networks, writing skill ids, and `map`: every stored item with its id, what it is, how to read it and its size | about 5 KB on NMKR's month |
| picked | the kind's own items, then what Jev picks from the map, each with why, cut to the kind's budget (10 to 20 KB); a calendar week too big for it shows short lines and says how many more and how to read them                                                                | 0 to 16 KB                 |
| reads  | `read_calendar`, `read_strategy`, `read_brand_brain`, `read_report`, `read_competitor_moves`, beside the existing `get_social_post`, `list_social_posts` and `read_file`                                                                                                   | 24 KB per call at most     |

## Code for plumbing, Jev for judgement

`cmo-context-organizer.ts` reads the turn's kind from Core's own ids, never from the message: a production run (`cmo:production:`), a strategy turn (`cmo:strategy:` or the monthly strategy rhythm), a rhythm by its schedule's key, a competitor or SEO event, an owner chat, any other event. Each kind always gets the same items (a production run: the brand's essentials, look and pictures, the industry research and the site's pages; a daily run: this week, the brand, competitor moves, industry; a weekly review: last week, the lessons, measurement, the newest reports).

For chats, events and rhythms Jev then reads the message and Cuso's previous reply against the map: one boolean question per map item, in one call, the same model and call shape as the turn classifier. Items above 0.5 come in by probability, six at most. Jev has 4 seconds; when it fails or is slow, the turn gets the brand's essentials, this week and the newest report, and never fails. What was picked, its bytes, why, and Jev's time are on the turn's context packet (`workspace.marketing.organizer`) and in the `cmo_context_organized` event.

## What stays

- Checks read Core data, never the packet: the plan review, the claim and number checks, `cmoPieceReady` and production's own brief, which lists every piece it must make.
- A teammate's question still gets no plan, and the read tools refuse it too. A Cuso reads only his own Project.
- `save_strategy part pieces` merges by id as before. A non-strategy turn on cmo-v23 that saves the whole calendar keeps every entry it did not send (`cmoTurnSawNoCalendar`), since it may never have read them; a strategy turn keeps today's 31-day window.
- Older Cuso versions are unchanged: the organizer and the read tools follow the version's `cmo-context-on-demand` skill.

## Tools for this turn (cmo-v24)

The owner, 2026-11-25: Cuso "should always be able to call all tools but it should get them highlighted somehow". From cmo-v24 (skill `cmo-tool-highlights`):

- The core names the kind's tools (`core.toolsForThisTurn`, `CMO_KIND_TOOLS`). Nothing is removed.
- `save_strategy` (25 KB of schema) and `save_brand_brain` (42 KB) come in a short form (a one-paragraph description and `{shortForm: true, what}`) on turns that rarely save: a chat or event that Jev does not read as a change request. Production, strategy, daily, weekly and brand turns, a change request, and a turn Jev could not read get the full tools from the start. Jev's change read is one more question in the organizer's call (`organizer.change`).
- A short-form call saves nothing: Core answers it in `runTurnTool` (and records the call as a runtime event), the call ends the round, and the next round offers the full tool for the rest of the turn. Both runtimes do it the same way (`lib/soko-bot/short-forms.ts`). The AI SDK can narrow the active tools per step but not change a tool's schema mid-call, so the swap happens between rounds.

## Considered

- **A bigger budget and better shedding:** keeps the overflow risk and still hides what was shed.
- **A model call that writes the context:** slower, costs more and can drop what a check needs. Picking ids from a map keeps every byte Core-made.
- **Removing tools per turn:** the tool schemas are about 228 KB on a chat turn against a 28 KB marketing context. Removing tools would change what Cuso can do in a turn; cmo-v24 keeps every tool callable and shortens only the two biggest.
