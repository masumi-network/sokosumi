# Eval run: strategy-volume-gap

Backfilled from the agent report, no run id.

- Date: 2026-11-20
- Run: backfilled from the agent report, no run id
- Environment: local (Core in process)
- Commit: PR #7736 (`cmoPromiseGaps`, finish turns, approval blocked on a short month), commits `1a20453` and `a1f5660`
- Bots: Cuso cmo-v5
- Judge: none (strategy cases have checks only)
- Repeats: 1, and 3 on a failed case
- Cost: about $0.17 for the first pass; about $0.77 Gateway spend for the whole task

## Results

| Case                               | Result                                                                                                |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `cmo-strategy-tester-top-volume`   | passed: 82 of 82 pieces, all_in                                                                       |
| `cmo-strategy-funnel-matches-plan` | passed: the plan turn ended with no calendar, finish turn 1 wrote 172 pieces with a clean last review |

Video follow-up, folded into #7736:

| Case                               | Result                                                                                                            |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `cmo-strategy-funnel-matches-plan` | failed after `1a20453` (a finish turn added a fifth video and broke the cap of 4 a month); passed after `a1f5660` |
| `video-networks-b2b`               | failed once (TikTok left out for its audience, outside this gate), then 3/3 on the final commit                   |

## Before and after

No baseline weekly run. The change is Core-only (no prompt or skill change, so no new Cuso version).

## Failed cases

- `cmo-strategy-funnel-matches-plan` at `1a20453`: a fifth video on YouTube and TikTok, over the cap of 4 a month.
- `video-networks-b2b` (once): TikTok left out for its audience.

## Why the failures happened

The video gap told Cuso to fill a "1 a week" cadence on YouTube and TikTok, which needs a fifth video. `a1f5660` has a video network's gap point to the talking videos' `alsoOn` (at most 4 videos) instead. The `video-networks-b2b` miss is outside this gate and did not recur in 3 repeats. Neither run hit the "four weeks but short" branch; only the unit test covers it.

## Verdict

Ship (shipped in #7736, merged 2026-11-20 07:40 UTC). Both touched strategy cases pass on the final commit.

## Links

- PR: #7736
