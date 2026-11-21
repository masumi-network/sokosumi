# Eval run: cmo-v12-seo-weekly-report

- Date: 2026-11-21
- Run: `01a1fd4f-58e0-742c-86a2-eefaa0921f9f` (manual, completed)
- Environment: local
- Commit: cmo-v12 branch with the claim-check fix (`feat/cmo-v12-seo-reports`)
- Bots: Soko Bot v33 (openai/gpt-6-luna), Cuso cmo-v12 (openai/gpt-6-luna)
- Judge: claude-code:claude-opus-5-5
- Repeats: 3
- Cost: $0.06

## Results

**Evals** (local, no commit, 3 repeats)

| Suite | Passed | Regressed | Fixed | Flaky | Failing |
| ----- | ------ | --------- | ----- | ----- | ------- |
| cmo   | 3/3    | 0         | 0     | 0     | 0       |

Cost $0.06 · run `01a1fd4f-58e0-742c-86a2-eefaa0921f9f`

## Before and after

No baseline: no weekly run before this one on this environment.

## Failed cases

None.

## Why the failures happened

None failed. All three judged "weak" for the same reason: the message names each saved change by page and search but does not repeat its before and after text. That text is on the chat card under the message (by design, to keep the message short), which the judge does not see; the rubric now says so. Repeat 2 also shows Core's live-page check working: Cuso's first save guessed the homepage heading, Core refused it ("does not say …"), and he saved the rest.

Sample message (repeat 2): "Google clicks rose to 412 from 368, impressions to 18,940 from 17,210, and average position improved to 14.6 from 15.9, comparing Oct 20–Nov 16 with the previous 28 days. The homepage title change targets “online booking software” (position 11.8, 1,820 impressions). I also added an article idea for “scheduling software pricing” (position 13.1, 640 impressions). Both are on the SEO page. The weekly site audit is unavailable, so there are no audit findings to report."

## Verdict

Ship: the weekly report is short, uses only read_seo's numbers, and saves changes with their real before.

## Links

The cmo-v12 PR; the first run is [2026-11-21-cmo-v12-seo-cases](2026-11-21-cmo-v12-seo-cases.md).
