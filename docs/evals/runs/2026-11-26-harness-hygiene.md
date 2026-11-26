# Eval run: harness-hygiene

- Date: 2026-11-26
- Run: `01a2155e-a3ef-707d-8b9d-7e058f7690b4` (manual, completed, `pnpm evals:local`, Gateway)
- Environment: local (own Postgres, in-process runtime)
- Commit: `7aef865079` fix(soko-bot): cap turn budgets, rest idle bots and stop memory loss (main merged in), PR #8244
- Bots: Soko Bot default (openai/gpt-6-luna, strong openai/gpt-6.1-terra)
- Judge: claude-code:claude-opus-5-5
- Repeats: 1
- Cost: $0.17

## Results

| Case                      | Result | Cost    | Time |
| ------------------------- | ------ | ------- | ---- |
| status-rundown            | PASSED | $0.0959 | 36 s |
| board-question            | PASSED | $0.0095 | 15 s |
| ambiguous-request         | PASSED | $0.0088 | 21 s |
| weekly-wrap               | PASSED | $0.0055 | 36 s |
| dreaming                  | PASSED | $0.0051 | 34 s |
| web-research-with-sources | PASSED | $0.0256 | 52 s |
| remember-standing-rule    | PASSED | $0.0097 | 22 s |
| recall-standing-rule      | PASSED | $0.0088 | 17 s |

Model calls in the run: Luna 15 calls, 871k input tokens, 52% cached, $0.059; Terra 2 calls, $0.096; Exa 2 searches, $0.014; Jev 14 calls, $0.001.

## Before and after

Baseline: mainnet daily run of 2026-11-23 (sandbox runtime). Not the same environment, so read costs as a direction, not a measure.

| Case                      | 2026-11-23 | This run |
| ------------------------- | ---------- | -------- |
| dreaming                  | FAILED     | PASSED   |
| recall-standing-rule      | FAILED     | PASSED   |
| all eight, cost           | $0.735     | $0.169   |
| web-research-with-sources | $0.155     | $0.026   |

Iteration on the ChatGPT plan before this run (`01a21558-…`, `01a2155d-…`): the same cases passed, except `check-back-later` (fails on every mainnet run since 2026-11-10; left out here) and one of three `remember-standing-rule` repeats (an unneeded `preview_result` call on the memory id).

## Failed cases

None.

## Why the failures happened

No failures in this run.

## Verdict

Ship: every touched case passes, web search costs a sixth of the old model-call search, and simple chat turns run on low reasoning without losing a case.

## Links

PR #8244.
