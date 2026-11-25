# Eval run: fundraising-tools

- Date: 2026-11-25
- Run: `01a211e2-a104-7774-87bb-0eedf887c36a` (manual, completed)
- Environment: local
- Commit: `7b0547f939` feat(soko-bot): give the owner's bot the raise: pipeline, warm paths, find investors, PR #8120 (plus the tool-description fix committed with this file)
- Bots: Soko Bot v34 (openai/gpt-6-luna), Cuso cmo-v20 (openai/gpt-6-luna)
- Judge: claude-code:claude-opus-5-5
- Repeats: 2
- Cost: $0.18

## Results

**Evals** (local, no commit, 2 repeats)

| Suite    | Passed | Regressed | Fixed | Flaky | Failing |
| -------- | ------ | --------- | ----- | ----- | ------- |
| soko-bot | 2/2    | 0         | 0     | 0     | 0       |

Cost $0.18 · run `01a211e2-a104-7774-87bb-0eedf887c36a`

## Before and after

No baseline: no weekly run before this one on this environment.

## Failed cases

None.

## Why the failures happened

This run has none. The first run of the same cases (`01a211de-e8f8-72fe-b9c0-47fb4ecf5e3d`, 1 of 2) failed `fundraising-find-investors-off`: the tool refused because the eval lane has no Fundraising, and the bot ended its turn without telling the owner, so the judge read it as a swallowed refusal. The `find_investors` and `investor_warm_paths` descriptions now say what to do with that refusal (tell the owner in one sentence, no web search in its place); the case then passed twice.

## Verdict

Ship. The two cases cover the only behaviour the eval lanes can reach (Fundraising off): the bot calls `fundraising_pipeline` / `investor_warm_paths` and `find_investors`, reports that the raise is not set up, and invents no investors. The allowlisted path (a real pipeline, a real Exa search) is covered by the services' unit and PostgreSQL tests and by the page drive; a chat with Joseph on prod is the remaining check once the env var is set.

## Links

- PR #8120
- First run (1 of 2, before the description fix): `01a211de-e8f8-72fe-b9c0-47fb4ecf5e3d`
