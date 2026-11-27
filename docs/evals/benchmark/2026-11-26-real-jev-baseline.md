# Owner benchmark: real-Jev baseline

- Date: 2026-11-26
- Runs: candidate `01a2186c-bcc9-713b-9704-8d09548371c3` (15:15–15:51 UTC), baseline `01a2188d-b3ff-71ba-a34c-a4ff552c8dfc` (15:51–17:21 UTC), both completed
- Environment: local, ChatGPT plan + real Jev (`local-chatgpt-plan-real-jev`)
- Pin: `2ac1726d20` (main `a01df00294` with #8362, the real-Jev switch), both sides on the same code
- Bots: candidate Soko Bot v39 + Cuso cmo-v26, baseline Soko Bot v36 + Cuso cmo-v23
- Judge: `claude-code:claude-opus-5-5` (Claude Code on its subscription, the plan-run default) for all 96 verdicts, both sides
- Agent turns: ChatGPT plan; Jev through the AI Gateway
- Sets: dev 18 journeys × 1 repeat, held-out 10 journeys × 3 repeats; 96 results, 0 ERROR, all labelled real Jev
- Jev: 474 real calls, 0 failed, $0.0234 (candidate 252 calls / $0.0121, baseline 222 / $0.0113)

This is the baseline for later owner-benchmark runs. It was the fleet decision run for moving the defaults from v36 + cmo-v23 to v39 + cmo-v26.

## Results

|                                 | Baseline v36 + cmo-v23 | Candidate v39 + cmo-v26 |
| ------------------------------- | ---------------------- | ----------------------- |
| Dev journeys passed (of 18)     | 5                      | 3                       |
| Dev steps right                 | 13                     | 12                      |
| Dev pass^1                      | 28%                    | 17%                     |
| Dev input tokens per turn       | 391,522                | 335,377 (−14%)          |
| Held-out pass^3 (of 10)         | 0                      | 0                       |
| Held-out pass^1 (of 30 repeats) | 10%                    | 13%                     |
| Held-out mean steps right       | 7.3                    | 10.3                    |
| Held-out input tokens per turn  | 400,367                | 302,307 (−24%)          |
| Held-out lost passes            |                        | 0                       |
| Token coverage                  | 48 of 48               | 48 of 48                |

**Verdict: bar not met.** The dev set fails it: 2 journeys lost (pdf-to-x-posts, stale-schedules) and fewer passed. The held-out set holds it. Both sets must hold, so the defaults stay on v36 + cmo-v23.

## Dev per journey

Steps right and input tokens per turn, baseline → candidate.

| Journey                        | Bot  | Baseline          | Candidate       | Change      |
| ------------------------------ | ---- | ----------------- | --------------- | ----------- |
| `owner-codepat-daily-post`     | Soko | fail · 4 · 437k   | fail · 2 · 260k | fewer steps |
| `owner-codepat-busy`           | Soko | fail · 0 · 220k   | fail · 1 · 392k | more steps  |
| `owner-no-x-account`           | Soko | pass · 1 · 147k   | pass · 1 · 210k |             |
| `owner-which-x-account`        | Soko | fail · 0 · 514k   | fail · 0 · 363k |             |
| `owner-weekly-report-schedule` | Soko | fail · 2 · 297k   | fail · 2 · 283k |             |
| `owner-research-to-linkedin`   | Soko | fail · 0 · 418k   | fail · 0 · 442k |             |
| `owner-pdf-to-x-posts`         | Soko | pass · 1 · 1,040k | fail · 1 · 785k | lost        |
| `owner-site-to-newsletter`     | Soko | pass · 1 · 298k   | pass · 1 · 279k |             |
| `owner-investor-table`         | Soko | fail · 0 · 373k   | fail · 0 · 433k |             |
| `owner-images-redo`            | Soko | fail · 0 · 268k   | fail · 0 · 179k |             |
| `owner-stale-schedules`        | Soko | pass · 1 · 149k   | fail · 1 · 209k | lost        |
| `owner-cuso-launch`            | Cuso | fail · 2 · 383k   | fail · 2 · 294k |             |
| `owner-cuso-youtube`           | Cuso | fail · 0 · 223k   | fail · 0 · 370k |             |
| `owner-cuso-pricing-page`      | Cuso | fail · 0 · 1,019k | fail · 0 · 551k |             |
| `owner-cuso-change-plan`       | Cuso | fail · 0 · 346k   | fail · 0 · 370k |             |
| `owner-cuso-report-then-act`   | Cuso | fail · 0 · 548k   | fail · 0 · 257k |             |
| `owner-cuso-customer-story`    | Cuso | fail · 0 · 273k   | fail · 0 · 607k |             |
| `owner-cuso-ambiguous-more`    | Cuso | pass · 1 · 93k    | pass · 1 · 222k |             |

## Why the dev journeys failed

Each failed journey is classed by its first real cause.

| First real cause                                          | Baseline (13 failed) | Candidate (15 failed) | Example                                                                                          |
| --------------------------------------------------------- | -------------------- | --------------------- | ------------------------------------------------------------------------------------------------ |
| Stopped early, work left undone                           | 4                    | 6                     | codepat-daily-post (candidate): CodePat's note arrived; no images or draft were made             |
| Wrong Jev route (read-only or clarify when it should act) | 3                    | 3                     | cuso-youtube (both): routed CLARIFY, asked a generic question, never used the video              |
| Tool or Core error                                        | 4                    | 2                     | investor-table (both): `create_table` "Table identifier already exists"                          |
| False claim in the reply                                  | 0                    | 0                     |                                                                                                  |
| Judge-only fail (all checks pass)                         | 0                    | 2                     | pdf-to-x-posts (candidate): spreading the posts over the week was dropped silently               |
| Timeout (not settled in 20 min)                           | 1                    | 0                     | codepat-busy (baseline): still running after 1,242 s                                             |
| Grader bug                                                | 0                    | 1                     | weekly-report-schedule (candidate): "without the stuck section" counted as mentioning stuck work |
| Acted before asking                                       | 1                    | 1                     | which-x-account (both): drafted the post without asking which X account                          |

- An owner's chat turn gets every tool whatever route Jev picks: the route is a hint in the prompt. "Wrong route" means the bot followed a read-only hint and asked or answered instead of acting.
- Cuso is the weak side: 6 of the candidate's 15 failures are Cuso journeys, and the same 6 fail on the baseline.
- Both lost journeys are judge-only fails. pdf-to-x-posts dropped "spread over next week" without saying so. stale-schedules implied a full audit of members' schedules it couldn't see.

## Known grader and isolation problems in this run

Found from these runs and fixed afterwards, so later runs aren't comparable to this one on the affected journeys:

- An "avoids" check counted a mention that says the thing is left out ("without the stuck section"). With that fixed, the candidate's dev result would be 4/18. Fixed in #8414.
- The schedule check failed any edit to a time zone the owner asked for. Fixed in #8414.
- Every investor-table case left its Files table in the lane, and a later `create_table` collided with its column ids. The lane reset now removes tables (#8414).
- Task Schedules weren't graded or fired, and weren't reset between journeys (#8334). The schedule journeys get replayed under the fixed grader, and the weekly-report journey is reported judge-only in that replay.

## Links

- Comparator: `apps/core/scripts/ownerbench-compare.mts` (#8362 added the real-Jev rules)
- Real-Jev switch: #8362
- Grader fixes: #8414, #8334; Cuso isolation: #8339
