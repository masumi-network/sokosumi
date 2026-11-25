# CMO month calendar written after payment

- Status: Accepted
- Date: 2026-11-25

From cmo-v22 Cuso's strategy holds the plan and 3 to 5 example posts. Core writes the month's full calendar after payment, sized to the bought plan, in parallel calls on `openai/gpt-6.2-sol`. Each plan promises a minimum ("At least N posts a month") that Core computes from the tier, the strategy's networks and their cadences.

**Why:** on cmo-v21 a fresh strategy took 20 to 28 minutes and $2.4 to $4.4, most of it in finish turns that filled a month of up to 900 posts one turn at a time, before the owner had paid for anything. The owner waited on a calendar they mostly never read, and the Subscribe page's "About N posts" came from whatever that calendar happened to hold.

## Decisions

- **The shape marker is `plan.monthWriter`, set only by Core.** A v22 fresh-plan or finish turn's save sets it to `{state: "examples"}`; Cuso's save schema omits the field, so he cannot set or clear it. No `monthWriter` means an old full calendar, and every reader (`cmoMonthAtLevel`, production, Subscribe, the Strategy page) keeps its old path. Live strategies are never migrated.
- **Floors come from the plan, not the calendar.** `cmoMonthFloor(channels, level)` in `@sokosumi/utils` counts the posts each network makes in 28 days at the tier's cadence (owner-set cadences cap it). Subscribe, the Strategy page and Launch show it; production reports `floor {promised, made}` and raises `cmo_month_below_floor` once when a made month falls short.
- **Core decides the slots, the model writes the words.** `cmoPlanMonthSlots` (pure, `cmo-month-slots.ts`) gives every post its day, network, format, pillar, mix kind and funnel step with largest-remainder quotas and a smooth weighted round-robin, so pillar and mix shares hold by construction on every network and every stage has posts. Only titles, briefs, visuals and claims come from the model. One chunk is one network's week (at most 24 posts); eight run at once; every chunk gets the whole pillar list with shares and the titles already used.
- **Merge checks, then repair.** After the chunks, Core checks repeats across chunks (`findRepeats` embeddings: a title like an earlier one, or a claim argued by more than three posts) and rewrites only those posts, two rounds at most. Each rewrite is told what it repeated and which points are already spent; with titles alone, NMKR's Scale month kept 27 of 504 repeats, with both it kept 5. Shares and stages hold by construction, and Core checks them again after the merge. The examples are kept word for word as calendar entries.
- **Only a paid level is written.** The writer re-reads, under its lock, that the Project pays for the level it was asked for (an active plan of that tier, or Tester credits for the top level; an eval lane's Cuso stands in for a customer). Production reads "subscribed" and the level apart, and a plan that ended between the two reads as the top level: in the local end-to-end a cancelled Starter started a Scale write.
- **Failure reuses production's machinery.** One write at a time per strategy (row lock + `startedAt` claim); a write older than 15 minutes is taken over; after three failed attempts it retries every 3 hours and raises `cmo_month_calendar_stuck`. A partial write keeps what it saved and the next write fills only the missing slots. The production cron advances the writer, so there is no dead state: the owner sees "Cuso is planning your month" until it is written. An upgrade writes the bigger plan's extra posts.

## Considered options

- **Keep Cuso writing the calendar, faster.** Rejected: the time is in the turn loop and its finish turns, not the model; and the pillar shares still drift turn by turn.
- **Write the calendar before payment in parallel.** Rejected: it still costs a whole month of words for owners who never buy, and the plan size is unknown before checkout.
- **One big model call per month.** Rejected: 900 posts do not fit one reliable output, and one failure loses the whole month.
- **Haiku or Sonnet for the chunks.** Rejected by the owner of the product: the month's words stay on Sol.

## Consequences

- Strategies get ready in minutes; the month appears a few minutes after payment instead. Measured on the real model (NMKR, entry.fyi): a strategy took 4 to 4.5 minutes and $0.47 to $0.50 on cmo-v22, against 13.6 to 23.4 minutes and $1.39 to $2.58 on cmo-v21; the month took about 2 minutes and $0.44 to $0.53 on Starter, 3 minutes and $0.67 to $0.75 on Growth, 4.5 minutes and $1.09 to $1.19 on Scale.
- Two calendar shapes live side by side until every Cuso is on cmo-v22 or later; readers branch on `monthWriter` only.
- The month's cost moves from Cuso's turns to `recordSokoBotCheckUsage` on the writer's calls, recorded in `monthWriter.costUsd`.
