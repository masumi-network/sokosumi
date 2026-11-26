# Eval run: cmo-month-writer-timeout

- Date: 2026-11-26
- Run: `01a2152e-fedd-75fa-a99a-4783dc9183ce` (manual, completed)
- Environment: mainnet
- Commit: `ff66391` fix(cmo): write the month at low reasoning effort so chunks answer in time (#8242), PR #8242
- Bots: Soko Bot v36 (openai/gpt-6-luna), Cuso cmo-v23 (openai/gpt-6-luna)
- Judge: none recorded
- Repeats: 1
- Cost: $0.27

## Results

**Evals** (mainnet, #8242, 1 repeat, vs weekly run #7957)

| Suite | Passed | Regressed | Fixed | Flaky | Failing |
| ----- | ------ | --------- | ----- | ----- | ------- |
| cmo   | 2/3    | 0         | 2     | 0     | 1       |

- ▲ `cmo-month-hiltl` 0% → 100%
- ▲ `cmo-month-blue-bottle-coffee` 0% → 100%

Cost $0.27 · run `01a2152e-fedd-75fa-a99a-4783dc9183ce`

## Before and after

Baseline: weekly run 01a2068f-cfea-71fa-a621-8928e4cc3a42 of 2026-11-23 (#7957).

| Case                           | Before | After | Outcome |
| ------------------------------ | ------ | ----- | ------- |
| `cmo-month-hiltl`              | 0%     | 100%  | fixed   |
| `cmo-month-blue-bottle-coffee` | 0%     | 100%  | fixed   |

## Failed cases

### `cmo-month-timed`: Makes a 28-piece month in minutes, on few tokens

- Failed check: Jev flags at most 25% of pieces: 01a2153b-4df4-72ca-9093-d7482b7d56a1: The first line leads with the point (a claim, a number, a real question or a moment), with no preamble or label. · 01a2153b-4df4-72ca-9093-dbad37cf4f4c: The first line is a hook that makes people tap 'see more': a result with its number, a price or another number from the business, a named customer and what they did, or a decision that sounds surprising. Advice, a definition, company history, a list or count of features, a rating or an unnamed reviewer's praise is not. · 01a2153b-4df4-72ca-9093-deaf9c6d8989: One idea, in one to three short lines. · 01a2153

## Why the failures happened

`cmo-month-timed` now fails only "Jev flags at most 25% of pieces", on first lines and hooks. It fails the same on cmo-v21 and cmo-v22, so it is left for the writing pass. The writer bug this run proves is fixed:

| Run        | Change                                             | Written                                     | Chunk timeouts |
| ---------- | -------------------------------------------------- | ------------------------------------------- | -------------- |
| `01a2147a` | none (chunks of 10, default effort)                | 0 of 24                                     | all            |
| `01a214ca` | the same, on cmo-v21                               | 0 of 24                                     | all            |
| `01a2150a` | #8240: chunks of 3, one retry after a fast failure | 6 of 24                                     | 33             |
| `01a2152e` | #8242: low reasoning effort                        | **24 of 24**, 28 of 28 ready in 7.3 minutes | 1              |

**Input tokens a piece:**

- This run: 105,333. Runs that stopped early (5k and 24k) are not a baseline.
- Full months before the writer broke: 160,164 on cmo-v22 and 152,775 on cmo-v21.
- Most of it is Cuso's own production-turn steps, each resending his context. The writer's calls took 206k and Jev's 65k.

## Verdict

Ship (merged as #8240 and #8242). Both quality cases (`cmo-month-hiltl`, `cmo-month-blue-bottle-coffee`) pass at low effort.

## Links

- PRs #8240 and #8242
