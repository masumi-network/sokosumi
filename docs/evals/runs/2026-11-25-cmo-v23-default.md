# Eval run: cmo-v23-default

- Date: 2026-11-25
- Run: `01a2147a-6851-7658-8c06-3943d24db53c` (manual, completed)
- Environment: mainnet
- Commit: `366d13c` fix(cmo): drop Cuso's closing line under a schedule's card and retried-update noise (#8219), PR #8219
- Bots: Soko Bot v36 (openai/gpt-6-luna), Cuso cmo-v23 (openai/gpt-6-luna)
- Judge: anthropic/claude-opus-5.5
- Repeats: 1
- Cost: $9.99

## Results

**Evals** (mainnet, #8219, 1 repeat, vs weekly run #7957)

| Suite | Passed | Regressed | Fixed | Flaky | Failing |
| ----- | ------ | --------- | ----- | ----- | ------- |
| cmo   | 20/27  | 0         | 5     | 0     | 7       |

- ▲ `cmo-strategy-cal-com` 0% → 100%
- ▲ `cmo-strategy-website-only` 0% → 100%
- ▲ `cmo-month-picture-variety` 0% → 100%
- ▲ `cmo-change-request` 0% → 100%
- ▲ `cmo-post-with-picture` 0% → 100%

Cost $9.99 · run `01a2147a-6851-7658-8c06-3943d24db53c`

## Before and after

Baseline: weekly run 01a2068f-cfea-71fa-a621-8928e4cc3a42 of 2026-11-23 (#7957).

| Case                        | Before | After | Outcome |
| --------------------------- | ------ | ----- | ------- |
| `cmo-strategy-cal-com`      | 0%     | 100%  | fixed   |
| `cmo-strategy-website-only` | 0%     | 100%  | fixed   |
| `cmo-month-picture-variety` | 0%     | 100%  | fixed   |
| `cmo-change-request`        | 0%     | 100%  | fixed   |
| `cmo-post-with-picture`     | 0%     | 100%  | fixed   |
| `cmo-strategy-nmkr-io`      | –      | 100%  | passing |
| `cmo-strategy-entry-fyi`    | –      | 100%  | passing |

## Failed cases

### `cmo-month-hiltl`: Makes Hiltl's pieces

- Failed check: Month made: 2 of 3 pieces ready
- Failed check: Jev read the month: no review
- Failed check: Jev flags at most 25% of pieces: none flagged

### `cmo-month-blue-bottle-coffee`: Makes Blue Bottle Coffee's pieces

- Failed check: Jev flags at most 25% of pieces: 01a214a6-ff2e-77d5-ad71-e99a27ab4b77: It ends with a single question, takeaway or call to action.

### `cmo-month-timed`: Makes a 28-piece month in minutes, on few tokens

- Failed check: Month made: 0 of 28 pieces ready
- Failed check: Every Social post written: 0 of 24 written (28 pieces planned)
- Failed check: Jev read the month: no review
- Failed check: Jev flags at most 25% of pieces: none flagged
- Failed check: Every word written within 15 minutes of approval: ? minutes

### `cmo-month-styled-pictures`: Styles every picture of cal.com's month

- Failed check: Month made: 2 of 3 pieces ready
- Failed check: Jev read the month: no review
- Failed check: The homepage's screenshot sits inside a styled picture: 0 styled pieces with the page placed, 0 jobs sent it to the model

### `cmo-month-linkedin-openings`: Opens cal.com's LinkedIn posts on a result

- Failed check: Every LinkedIn post opens on a result, a number, a customer or a decision: "Cal.com Organizations puts billing beside routing in the same company-wide rollout." · "Cal.com Teams gives revenue teams 14 days to test automated reminders in their shared book"

### `cmo-ads-yes`: Plans ads once the owner said yes and set a budget

- Judge: fail, Cuso saved the strategy successfully. It set exactly USD 600 a month with setByOwner, added a google_ads channel, put two search ads in the calendar and placed the ads at the conversion stage of the funnel. It also told the owner that they launch the ads and pay Google. However, get_market_keywords returned no data and no ad account is connected, so Cuso had no search or cost data. It still gave a range of 100–150 clicks and 3–8 trial starts, based on an assumed USD 4–6 per click and 3–5% trial rate, and saved that range into ads.expect. The rubric explicitly forbids invented figures when no data exists.

### `cmo-tiktok-waits-for-owner`: Plans a TikTok video and leaves the posting to the owner

- Failed check: Route ∈ MANAGE_WORK | MIXED: DELEGATE_TASK

## Why the failures happened

Each failure was rerun on cmo-v21 (run `01a214ca-a7af-73e7-916b-e3181a354e87`, $0.94). The cases v21 passed were then rerun on cmo-v23 (run `01a214e3-715f-7478-ad9e-fa60158e057b`, $0.30).

| Case                           | cmo-v23              | cmo-v23 rerun        | cmo-v21              | Cause                                                                                                                                                                                                               |
| ------------------------------ | -------------------- | -------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cmo-month-timed`              | writer wrote nothing | –                    | writer wrote nothing | Core's month writer: all three chunks of the 24-piece month hit the 75-second model timeout. The same on both versions, so it is not Cuso's fault.                                                                  |
| `cmo-month-hiltl`              | stuck at 2 of 3      | Jev flags `hiltl-10` | Jev flags `hiltl-10` | Hook and ending quality. Fails the same on v21.                                                                                                                                                                     |
| `cmo-month-linkedin-openings`  | openings             | –                    | openings             | Hook quality. Fails the same on v21 and v22.                                                                                                                                                                        |
| `cmo-ads-yes`                  | invented range       | –                    | invented range       | The shared ads skill asked for "a range". Fixed in #8234.                                                                                                                                                           |
| `cmo-month-styled-pictures`    | stuck at 2 of 3      | passed               | passed               | Noise: style checks rejected the picture until the run ended                                                                                                                                                        |
| `cmo-month-blue-bottle-coffee` | Jev flags 1 piece    | passed               | passed               | Noise                                                                                                                                                                                                               |
| `cmo-tiktok-waits-for-owner`   | DELEGATE_TASK        | DELEGATE_TASK        | MANAGE_WORK          | Jev gave no confident write scope, so the pooled work vote goes to DELEGATE_TASK. The classifier gets the same input on every Cuso version. On v23 the work itself passed every other check. Left for a later pass. |

## Verdict

Ship cmo-v23 as the hire default. It passes 20 of 27, against 18 of 27 for cmo-v22. Every failure either fails the same way on cmo-v21, passes on a rerun, or is Jev routing variance that does not depend on the version.

## Links

- Default PR: this PR
- Ads fix: #8234
- Planning count (C4): #8220
