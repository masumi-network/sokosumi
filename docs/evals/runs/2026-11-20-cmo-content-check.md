# Eval run: cmo-content-check

Backfilled from the agent report, no run id.

- Date: 2026-11-20
- Run: backfilled from the agent report, no run id (one local run is named in the report as `01a1f7c4`, one eval run as `01a1f6c3`)
- Environment: local
- Commit: PRs #7703, #7706, #7711, #7714, #7715, #7716, #7734, #7740, #7743, #7757 (Core fixes; no Cuso skill, prompt or tool change)
- Bots: Cuso on the version current that day (not recorded in the report)
- Judge: not recorded
- Repeats: 1
- Cost: about $10.30 for the whole task, of which about $1.40 on local evals for the #7734 pass

## Results

| Change                                                       | Cases                                            | Result                                                                                                                                |
| ------------------------------------------------------------ | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| #7706 (no words on a styled picture's steps)                 | 6 CMO cases                                      | 5 passed; `cmo-month-cal-com` failed one Jev hook check                                                                               |
| #7716 (new newsletter case)                                  | `cmo-month-newsletter`                           | the newsletter check passed (186-word issue with subject); the case failed on Jev's LinkedIn hook rule                                |
| #7734 (style references already used are left out of search) | `cmo-picture-style`                              | passed                                                                                                                                |
| #7734                                                        | `cmo-month-styled-pictures` ×3                   | 1 passed, 1 failed (homepage screenshot redrawn wrong in 8 tries), 1 lane-setup error; "No reference on two pieces" held in every run |
| #7740 (real screenshot placed by Core)                       | `cmo-month-styled-pictures`, 4 runs plus repeats | one run passed every check; screenshot rejections 8 of 8 before, 0 on the final code                                                  |

Not eval runs, but measured on the same pictures: the style check passed 17/27 with #7706 against 11/27 before (9 real NMKR pieces, 3 tries each); a "no masthead" prompt line scored 38/54 against 38/54 and was not shipped.

## Before and after

No baseline weekly run.

## Failed cases

- `cmo-month-cal-com` and `cmo-month-newsletter`: the LinkedIn post opens on advice (Jev's hook rule).
- `cmo-month-styled-pictures`: the homepage-screenshot piece (before #7740); later runs failed on the model's own extra words from a magazine-cover reference, colours and busy logo corners; two lane-setup errors.

## Why the failures happened

The LinkedIn hook misses are a repeated writing weakness of the Cuso version then live (the same post shape failed in both cases), not caused by these fixes; cmo-v8 later took it on. The screenshot misses were the image model redrawing the page, which #7740 removed by placing the real capture. The remaining picture misses come from the reference's own lettering and the logo-corner rule.

## Verdict

Ship (all ten PRs merged). None changed Cuso's behaviour, so no evals were owed; the touched cases show no breakage.

## Links

- Contact sheets and A/B pictures (agent scratchpad, may be gone): session feb5a7f8's `scratchpad/cc/`
