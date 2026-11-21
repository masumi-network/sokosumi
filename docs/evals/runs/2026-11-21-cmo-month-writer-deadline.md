# Eval run: cmo-month-writer-deadline

- Date: 2026-11-21
- Run: `01a1ffc4-5f65-7118-a9d6-d1262ffa476f` (manual, completed)
- Environment: preview
- Commit: `2fcfd9e` fix(core): compute the month writer's budget when it runs, PR #7867
- Bots: Soko Bot v36 (openai/gpt-6-luna), Cuso cmo-v10 (openai/gpt-6-luna)
- Judge: none recorded
- Repeats: 1
- Cost: $0.37

## Results

**Evals** (preview, #7867, 1 repeat, vs weekly run #7261)

| Suite | Passed | Regressed | Fixed | Flaky | Failing |
| ----- | ------ | --------- | ----- | ----- | ------- |
| cmo   | 1/2    | 0         | 0     | 0     | 1       |

Cost $0.37 · run `01a1ffc4-5f65-7118-a9d6-d1262ffa476f`

## Before and after

Baseline: weekly run 01a1e283-4b00-72bf-b30f-3601959bf1b2 of 2026-11-16 (#7261).

| Case              | Before | After | Outcome |
| ----------------- | ------ | ----- | ------- |
| `cmo-month-timed` | –      | 0%    | failing |

## Failed cases

### `cmo-month-timed`: Makes a 28-piece month in minutes, on few tokens

- Failed check: Jev flags at most 25% of pieces: 01a1ffc6-a88b-74a0-9bdd-9006d67c468c: One idea, in one to three short lines. · 01a1ffc6-a88b-74a0-9bdd-9c543e94a5fd: The first line is a hook that makes people tap 'see more': a result with its number, a price or another number from the business, a named customer and what they did, or a decision that sounds surprising. Advice, a definition, company history, a list or count of features, a rating or an unnamed reviewer's praise is not. · 01a1ffc6-a88b-74a0-9bdd-af6939aed80a: The first line is a hook that makes people tap 'see more': a result with its number, a price or another number from the bu
- Failed check: At most 200,000 input tokens a piece: 253,517 a piece (7,098,480 in, 122,585 out, $0.33, media 9.6 minutes)

## Why the failures happened

Both failures come from what the writer wrote, not from its new deadline. The case has no weekly baseline yet (it has not run in the weekly suite).

- Each of the 5 `write_month_pieces` calls took 32–79 s, under the 100 s deadline (and the 115 s tool limit). None was cut, and the month's checks ran in every call.
- The extra calls and tokens were refusals by Core's content checks: 10 X posts over 280 characters in call 2, 2 LinkedIn first lines without a hook, and 1 near-duplicate message. Cuso rewrote those himself, which pushed input tokens to 253k a piece. The writer's prompt, chunking and checks are unchanged in this PR.
- The Jev flags (one idea per X post, LinkedIn hooks) are the writing-quality gaps already known from cmo-v8 (the LinkedIn hook rule fails often).
- The checks this PR is about passed: month made 28/28, every word written in 10.6 minutes, Core wrote the month.

## Verdict

Ship. Every writer call now ends well inside its limit, so Cuso no longer reads "timed out" and production keeps going. The two failing checks are the writer's output quality, which this PR does not touch.

## Links

PR #7867. Source incident: the NMKR test copy of 2026-11-21 (writer calls of 96–119 s against a 90 s limit).
