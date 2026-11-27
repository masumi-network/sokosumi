# Owner benchmark: batch 1, plan loop only

- Date: 2026-11-27
- Runs: loop only `01a21b91-51e3-7732-b1ff-6bdf083c68a4` (05:53–06:50 UTC), control `01a21bd1-b393-71a8-a903-a4adeb84bf57` (07:04–07:40 UTC), both completed
- Environment: local, ChatGPT plan + real Jev (`local-chatgpt-plan-real-jev`)
- Bots: loop only = Soko Bot v40 + Cuso cmo-v27 (`planLoop`); control = Soko Bot v39 + Cuso cmo-v26
- Judge: `claude-code:claude-opus-5-5` (Claude Code on its subscription) for all 96 verdicts
- Sets: dev 18 journeys × 1 repeat, held-out 10 journeys × 3 repeats; 96 results, 0 ERROR, all labelled real Jev
- Jev: 503 real calls, 0 failed, $0.0240 (loop 262 / $0.0123, control 241 / $0.0117)

## Pins

The two arms ran on different pins:

- **Loop only:** `fdd6e63922`, which is main `b30913f350` + v40 #8421 `92cc9919af` (with v39 #8291) + cmo-v26 #8292 + cmo-v27 #8411 + grader #8414 `3ad9fafc19`.
- **Control:** `38946350ec`, which is the same pin + #8432 `cb226dfbb9`. That commit makes a step count only turns that ran its version and whose request started in the journey, and it removes watches still waiting from earlier work.

The loop arm's run had counted two foreign `cmo-v23` watch turns that a previous run left behind (found by Codex). Both were removed from the loop arm's results before comparing:

- **Dev `owner-cuso-launch`:** the foreign turn had failed step 0 with its failed `get_image` and its reply. The real turn asked its question with no failed call. The journey still fails, with 2 steps right instead of 1.
- **One held-out repeat:** only its tokens and one turn came out. Its result is unchanged.

A later scan of both arms found no other turn from an earlier request, whether by parent, delegation follow-up, watch or version. The comparison below uses the corrected loop arm.

## Results

|                                 | Control v39 + cmo-v26           | Loop only v40 + cmo-v27 |
| ------------------------------- | ------------------------------- | ----------------------- |
| Dev journeys passed (of 18)     | 5                               | 4                       |
| Dev steps right                 | 11                              | 13                      |
| Dev pass^1                      | 28%                             | 22%                     |
| Dev input tokens per turn       | 369,969                         | 370,155                 |
| Dev lost passes                 |                                 | 2                       |
| Held-out pass^3 (of 10)         | 2                               | 0                       |
| Held-out pass^1 (of 30 repeats) | 23%                             | 20%                     |
| Held-out mean steps right       | 10.7                            | 9.7                     |
| Held-out input tokens per turn  | 348,112                         | 392,663 (+13%)          |
| Held-out lost passes            |                                 | 2                       |
| Token coverage                  | dev 17 of 18, held-out 10 of 10 |                         |

**Verdict: bar not met on either set.** Loop only passes fewer journeys on both sets and loses two passes on each. On the held-out set it also uses 13% more input tokens per turn. Codex found that the done check had little chance to act in this arm: no `done_check.bounced` event was recorded on any graded dev turn.

## Dev per journey

Steps right and input tokens per turn, control → loop only.

| Journey                        | Control           | Loop only       | Change      |
| ------------------------------ | ----------------- | --------------- | ----------- |
| `owner-codepat-daily-post`     | fail · 0 · 294k   | fail · 3 · 427k | more steps  |
| `owner-codepat-busy`           | fail · 1 · 291k   | pass · 2 · 326k | gained      |
| `owner-no-x-account`           | pass · 1 · 210k   | pass · 1 · 212k |             |
| `owner-which-x-account`        | fail · 0 · 318k   | fail · 0 · 295k |             |
| `owner-weekly-report-schedule` | fail · 2 · 330k   | fail · 2 · 357k |             |
| `owner-research-to-linkedin`   | fail · 0 · ?      | fail · 1 · 415k | more steps  |
| `owner-pdf-to-x-posts`         | fail · 1 · 784k   | fail · 0 · 568k | fewer steps |
| `owner-site-to-newsletter`     | pass · 1 · 573k   | pass · 1 · 428k |             |
| `owner-investor-table`         | pass · 1 · 285k   | pass · 1 · 354k |             |
| `owner-images-redo`            | fail · 0 · 140k   | fail · 0 · 140k |             |
| `owner-stale-schedules`        | pass · 1 · 351k   | fail · 0 · 210k | lost        |
| `owner-cuso-launch`            | fail · 2 · 366k   | fail · 2 · 333k |             |
| `owner-cuso-youtube`           | fail · 0 · 221k   | fail · 0 · 297k |             |
| `owner-cuso-pricing-page`      | fail · 0 · 627k   | fail · 0 · 761k |             |
| `owner-cuso-change-plan`       | fail · 0 · 858k   | fail · 0 · 448k |             |
| `owner-cuso-report-then-act`   | fail · 0 · 232k   | fail · 0 · 420k |             |
| `owner-cuso-customer-story`    | fail · 0 · 1,004k | fail · 0 · 302k |             |
| `owner-cuso-ambiguous-more`    | pass · 1 · 149k   | fail · 0 · 487k | lost        |

## Links

- Plan loop: #8340 (merged), v40 #8421, cmo-v27 #8411
- Attribution fix: #8432
- [Experiments table](experiments.md)
