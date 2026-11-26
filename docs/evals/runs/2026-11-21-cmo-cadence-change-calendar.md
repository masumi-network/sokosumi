# Eval run: cmo-cadence-change-calendar

- Date: 2026-11-21
- Run: `01a1ffc1-dd79-73fc-9bda-e85d999122d8` (manual, completed)
- Environment: preview
- Commit: `f3c486f` fix(core): carry a changed cadence into the strategy's calendar and funnel, PR #7869
- Bots: Soko Bot v36 (openai/gpt-6-luna), Cuso cmo-v10 (openai/gpt-6-luna)
- Judge: anthropic/claude-opus-5.5
- Repeats: 1
- Cost: $0.16

## Results

**Evals** (preview, #7869, 1 repeat, vs weekly run #7261)

| Suite | Passed | Regressed | Fixed | Flaky | Failing |
| ----- | ------ | --------- | ----- | ----- | ------- |
| cmo   | 1/1    | 0         | 1     | 0     | 0       |

- ▲ `cmo-change-request` 0% → 100%

Cost $0.16 · run `01a1ffc1-dd79-73fc-9bda-e85d999122d8`

## Before and after

Baseline: weekly run 01a1e283-4b00-72bf-b30f-3601959bf1b2 of 2026-11-16 (#7261).

| Case                 | Before | After | Outcome |
| -------------------- | ------ | ----- | ------- |
| `cmo-change-request` | 0%     | 100%  | fixed   |

## Failed cases

None.

## Why the failures happened

No failures. `cmo-change-request` (LinkedIn down to one post a week) passed; it failed in the weekly run of 2026-11-16. Core now trims the lowered channel's unwritten pieces itself, so Cuso no longer has to resend a calendar his packet shows only part of.

## Verdict

Ship: the only case this Core change touches passes on the PR preview, for $0.16.

## Links

PR #7869.
