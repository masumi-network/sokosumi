# Eval run: strong-model-choice

Written by hand: it compares several local runs, one per candidate model, so no single `--summary-md` covers it. Run ids are given per table.

- Date: 2026-11-21
- Runs: listed per table below (manual, completed)
- Environment: local (four copies of one local eval database)
- Commit: `6a53c831e0` feat(cmo): add cmo-v10, Cuso's hard work on GPT-6.2 Sol; trial versions were local only and never committed
- Bots: Soko Bot v33 / v34 and trial copies of v34 with another `strongModel`; Cuso cmo-v8 (strategy, whole turn on the candidate) and cmo-v9 with a candidate `strongModel` (chat)
- Judge: claude-code:claude-opus-5-5 (strategy cases score by their checks only)
- Repeats: 1
- Cost: about $50 of Gateway spend in all, from the turns' own cost columns

## Results

Candidates: GPT-6 Luna (today's model), GPT-6.1 Terra, GPT-6.2 Sol (OpenAI, global only), Gemini 4 Hydrogen and Gemini 4 Carbon (Vertex in an EU zone, zero retention, no training). Neon and Argon were not run: Neon costs 1.5x Carbon, Argon is older than Carbon at the same price.

### Soko Bot, the six cases v34 routes up

delegate-with-daily-checkin, hire-agent-with-budget, launch-plan-weekly-nudge, parallel-comparison, wait-then-hand-over, expensive-work-asks-first.

| Strong model | Run                                    | Passed | Cost  | Median time |
| ------------ | -------------------------------------- | ------ | ----- | ----------- |
| none (Luna)  | `01a1fbc7-6211-7204-8048-f70cab528b4b` | 4/6    | $0.15 | 36 s        |
| Terra        | `01a1fbdb-83a7-7258-a11b-25db7bec6586` | 5/6    | $0.83 | 37 s        |
| Sol          | `01a1fc88-6058-77f8-b80b-f81d911c62d5` | 5/6    | $1.28 | 30 s        |
| Hydrogen     | `01a1fc8b-4bee-7048-a7e5-d32378a52f4d` | 4/6    | $1.10 | 55 s        |
| Carbon       | `01a1fc90-d392-7215-91ed-1a2244baa061` | 4/6    | $1.71 | 70 s        |

### Cuso, eight chat cases Jev reads as complex

cmo-asks-before-planning, cmo-correction-everywhere, cmo-funnel-aida, cmo-ads-yes, cmo-talking-video-networks, cmo-background-run, cmo-seo-asks-specialist, cmo-competitor-search-ads.

| Strong model | Run                                    | Passed | Cost  | Median time |
| ------------ | -------------------------------------- | ------ | ----- | ----------- |
| none (Luna)  | `01a1fc8c-c9bc-736c-83f8-d8e293e156b2` | 6/8    | $0.20 | 60 s        |
| Terra        | `01a1fc96-caef-746d-8869-058a6a767281` | 6/8    | $1.12 | 55 s        |
| Sol          | `01a1fca0-79cd-77b0-8c53-9d711287be74` | 7/8    | $2.54 | 45 s        |
| Hydrogen     | `01a1fcaa-c655-7761-8688-c8f2bf4c5e2f` | 7/8    | $3.45 | 100 s       |
| Carbon       | `01a1fcbd-b799-759f-a8cb-39a41053dc12` | 6/8    | $4.12 | 129 s       |

### Cuso strategy, the ten brand cases and cmo-brand-fit, whole turn on the candidate

| Model    | Run                                                                                                                  | Passed | Cost   | Typical time |
| -------- | -------------------------------------------------------------------------------------------------------------------- | ------ | ------ | ------------ |
| Luna     | `01a1fbbe-5552-72ea-aecf-9b85f8a6ea62`, rerun `01a1fc99-a359-740f-812b-578aa091bdaa` of the four Gateway-error cases | 7/11   | $1.84  | 8 min        |
| Terra    | `01a1fc2e-b3a1-7117-9ada-a4ff62eafa1c`                                                                               | 2/11   | $6.27  | 7 min        |
| Sol      | `01a1fc6d-09d2-76a9-a105-d2e83590f273`                                                                               | 11/11  | $6.93  | 5 min        |
| Hydrogen | `01a1fcd3-dafb-7371-a02a-764d2e47e453`                                                                               | 9/11   | $10.36 | 9 min        |
| Carbon   | not run (lost both chat comparisons on cost and speed)                                                               |        |        |              |

## Before and after

Luna is the before in every table.

## Failed cases

- Every model fails expensive-work-asks-first (accepts an open-ended standing order without asking about cost) and cmo-ads-yes.
- Terra's strategy failures are nearly all one rule: TikTok is neither planned nor left out with a reason that fits the buyer. One turn stalled (stream silent for 90 s).
- Hydrogen missed the daily check-in schedule in delegate-with-daily-checkin; Carbon failed it only on a failed contact search.
- Luna's strategy failures: a funnel promising video with no video piece, three of four weeks planned, TikTok left out for a business audience, a duplicate title, and brand-fit asking instead of saving.

## Why the failures happened

The shared failures are prompt and rule problems the model does not fix. Terra reads the strategy skill's "every live network" rule less literally than Luna and Sol. Luna's four Gateway errors were one 50-minute window of "Gateway request failed" across cases; the rerun is counted.

## Verdict

- Soko Bots (v34): Terra. Same pass rate as Sol on the routed cases for 35% less; routing adds about $7 a month on chat and $10 to $28 on background runs at today's traffic.
- Cuso (cmo-v10): Sol. Best on chat (7/8) and the only model to pass every strategy case. Hydrogen ties on chat and runs in the EU, but costs 36% more and takes twice as long; on strategy 9/11 for 1.5x Sol's cost.
- Strategy turns stay on Luna for now (the owner's call: route by complexity, not every strategy turn). If they move to Sol: +$16 to +$81 a month at about 86 strategy turns, the range between the eval runs' cost ratio (3.8x) and re-pricing production tokens at Sol's list price.

## Links

- Routing calibration on 587 production chat turns: PR body.
- Soko Bot full suite on v34: `2026-11-21-soko-bot-v34-routing.md`.
