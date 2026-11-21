# Eval run: model-routing

Backfilled from the agent report, no run id.

- Date: 2026-11-20
- Run: backfilled from the agent report, no run id
- Environment: local (throwaway worktree of origin/main `352478929a`, cloned local eval database)
- Commit: none (research, no PR)
- Bots: Soko Bot v33 on gpt-6-luna against local-only trial versions on Qwen3.7 Flash
- Judge: local Claude Code
- Repeats: 1 on Luna; 3 on Qwen3.7 Flash for `weekly-wrap`
- Cost: about $0.03 Gateway spend

## Results

| Case                           | v33 on Luna                         | v33 on Qwen3.7 Flash                                                                                                                  |
| ------------------------------ | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `weekly-wrap`                  | passed ($0.0052, 30 s)              | failed, then passed, then passed (weak). The failing repeat answered "Nothing to add." with no wrap. Cost $0.0051 / $0.0024 / $0.0039 |
| `dreaming`                     | passed, weak ($0.0048, 36 s)        | passed, weak ($0.0049, 72 s)                                                                                                          |
| `quiet-standup`, `quiet-delta` | skipped (needs a connected mailbox) | skipped                                                                                                                               |

The report also quotes Cuso's strategy cases on cheaper models: Luna 9/10, Qwen 4/10, DeepSeek 0/10 (no run ids or dates given).

## Before and after

No baseline weekly run. The comparison is Luna against Qwen3.7 Flash on the same cases.

## Failed cases

- `weekly-wrap` on Qwen3.7 Flash, 1 of 3: "Nothing to add." with no wrap, copying the dreaming reply.

## Why the failures happened

Qwen3.7 Flash copied the dreaming turn's empty reply into a weekly wrap. It was also not meaningfully cheaper per turn: one run had 0% cache hits and cost the same as Luna, because Luna's cache reads make it about as cheap as the "cheap" models on our traffic.

## Verdict

Don't route Soko Bot turns to a cheaper model: about $5 a month saved at best, and it failed 1 of 3 weekly wraps. For Cuso the report recommends the cache-hit gap and the flex tier instead, and measuring strategy turns on a stronger model; those are Patrick's decisions and have no eval run yet.

## Links

- Raw results (agent scratchpad, may be gone): session 28475d11's `scratchpad/routing-eval-results.tsv`
