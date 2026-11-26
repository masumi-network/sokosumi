# Eval run: cmo weekly review measures last week

- Date: 2026-11-25
- Runs (local, in-process): `01a21439-5004-771f-b30a-1addb3fe3998` (final, 2 repeats); earlier `01a21435-a4a7-77bf-911b-15aaffe115f3`, `01a21438-252e-73de-bced-ef4b6b44684c` while the fixture was fixed
- Environment: local
- Commit: branch `fix/cmo-weekly-review-last-week` on main `d43b25c532`
- Bots: Cuso on the hire default (cmo-v20)
- Judge: claude-code:claude-opus-5-5
- Repeats: 2
- Cost: $0.57 final run, $1.15 all runs

## Results

| Case                          | Repeat 1 | Repeat 2 |
| ----------------------------- | -------- | -------- |
| `cmo-weekly-review-last-week` | passed   | passed   |

Both turns asked `list_social_post_statistics` for exactly 18 to 24 November (the run's today was the 25th), reported the three X posts with the numbers X returned (2,310, 960 and 1,840 impressions), ignored the four drafts dated next month, and filed a weekly report with a hold verdict.

## Before and after

Before: the weekly packet named no date and listed "Social posts, last 14 days" by change date, so entry.fyi's review of 23 November read December's drafts as last week, asked for statistics of 13 to 20 December, found none and told the owner to reconnect X. After: the packet says "Today: 2026-11-23. Last week: 2026-11-16 to 2026-11-22" and lists only posts published in that range (`cmo-context.service.test.ts`).

## Failed cases

None in the final run. The earlier runs failed on the fixture: the analytics lookup (`list_integration_tools`) fails without connected analytics, and posts without stored statistics made Cuso refresh them and blame the connection; the case now allows the lookup to fail and seeds the statistics X would have returned.

## Verdict

Ships for every Cuso version: the packet is Core's, not a version's.
