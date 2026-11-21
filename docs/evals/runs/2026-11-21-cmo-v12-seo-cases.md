# Eval run: cmo-v12-seo-cases

- Date: 2026-11-21
- Run: `01a1fd49-97d6-73ce-8a8c-c4563011f5c5` (manual, completed)
- Environment: local
- Commit: cmo-v12 branch before the claim-check fix (`feat/cmo-v12-seo-reports`)
- Bots: Soko Bot v33 (openai/gpt-6-luna), Cuso cmo-v12 (openai/gpt-6-luna)
- Judge: claude-code:claude-opus-5-5
- Repeats: 1
- Cost: $0.09

## Results

**Evals** (local, no commit, 1 repeat)

| Suite | Passed | Regressed | Fixed | Flaky | Failing |
| ----- | ------ | --------- | ----- | ----- | ------- |
| cmo   | 4/5    | 0         | 0     | 0     | 1       |

Cost $0.09 · run `01a1fd49-97d6-73ce-8a8c-c4563011f5c5`

## Before and after

No baseline: no weekly run before this one on this environment.

## Failed cases

### `cmo-seo-weekly-report`: Reports on SEO after the weekly audit

- Judge: fail, The groundwork was solid. Cuso read the SEO skill and read_seo, then fetched the live homepage and pricing page. It saved one homepage title change, with currentText copied word for word from the fetched page, and two article ideas. All three saves succeeded. The owner-facing message, which was the point of the scenario, never got written. The final answer was only "Nothing was changed in this turn." That is false, because three suggestions were saved this turn. It also leaves out the Search Console comparison (412 vs 368 clicks, 18,940 vs 17,210 impressions, position 14.6 vs 15.9), the saved change with its before and after text, the article ideas, and the pointer to the SEO page. The owner has no report, and the one line they got misstates what happened.

## Why the failures happened

`cmo-seo-weekly-report`: Cuso did the work (three saves, the homepage title's real current text copied from the live page), but Core withheld his reply. The claim check (`ownerNarrative` in `turn-loop.ts`) drops a message that claims a change no action receipt confirms, and `save_seo_suggestions` carries no receipt; the turn then fell back to "Nothing was changed in this turn." (and on an unprompted EVENT turn, the production path, it would have gone silent). Fixed in the same PR: a completed `save_seo_suggestions` call now counts as a confirmed change (`confirmedChanges`), and `cmoSavedRecord` counts it too. The re-run is [2026-11-21-cmo-v12-seo-weekly-report](2026-11-21-cmo-v12-seo-weekly-report.md): 3/3.

`cmo-seo-before-after` passed with judge "weak": the message said "Done, it's in the card below." The card (the new `seo_saved` chat card) shows the before and after, which the judge does not see.

## Verdict

Ship after the claim-check fix: keyword research, article ideas, before/after and on-demand articles pass on cmo-v12; the one failure was a Core bug, fixed and re-run 3/3.

## Links

The cmo-v12 PR. Article cost measured here: the on-demand article turn cost $0.015 (1,085 words), about 2 credits.
