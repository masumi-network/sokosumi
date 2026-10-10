# Visible rich-row isolation

Visible appends reproduce the stall. The final paired control shows the same
incoming row IDs in both viewports; the cheap offscreen append was not an equal
rendering workload. No individual tested child component explains the whole stall.

## Run

Build the [portable rich fixture](README.md#portable-rich-rows), then:

```bash
python3 apps/apple/prototypes/lazy-prepend/measure.py \
  /tmp/swiftui-rich-rows/ScrollReproduction.app \
  /tmp/swiftui-visible-results --rich --reveal-rows --pairs 3 --check-budget
```

Both directions use the same nonanimated `ScrollViewReader.scrollTo` to reveal
the first inserted row at the top. Measurement includes insertion, reveal, and
subsequent rich-row updates. This is not a pure insertion-algorithm comparison.
Native visibility callbacks verify the target and snapshot the visible IDs after
one second. Disappearance clears IDs when lazy rows leave the hierarchy. The
runner rejects paired viewports with different visible IDs or corpus fingerprints.

All runs use Release and team GVWN7HXYJB. The final three alternating pairs
completed 30 publications with 600 rows, identical fingerprints, and matching
visible IDs on all 15 paired pages. The viewport shows 5, 5, 8, 8, and 7 rows
after the respective pages in both directions.

| Final visible control | Median window maximum | Worst callback gap | Windows over 25 ms |
| --- | ---: | ---: | ---: |
| Prepend | 58.4 ms | 76.4 ms | 15 / 15 |
| Append | 55.5 ms | 69.0 ms | 15 / 15 |

Nonpublication worst gaps were 41.7/20.8 ms. These are actual main-thread callback
gaps, not FPS or presented-frame hitch durations. The fixed 25 ms threshold is a
diagnostic budget. Raw results, launch orders, and controls are in
[visible-measurements.json](visible-measurements.json).

## Component controls

Pass one `--omit` value to the same rich build. The build script changes only the
copied source files; the corpus and row IDs stay identical across directions.

- `body-selection`: disables the outer Markdown body's selection. Code and quote
  selection remain enabled. Native text hosting/layout can change.
- `clamp`: bypasses `ExpandableMessageBody` measurement, preferences, clipping,
  and expansion controls. It applies to bodies and quotes; long content may grow.
- `code-highlighting`: suppresses the code block's highlighting task. Source,
  monospaced font, padding, and scrolling remain; token colors and later state
  updates disappear.

Each screen ran three alternating pairs / 30 publications:

| Component omitted | Prepend median / worst | Append median / worst |
| --- | ---: | ---: |
| None | 49.8 / 64.4 ms | 51.2 / 58.0 ms |
| Body selection | 38.2 / 57.2 ms | 48.9 / 61.4 ms |
| Clamp | 41.8 / 53.0 ms | 48.6 / 65.3 ms |
| Code highlighting | 38.4 / 57.1 ms | 38.2 / 50.0 ms |

Every screen retained stalls; clamp had 29/30 windows above budget, the others
30/30. The apparent highlighting gain was checked in three interleaved on/off
cycles, reversing variant order in the middle cycle. It did **not** hold:
full-row prepend median 51.0 ms versus highlighting-disabled 57.4 ms; append
50.3 versus 48.0 ms. The disabled variant reached 100.0 ms. One full-row run also
had a 47.4 ms nonpublication gap. Do not promote these screen deltas into a
production optimization claim.

The additional `--fixed-row-height` control retains rich content inside clipped
160-point row bounds. Three interleaved natural/fixed cycles measured prepend
median 50.0/44.2 ms and append 47.5/45.3 ms; all 60 windows remained above budget.
It changes visible density and clips content, so it is not a production solution.
Earlier snapshot IDs retained disappeared rows; their limitation is recorded in
the raw data. The final control above repeats after fixing the bookkeeping.

## Native profile

Two separate preliminary full-row captures use the host Mac's `SwiftUI` template
plus `Points of Interest`, high-frequency CPU sampling, and layout tracing.
The five exact `Insert page` signposts scope each CPU slice to publication
through +180 ms. Startup and late finish/JSON serialization microhangs are outside
these slices. Results are retained in
[visible-profile-summary.json](visible-profile-summary.json).

| Sampled main-thread evidence over five windows | Prepend | Append |
| --- | ---: | ---: |
| Total CPU | 415.8 ms | 444.9 ms |
| ScrollViewUtilities.sizeThatFits | 163.1 ms | 6.0 ms |
| RootGeometry.value.getter | 155.4 ms | 2.6 ms |
| TracingLayoutEngineBox.sizeThatFits | 199.0 ms | 183.8 ms |
| Selectable-text/TextKit region | 50.4 ms | 47.6 ms |

Symbol/region weights are inclusive and overlap; do not sum them. Both directions
spend substantial time in graph/layout work. Prepend adds a pronounced root/scroll
sizing lane. Body getters and code styling are comparatively small sampled paths;
that does not establish low downstream component cost. Syntax capture and image
thumbnail decoding run on background threads; no main-thread PNG/ImageIO decoder
frames were sampled in these slices.

All three captures lacked SwiftUI view/cause data, including a separate native
SwiftUI `App`/`Window` host experiment. That experiment was discarded. CPU stacks
localize the expensive region, but cannot assign deferred framework costs to one
source component. The component screens also fail to isolate a reliable single
culprit. No safe production fix or framework defect is established.

To capture a new native profile after building:

```bash
xcrun xctrace record --template SwiftUI --instrument 'Points of Interest' \
  --output /tmp/swiftui-visible-prepend.trace --time-limit 25s \
  --env REPRO_DIRECTION=prepend --env REPRO_REVEAL_ROWS=1 \
  --env REPRO_OUTPUT=/tmp/swiftui-visible-profile.json \
  --launch -- /tmp/swiftui-rich-rows/ScrollReproduction.app/Contents/MacOS/ScrollReproduction
```

Repeat with append and fresh output paths. Keep captures separate from unprofiled
timings. Original traces remain under `/tmp/swiftui-visible-profile-20261010`.
This at-rest fixture does not verify production scrolling, streaming, or position
restoration. The production LazyVStack and its behavior remain unchanged.

## No-insertion follow-up

The [no-insertion control](no-insertion-isolation.md) preloads all 600 messages and
reveals the same visible row IDs without changing the row array. Fresh three-way
baselines use a common reveal callback. It reproduces comparable stalls and
graph/layout CPU without insertion. The measurements above remain historical;
the follow-up does not establish a production speedup or a single faulty child.
