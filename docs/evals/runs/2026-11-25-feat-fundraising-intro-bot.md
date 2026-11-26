# Eval run: feat-fundraising-intro-bot

- Date: 2026-11-25
- Run: `01a2145f-b459-7184-91bb-760be8e51b57` (manual, completed)
- Environment: local
- Commit: not recorded
- Bots: Soko Bot v34 (openai/gpt-6-luna), Cuso cmo-v20 (openai/gpt-6-luna)
- Judge: claude-code:claude-opus-5-5
- Repeats: 1
- Cost: $0.19

## Results

**Evals** (local, no commit, 1 repeat)

| Suite    | Passed | Regressed | Fixed | Flaky | Failing |
| -------- | ------ | --------- | ----- | ----- | ------- |
| soko-bot | 2/2    | 0         | 0     | 0     | 0       |

Cost $0.19 · run `01a2145f-b459-7184-91bb-760be8e51b57`

## Before and after

No baseline: no weekly run before this one on this environment.

## Failed cases

None.

## Why the failures happened

_To fill in: the cause of each failure, or why it does not matter._

## Verdict

_To fill in: ship or don't ship, because …_

## Links

_Sheets, screenshots, the PR._

## Why this run

PR: the raise enters the owner's stand-up ("Your raise" block) and `fundraising_pipeline` gains the intro in flight, the best path and an `introPending` filter. No prompt or version change. The two cases the eval lanes can reach (Fundraising off) still pass: the bot calls the tool, reports that the raise is not set up, and invents nobody.

## Verdict

Ship.
