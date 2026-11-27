# E5 fault-injection probe: typed tool errors

- Date: 2026-11-27, 06:51–07:02 UTC (run by neon5, plan slot assigned by ownerbench)
- Experiment: E5, typed tool errors with one recovery hint per error class
- Code: #8424 at `123189d9a5` (Codex source pass), flag `typedToolErrors`
- Model: `openai/gpt-6-luna` on the ChatGPT plan; no Jev and no Gateway calls
- Design: 3 tools (`create_table`, `generate_image`, `create_social_post`) × 4 error classes (`conflict`, `busy`, `uncertain`, `invalid_input`) × 5 runs × 2 arms (baseline: plain error message; candidate: typed error + recovery note) = 120 runs, 0 runtime errors
- Not a benchmark run: a synthetic probe of one mechanism. The owner benchmark measures E5 next (batch 2, loop + E5 against loop only).

## Results

Only the 80 runs where the injected error fired count (table + image, 10 per class and arm). The `social` group never fired its error: the probe passed an invalid project id, which the tool's schema rejects before the injected error can fire.

| Class         | Arm           | Recovered         | Blind retry (duplicate write) | Stopped   | False done | Mean input tokens |
| ------------- | ------------- | ----------------- | ----------------------------- | --------- | ---------- | ----------------- |
| conflict      | baseline      | 4/10              | 0 (0)                         | 6/10      | 0/10       | 17,055            |
| conflict      | candidate     | 9/10              | 0 (0)                         | 1/10      | 0/10       | 26,046            |
| busy          | baseline      | 4/10              | 0 (0)                         | 6/10      | 0/10       | 15,388            |
| busy          | candidate     | 10/10             | 0 (0)                         | 0/10      | 0/10       | 17,861            |
| uncertain     | baseline      | 1/10              | 3/10 (3)                      | 6/10      | 0/10       | 13,965            |
| uncertain     | candidate     | 9/10              | 0/10 (0)                      | 1/10      | 0/10       | 19,018            |
| invalid_input | baseline      | 5/10              | 0 (0)                         | 5/10      | 0/10       | 14,561            |
| invalid_input | candidate     | 5/10              | 0 (0)                         | 5/10      | 0/10       | 14,755            |
| **All**       | **baseline**  | **14/40 (35%)**   | **3 (3)**                     | **23/40** | **0/40**   | **15,242**        |
| **All**       | **candidate** | **33/40 (82.5%)** | **0 (0)**                     | **7/40**  | **0/40**   | **19,420**        |

- **Recovered:** the run finished the task after the error: it read back current state on `conflict` and `uncertain`, waited on `busy`, or fixed the input. On `uncertain`, a strict recovery reads back state without repeating the committed write.
- **False done** was verified by hand: the probe's own counter flagged honest refusals written with curly apostrophes (8 baseline, 1 candidate), so those counts were corrected to 0.

## Verdict

**Useful, so E5 goes into batch 2.** It lifts recovery from 35% to 82.5% on error-bearing runs. It removes all three duplicate writes after a lost response. It ties on invalid input, and false done is 0 in both arms. Runs that hit an error use about 27% more input tokens (extra recovery steps instead of stopping); error-free steps are unchanged. The benchmark decides whether E5 is kept, under the same rule as every experiment: better on both sets, no newly failing journey, and tokens per turn no more than 10% worse.

## Links

- PR #8424; raw transcripts stay with neon5 (`neon5-probe-results.json`, not committed)
- [Experiments table](experiments.md)
