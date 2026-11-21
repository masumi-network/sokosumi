# Eval run: cmo-v10-strategy

- Date: 2026-11-21
- Run: `01a1fd2a-7af8-7349-b7dd-a2eea3b84457` (manual, completed)
- Environment: local
- Commit: `a993e5274a` feat(cmo): run every Cuso strategy turn on Sol, and make v34 and cmo-v10 the defaults, PR #7830
- Bots: Soko Bot v34 (openai/gpt-6-luna), Cuso cmo-v10 (openai/gpt-6-luna; strategy turns on openai/gpt-6.2-sol)
- Judge: claude-code:claude-opus-5-5
- Repeats: 1
- Cost: $7.62

## Results

**Evals** (local, no commit, 1 repeat)

| Suite | Passed | Regressed | Fixed | Flaky | Failing |
| ----- | ------ | --------- | ----- | ----- | ------- |
| cmo   | 11/11  | 0         | 0     | 0     | 0       |

Cost $7.62 · run `01a1fd2a-7af8-7349-b7dd-a2eea3b84457`

## Before and after

Baseline: the same eleven cases with every turn on GPT-6 Luna (cmo-v8), runs `01a1fbbe-5552-72ea-aecf-9b85f8a6ea62` and its rerun `01a1fc99-a359-740f-812b-578aa091bdaa` of four cases lost to Gateway errors.

| Case                            | Luna                                           | cmo-v10                     |
| ------------------------------- | ---------------------------------------------- | --------------------------- |
| cmo-strategy-blue-bottle-coffee | fail (three of four weeks planned)             | pass                        |
| cmo-strategy-hubspot            | fail (TikTok left out for a business audience) | pass                        |
| cmo-strategy-hiltl              | fail (two entries share a title)               | pass                        |
| cmo-brand-fit                   | fail (asked instead of saving)                 | pass (a chat turn, on Luna) |
| the other seven                 | pass                                           | pass                        |

Every strategy turn ran with reason `strategy`, and `soko_bot_model_call` shows GPT-6.2 Sol answered each agent step.

## Failed cases

None.

## Why the failures happened

No failures.

## Verdict

Ship: 11 of 11 against Luna's 7, for about $0.69 a strategy case against Luna's $0.17.

## Links

- Model comparison: `2026-11-21-strong-model-choice.md`.
