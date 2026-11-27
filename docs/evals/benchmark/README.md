# Owner benchmark results

The owner benchmark measures whether Soko Bot and Cuso finish real, multi-step owner requests end to end. Its journeys, checks and runner are described in [`docs/agents/evals.md`](../../agents/evals.md#owner-benchmark); the journeys live in `apps/core/src/services/evals/ownerbench/`. This folder keeps every measurement so later runs have a baseline to compare against.

## What a run measures

- **Journeys.** Each journey is a short chain of steps: an owner message, a Coworker answering on its Task, or the bot's own schedule firing. Code checks every step (tools, answer, and what was saved: schedules, Tasks, images, drafts, tables). A judge then grades the whole chain. A journey passes when every step's checks pass and the judge passes it.
- **Per-item judge (opt-in, `--judge per-item`).** By default, the judge grades the whole prose rubric in one call (`holistic`, passing `"pass"` and `"weak"`). Passing `--judge per-item` grades each journey against frozen atomic yes/no criteria (3 votes per item; every item majority must pass). Dev splits live in `apps/core/src/services/evals/ownerbench/dev-rubric-splits.json`; private held-out splits are supplied outside the repo with `--splits FILE`. Review every split with [`rubric-split-checklist.md`](rubric-split-checklist.md). Stored runs can be re-scored non-destructively with `evals:local --rejudge RUN_ID --judge per-item --json-out FILE`; `ownerbench-compare.mts` refuses to mix holistic and per-item reports.
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

## Files

- `YYYY-MM-DD-<slug>.md`: one per measurement run, named like [`docs/evals/runs/`](../runs/README.md) files: what ran (pin, versions, run ids, flags), totals for both sets, the dev per-journey table, failure causes, Jev calls and cost, and the verdict.
- [`experiments.md`](experiments.md): one row per harness experiment, with its flag, PR, result and whether it was kept.

The current baseline is [`2026-11-26-real-jev-baseline.md`](2026-11-26-real-jev-baseline.md).
