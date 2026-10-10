# No-insertion rich-row control

Revealing rich rows reproduces the stalls without inserting any data. The new
control keeps all 600 messages loaded and leaves the row array unchanged during
measurement. This establishes that insertion is not necessary for the observed
delay; it does not identify one faulty row component or quantify an additive
insertion cost.

## Run and method

Build the [portable rich fixture](README.md#portable-rich-rows), then:

```bash
python3 apps/apple/prototypes/lazy-prepend/measure.py \
  /tmp/swiftui-rich-rows/ScrollReproduction.app \
  /tmp/swiftui-no-insertion-results --rich --reveal-rows \
  --no-insertion-control --pairs 3 --check-budget
```

Prepend and append begin with 100 rows and insert five 100-row pages. The
no-insertion mode begins with 600 rows and inserts none. All three modes start
at the top, prepare the same corpus before measurement, and use the same
`revealTarget` state callback to call `ScrollViewReader.scrollTo`, without
animation. They reveal rows 100, 200, 300, 400, and 500 at the top. Each operation
has the same one-second wait before and after it.

Three sequential cycles rotate mode order, placing each mode first, second,
and third once. No build or profiler runs alongside these benchmarks. The
host is Homer, macOS 27.0.1 (26A434), arm64; Xcode 27.0 (27A266a). The 1100 × 800
point window and full rich components are unchanged. Builds use Release and
team GVWN7HXYJB, with the existing shared DerivedData.

The runner verifies matching corpus fingerprints and current visible row IDs
within every cycle. All nine runs finish with 600 rows. All 15 no-insertion
records contain `inserted_rows: 0` and `rows: 600`; the source never changes the
row array in this mode. Each compared viewport contains exactly the same IDs,
with page densities 5, 5, 8, 8, and 7.

## Unprofiled measurements

[Raw runs and summary](no-insertion-measurements.json) preserve all nine native
runs / 45 operation windows:

| Mode | Median window maximum | Worst callback gap | Windows over 25 ms |
| --- | ---: | ---: | ---: |
| Visible prepend | 41.2 ms | 50.1 ms | 15 / 15 |
| Visible append | 45.4 ms | 50.0 ms | 15 / 15 |
| No insertion, reveal only | 41.4 ms | 54.0 ms | 15 / 15 |

These are actual main-thread callback scheduling gaps, not presented-frame
durations or FPS. Measurement includes the operation through +700 ms: state
application, native scroll/reveal, lazy realization/layout, and later rich-row
updates. The 25 ms gate intentionally returns 1 because stalls reproduce.
Nonoperation worst gaps were 21.3, 8.7, and 40.9 ms respectively; the
no-insertion process also experienced a delay outside the operation windows.

The older two-way [visible control](visible-row-isolation.md) used `rows.count`
to trigger reveal. This comparison uses a common `revealTarget` callback in
all three modes and remeasures both insertion baselines. Lower absolute times
than the historical runs are not a production optimization claim.

Preloading does not pre-render every lazy row. The loaded-list footprint,
surrounding row order, jump distance, and native target traversal differ between
modes even though settled visible content matches. Do not subtract these
numbers to claim isolated insertion cost. The control answers whether insertion
is required to reproduce the delay.

## Native profile

Three fresh app-scoped native captures use the host Mac's `SwiftUI` template,
`Points of Interest`, high-frequency CPU sampling, and layout tracing. They run
sequentially and separately from the unprofiled comparison. `Insert page`
signposts mark the insertion modes; `Reveal page` marks no-insertion. Five exact
operation signposts scope each capture to +180 ms. Startup and finish/JSON
serialization are excluded. [Profile evidence](no-insertion-profile-summary.json)
retains the operation marks, profiled callback results, per-window CPU, symbol
patterns, and compact inclusive/leaf tables.

| Sampled main-thread CPU over five windows | Prepend | Append | No insertion |
| --- | ---: | ---: | ---: |
| Total CPU | 427.8 ms | 431.3 ms | 433.9 ms |
| Graph update stack | 318.4 ms | 308.7 ms | 307.8 ms |
| TracingLayoutEngineBox.sizeThatFits | 222.6 ms | 174.9 ms | 167.2 ms |
| ScrollViewUtilities.sizeThatFits | 187.7 ms | 5.9 ms | 4.7 ms |
| RootGeometry.value.getter | 177.3 ms | 2.2 ms | 1.6 ms |
| Selectable-text/TextKit region | 47.5 ms | 44.5 ms | 44.3 ms |

Inclusive symbol and region weights overlap; do not sum them. Both visible
append and no-insertion reproduce substantial graph/layout CPU without the
large prepend root/scroll sizing lane. Prepend still has that extra lane, but
its total sampled CPU is comparable. These samples do not isolate an additive
prepend penalty.

The longest callback gaps in the three profiled runs were 67–87 ms for prepend,
54–92 ms for append, and 67–96 ms without insertion. Aligning each longest raw
callback interval to its operation signpost gives 90.6–99.8% sampled main-thread
running coverage across all 15 gaps. Totals and coverage include samples with
missing backtraces; symbol attribution requires a stack. Coverage uses actual
sample weights, not a 1 ms assumption per sample. Alignment retains the small mark-to-signpost call
latency. The profiled delays are predominantly CPU work, rather than a blocked
main thread.

Syntax capture and image decoding are sampled on background threads. No
main-thread decoder frames matched the listed PNG/ImageIO patterns. In the
no-insertion capture, `MessageRowView.body` samples account for 8.0 ms,
Markdown content 3.5 ms, expandable body 1.2 ms, and code styling 0.8 ms.
Small body-getter weights do not establish small downstream component cost.

All three native captures warn that no SwiftUI view/cause data was collected.
The CPU stacks localize expensive graph/layout work but cannot assign deferred
framework costs to a single row component. Profiler overhead is visible too:
11.7 ms of no-insertion leaf SHA-256 CPU comes from `Trace_Handle.write` /
`writtenBacktrace`, not production document hashing. Do not treat profiled gap
durations as release performance, or sum overlapping framework stacks.

Original native traces, exports, and scoped analysis remain under
`/tmp/swiftui-no-insertion-profile-20261010`. To repeat a capture:

```bash
xcrun xctrace record --template SwiftUI --instrument 'Points of Interest' \
  --output /tmp/swiftui-no-insertion.trace --time-limit 25s \
  --env REPRO_DIRECTION=no-insertion --env REPRO_REVEAL_ROWS=1 \
  --env REPRO_OUTPUT=/tmp/swiftui-no-insertion-profile.json \
  --launch -- /tmp/swiftui-rich-rows/ScrollReproduction.app/Contents/MacOS/ScrollReproduction
```

Use fresh output paths for prepend and append. Enable layout tracing in recording
options to match these captures. The repository's SwiftUI trace analyser can
list `Reveal page` or `Insert page` signposts and scope analysis to their times.

## Verification and conclusion

Both rich and bare Release binaries build and pass strict signature verification
with team GVWN7HXYJB. The runner checks all nine rich runs for matching current
viewports, corpus fingerprints, final counts, and per-operation insertion counts.
One additional bare single-line pair with 30-row pages ends at 250 rows per
direction and passes all ten 25 ms publication windows; it is a smoke check,
separate from the rich comparison.

The new result is that native reveal/realization/layout can reproduce comparable
delays without changing the row data. The next investigation should focus on that
shared path rather than assuming older-page insertion is the sole cause. No
single-component diagnosis, framework defect, or safe production fix follows
from these captures. Keep the reproduction open as a draft.

No production rendering, scrolling, streaming, or restoration behavior changed
in this follow-up. This at-rest fixture does not verify those production flows.
