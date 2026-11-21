# Eval run: team-standup

- Date: 2026-11-21
- Run: `01a1fd76-a702-70ef-9041-5a3372a0eda0` (manual, completed)
- Environment: local
- Commit: not recorded
- Bots: Soko Bot v33 (openai/gpt-6-luna), Cuso cmo-v8 (openai/gpt-6-luna)
- Judge: none recorded
- Repeats: 3
- Cost: $0.007 (the host model, google/gemini-3.8-flash: $0.0011 per stand-up on average, $0.0016 at most; the eval's cost column counts bot turns only, and a stand-up runs none)

## Results

**Evals** (local, no commit, 3 repeats)

| Suite    | Passed | Regressed | Fixed | Flaky | Failing |
| -------- | ------ | --------- | ----- | ----- | ------- |
| soko-bot | 9/9    | 0         | 0     | 0     | 0       |

Cost $0.00 · run `01a1fd76-a702-70ef-9041-5a3372a0eda0`

## Before and after

No baseline: these are the first stand-up cases.

## Failed cases

None.

## Why the failures happened

None failed. While building, `standup-match` failed once when the host saw only Task names: it did not connect "DACH market study" with "EU marketplace pricing research". It now also gets each Task's description and an example of a useful overlap; since then 6 of 6 matched, and the unrelated need (the offsite venue) opened no hand-off in 3 of 3.

## Verdict

Ship behind its switches: off for every organization until an admin turns it on, the owner opts each bot in, and admins can pause all stand-ups at once.

## Links

PR: feat(soko-bot): daily agent stand-up per organization. Screenshots (local, alice-fixture): organization settings card at 1440 and 390, the bot's opt-in toggle, the thread and its hand-off.
