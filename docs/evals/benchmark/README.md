# Owner benchmark results

The owner benchmark measures whether Soko Bot and Cuso finish real, multi-step owner requests end to end. Its journeys, checks and runner are described in [`docs/agents/evals.md`](../../agents/evals.md#owner-benchmark); the journeys live in `apps/core/src/services/evals/ownerbench/`. This folder keeps every measurement so later runs have a baseline to compare against.

## What a run measures

- **Journeys.** Each journey is a short chain of steps: an owner message, a Coworker answering on its Task, or the bot's own schedule firing. Code checks every step (tools, answer, and what was saved: schedules, Tasks, images, drafts, tables). A judge then grades the whole chain. A journey passes when every step's checks pass and the judge passes it.
- **Dev set.** 18 journeys in the repository (11 Soko Bot, 7 Cuso), one repeat each. Builders may read and debug them.
- **Held-out set.** 10 journeys kept outside every checkout, three repeats each. Nobody tunes to it. Files here report it as totals only: pass^3, pass^1, steps right, lost passes, tokens per turn and the verdict. No ids, titles, checks or judge notes.
- **Real-Jev plan runs.** A decision run uses `pnpm evals:local --plan` with `SOKO_BOT_PLAN_REAL_JEV=1` (the `--plan` default). The agent and judge run on the ChatGPT plan. Only Jev (`typesafe-ai/jev`, routing and the context organizer) goes to the AI Gateway, as it does in production. Each result is labelled `jev: "real"` or `"stand-in"`, and a comparison counts only results labelled real. A run that fell back to the stand-in is labelled and rerun.

## The fleet bar

A new default version must, on **both** sets, against the current default on the same pin:

- pass at least as many journeys (dev: passed; held-out: pass^3)
- have a pass^1 share and steps right no lower
- score every repeat (no ERROR), as many on both sides
- lose no journey the baseline passed
- use no more input tokens per turn

`scripts/ownerbench-compare.mts` prints the verdict per set. A dev gain with a held-out drop is overfitting and fails the bar.

## Reading a result

- **Passed / pass^1 / pass^3.** Dev counts journeys passed in one repeat. Held-out pass^3 counts journeys that passed all three repeats; pass^1 is the share of all repeats that passed.
- **Steps right.** Steps whose checks all passed, summed over the set (held-out: mean per repeat). A journey can fail with every step right when the judge fails it ("judge-only fail").
- **ERROR.** An infrastructure failure: routing unavailable, organizer failed, lane not clean. ERROR is unscored and never counts as a pass or a regression, but the bar needs every repeat scored.
- **Tokens per turn.** Input tokens per model turn, cached included, averaged over the set.
- **Failure causes.** Each failed dev journey is classed by its first real cause: stopped early, wrong Jev route, tool or Core error, false claim, judge-only, timeout, grader bug, or acted before asking.

## World validation (B2)

A journey can fail a bot for reasons outside the bot: a missing account, a fixture file that isn't readable yet, a check that a correct answer can't meet, or work left over from the last case. World validation tests the world and the grader before any bot run, with no model at all, and runs on every pin before a batch.

`OWNERBENCH_WORLD_CHECK=noop|reference` runs a journey through the real runner and Core:

- The agent is a script, a mock model whose tool calls take the same path as the model's.
- Jev answers come from the script.
- The judge is off, so only the code checks count.

Core ignores the switch on a deployment. The driver refuses a database that isn't local, and it sets every model, media, search, mail and payment key to a dummy, so a call it missed fails loudly. Run it with:

```
pnpm --filter @sokosumi/core ownerbench:world-check [--suite …] [--cases …] [--modes noop,reference] [--passes 2] [--holdout FILE --scripts FILE] [--json-out FILE]
```

Every journey must hold three things:

1. **A do-nothing agent fails.** Every turn answers "OK" and calls no tools. If a journey still passes, its checks don't need the work done (a grader bug).
2. **A reference run passes.** A script of the tool calls a correct bot makes must pass every check. If it can't, the world or the grader is broken.
   - Dev scripts live in `apps/core/src/lib/evals/reference-scripts.ts`.
   - Held-out scripts stay with the evaluator and load with `--scripts`.
   - A script follows Core's rules like any bot. For example, it asks when two accounts fit and none is named exactly, and a Coworker hand-off carries `followUp` and `followUpAllows` so its wake may draft and make images.
3. **A rerun gives the same result.** Each journey runs twice in a row and must give the same checks both times. At the first agent step, after the runner's reset and before the agent acts, the lane must hold nothing from earlier work:
   - open turns
   - WAITING watches
   - unfinished image jobs
   - older open posts or tables

A run that didn't finish, has no checks, errored for any reason other than the judge being off, or whose script threw is **invalid**, never a pass. A journey without a script is **uncovered**. The driver exits 1 on any problem. Held-out journeys print as counts only, and per-case detail goes to the evaluator's `--json-out` file.

A journey that fails B2 is fixed in the world, the grader or the journey before it counts in a decision run. When a fix would change what a journey measures, the coordinator decides. The first validation is [`2026-11-27-b2-world-validation.md`](2026-11-27-b2-world-validation.md).

## Files

- `YYYY-MM-DD-<slug>.md`: one per measurement run, named like [`docs/evals/runs/`](../runs/README.md) files: what ran (pin, versions, run ids, flags), totals for both sets, the dev per-journey table, failure causes, Jev calls and cost, and the verdict.
- [`experiments.md`](experiments.md): one row per harness experiment, with its flag, PR, result and whether it was kept.

The current baseline is [`2026-11-26-real-jev-baseline.md`](2026-11-26-real-jev-baseline.md).
