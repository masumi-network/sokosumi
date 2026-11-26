# CMO strategy written in one Core step

- Status: Accepted
- Date: 2026-11-25

From cmo-v25, Core writes Cuso's strategy in one step instead of Cuso saving it call by call in an agent loop and later turns repairing it. One structured call on `openai/gpt-6.2-sol` writes the whole plan and its example posts. Core saves it through `save_strategy`, so its hard rules and review run, and adds the two calendar checks the review keeps for calendar saves. Every problem goes back in one repair call, and Core saves the answer. No finish or fix-pillars turn follows. The owner's changes to the strategy go through the same step.

**Why:** in the week to 2026-11-25, strategy work cost about $90: Write strategy 55 turns $36, Finish strategy 77 turns $44, Rewrite pieces $5.8, Fix pillars $4.5. A Write turn averaged 11 Sol calls of about 109k tokens each, mostly tool schemas and skills. 90 of 1,202 `save_strategy` calls failed, and the checks reached Cuso one save at a time. On cmo-v22/v23 most of the finishing is gone, but 6 of 10 strategies still got a separate "Fix the pillars" turn ($0.24 to $0.29 each) after a Write turn of $0.42 to $1.38.

## Decisions

- **The turn stays; the work leaves it.** The strategy turn still exists, because the hiring progress (`cmoWork`), the one-turn-per-bot lock, `afterCmoTurn` and the eval runner all read it. Its id carries a `step` segment (`cmo:strategy:<bot>:step:<time>`, or `…:patch:step:<time>` for a change), and its message is "call `write_strategy`", followed by the brief Core writes from after `The brief:`. The turn runs on the version's own model: it only calls one tool.
- **The step runs as Core background work, and the tool waits.** A sandbox tool call answers within about two minutes, and one strong call takes about one. `write_strategy` appends `cmo.strategy_step.started` to the turn's runtime log (`appendUnless`, so one step per turn), starts the step with `waitUntil` (its own 300-second invocation), and polls for `cmo.strategy_step.ended` for up to 98 seconds. A call that finds the step still writing tells Cuso to call again. A step with no end after 6 minutes counts as failed. The runtime log needs no new table, and it holds the step's model costs as `step.completed` events, so the turn's cost includes them.
- **Saves go through Cuso's own tool.** The step saves with `runtime.executeTool("save_strategy")` as child calls, the way the month writer does. Hard rules, the shape marker (`monthWriter`), owner pace, cadence changes, ad rules and the whole plan review (pillars on industry facts, main offer drift, new networks, repeats, examples, funnel and plain words) stay in one place. A fresh strategy saves `part all`; a change saves `part patch`.
- **Repairs told everything at once.** Problems from the save's refusal or review and from the calendar checks (content language, side networks) go into one repair message, and a second round gets what is left. The model answers only what changes. Core merges it by field and by entry for a fresh strategy, or saves it as one more patch for a change. Problems left after the repair are logged (`cmo_strategy_step` warning) and returned in the tool result. They never start another turn.
- **The schema's limits are kept in code.** A list or text past its limit (a campaign on five networks, a funnel stage on seven channels) is cut to it before the checks, so the first answer always reaches the real checks. Sol's first answer broke such a limit in 2 of 2 test runs. Anything else the schema refuses goes to the repair.
- **Failure hands back to Cuso.** A failed step (`cmo_strategy_step_failed` error) answers "save it yourself": the turn's message still holds the full brief, and the strategy skill is still in Cuso's prompt.

## Considered options

- **Run the step inside the tool call.** Rejected: generate, checks and repair take 90 to 150 seconds, past the sandbox runner's two minutes.
- **Drop the turn and run the step from `startStrategyTurn`.** Rejected for now: progress, locks, chaining and evals would each need a second source of "Cuso is writing".
- **One repair round only.** Tried first. On the first mainnet run, one round cleared 11 of 12 strategies. Mailchimp's rewrite of a funnel goal fixed the problems it was told about and broke a neighbouring rule. Now up to two rounds, the second told what is left or came with the fix. It runs only while problems remain and the budget allows (about $0.04 and 20 seconds).

## Consequences

- No finish or fix-pillars turn follows a step turn (`finishRound` returns -1). A strategy saved with problems left stays as saved.
- A Brand Brain fix turn stays an agent turn and patches with `save_strategy`. A change Cuso makes in chat may use `write_strategy` with `change` (the skill says so), or `save_strategy` as before.
- Two new capabilities touch code that other work owns. `write_strategy` is gated in `applyVersionCapabilities` like `write_month_pieces`, and the step's system prompt is byte-stable per version (skills only, no business), so it caches across Cusos.
