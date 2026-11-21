# Eval run: seo-search-console-keywords

- Date: 2026-11-21
- Run: `01a1fd32-6972-760a-baaf-8fefe34a0e12` (manual, completed)
- Environment: local
- Commit: `ba3e5f5c04` fix(core): offer the brand's own Search Console searches when keyword research measures nothing
- Bots: Soko Bot v33 (openai/gpt-6-luna), Cuso cmo-v8 (openai/gpt-6-luna)
- Judge: claude-code:claude-opus-5-5
- Repeats: 1
- Cost: $0.03

## Results

**Evals** (local, no commit, 1 repeat)

| Suite | Passed | Regressed | Fixed | Flaky | Failing |
| ----- | ------ | --------- | ----- | ----- | ------- |
| cmo   | 2/2    | 0         | 0     | 0     | 0       |

Cost $0.03 · run `01a1fd32-6972-760a-baaf-8fefe34a0e12`

## Before and after

No baseline: no weekly run before this one on this environment.

## Failed cases

None.

## Why the failures happened

None failed. Both cases ran on the eval lane's cal.com Cuso, whose topics have measured volume, so they check that the Search Console additions and the new article-ideas wording break nothing for a brand with real keyword data. The niche case (no measured volume, Search Console only) is covered by the Postgres test `offers the site's own Search Console searches when research measures nothing` and by a new eval case in the cmo-v12 PR.

## Verdict

Ship: research and article ideas still pass with measured keywords, and the fix only adds Search Console searches beside them.

## Links

The fix PR (SEO tab: Search Console searches in keyword research).
