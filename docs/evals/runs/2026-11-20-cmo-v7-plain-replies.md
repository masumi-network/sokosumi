# Eval run: cmo-v7-plain-replies

Backfilled from the agent report, no run id.

- Date: 2026-11-20
- Run: backfilled from the agent report, no run id
- Environment: local
- Commit: final commit of PR #7741 (cmo-v7 = cmo-v6's month writer plus plain chat replies)
- Bots: Cuso cmo-v7 against cmo-v5 (gpt-6-luna on the AI Gateway)
- Judge: local Claude Code
- Repeats: 1, and 3 on `cmo-change-reply-plain` and on a failed case
- Cost: about $7.75 on model turns for the whole onboarding task, evals included (not split out)

## Results

| Version               | Case                        | Result                                                      |
| --------------------- | --------------------------- | ----------------------------------------------------------- |
| cmo-v5 (before)       | `cmo-change-reply-plain`    | failed: "The chat answer repeats the card", "two sentences" |
| cmo-v5 (before)       | `cmo-change-request`        | passed                                                      |
| cmo-v7 (final commit) | `cmo-change-reply-plain` ×3 | 3/3                                                         |
| cmo-v7 (final commit) | `cmo-change-request`        | passed                                                      |

During the work (as cmo-v6, before the version was renamed): the first full CMO suite passed 42/61 for $3.57, with `cmo-change-reply-plain` failing; after one prompt change it passed 2 of 3; the final wording passed 3/3. `cmo-change-request` failed once and then passed 2/3 over 3 repeats, the same 2/3 and the same failure (a patch that drops channels) as cmo-v5 over 3 repeats.

## Before and after

No baseline weekly run. Before = the same cases on cmo-v5 locally: `cmo-change-reply-plain` failed → passed 3/3; `cmo-change-request` passed → passed.

## Failed cases

- `cmo-change-request` (during the work): a patch that drops channels. Same rate on cmo-v5.

## Why the failures happened

`cmo-change-reply-plain` failed on cmo-v5 because Cuso's answer restated what the report card under it already says. The new rule has the answer add only what the card leaves out, or say "Done, it's in the card below." `cmo-change-request` fails 1 in 3 on both versions, so it is an existing flake rather than a regression.

## Verdict

Ship (shipped in #7741, and #7746 made cmo-v7 the hire default). The new case passes 3/3 and nothing else moved against cmo-v5.

## Links

- PRs: #7741, #7746
