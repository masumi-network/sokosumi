# Eval run: cmo-ads-no-invented-forecast

- Date: 2026-11-25
- Run: `01a214f7-451e-7329-badb-c1a98f47e02c` (manual, completed)
- Environment: mainnet
- Commit: `bd6fcfd` fix(soko-bot): give an ads range only from real data, never an invented one (#8234), PR #8234
- Bots: Soko Bot v36 (openai/gpt-6-luna), Cuso cmo-v23 (openai/gpt-6-luna)
- Judge: anthropic/claude-opus-5.5
- Repeats: 1
- Cost: $0.51

## Results

**Evals** (mainnet, #8234, 1 repeat, vs weekly run #7957)

| Suite | Passed | Regressed | Fixed | Flaky | Failing |
| ----- | ------ | --------- | ----- | ----- | ------- |
| cmo   | 1/1    | 0         | 1     | 0     | 0       |

- ▲ `cmo-ads-yes` 0% → 100%

Cost $0.51 · run `01a214f7-451e-7329-badb-c1a98f47e02c`

## Before and after

Baseline: weekly run 01a2068f-cfea-71fa-a621-8928e4cc3a42 of 2026-11-23 (#7957).

| Case          | Before | After | Outcome |
| ------------- | ------ | ----- | ------- |
| `cmo-ads-yes` | 0%     | 100%  | fixed   |

## Failed cases

None.

## Why the failures happened

None failed. Before #8234, `cmo-ads-yes` failed on cmo-v21, v22 and v23 (runs `01a2144c`, `01a213e7`, `01a2147a`). The shared ads skill asked for "what the amount should bring as a range", so Cuso invented clicks and trial starts with no keyword or cost data.

## Verdict

Ship (merged as #8234). With no data, Cuso now says so and says what the first month's budget will teach. With real data he gives the range and names the source.

## Links

- PR #8234
