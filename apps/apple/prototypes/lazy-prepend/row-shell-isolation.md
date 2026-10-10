# Message-row shell component isolation

The tested shell components do not individually explain the rich-row reveal
stalls. The original production row shell also stalls, so extracted diagnostic
helpers are not required to reproduce them. This investigation changes copied
fixture sources only; it does not remove production row actions or ship an
optimization.

## Component screens

Measured on Homer, arm64, macOS 27.0.1 (26A434), Xcode 27.0 (27A266a), Release,
Developer ID team **GVWN7HXYJB**. Each screen uses three fresh processes per
variant, five reveals per process, and rotating variant order. No build, test,
or profiler runs during the timings. Diagnostics are disabled. Each screen has
its own same-build `none` baseline; do not compare absolute timings across builds.

All 39 screening processes have the same corpus SHA-256, 600 final messages, and
visible row IDs: five/five/eight/eight/seven rows at targets 100/200/300/400/500.
They reveal preloaded rows without mutating the array. **All 195 windows exceed
25 ms.** These are main-thread callback scheduling gaps through +700 ms, not
presented-frame durations or FPS. The threshold is a fixed diagnostic budget.

| Screen | Baseline median / worst | Control median / worst |
| --- | ---: | ---: |
| Ordinary content branches simplified, outer shell retained | 50.0 / 83.3 ms | 51.9 / 72.1 ms |
| `onHover` instead of `onContinuousHover` | 50.0 / 83.3 ms | 50.0 / 83.3 ms |
| Skip unchanged false hover-rest writes | 50.0 / 83.3 ms | 60.4 / 70.5 ms |
| Group 12 state fields into one state value | 55.0 / 66.7 ms | 57.3 / 66.7 ms |
| Resolve the two action font metrics at the common transcript environment | 55.0 / 66.7 ms | 66.5 / 79.8 ms |
| Extract identical accessibility action buttons | 50.0 / 83.3 ms | 50.0 / 83.3 ms |
| Explicit context-menu overlay sizing, early screen | 50.0 / 83.3 ms | 57.8 / 83.3 ms |
| Move the same three alerts onto a background leaf | 56.4 / 76.2 ms | 55.6 / 79.0 ms |
| Original row shell, without row-level diagnostic extractions | 56.4 / 76.2 ms | 58.9 / 78.5 ms |

No action-preserving control gives a reliable repeated gain. In particular, the
first-cycle accessibility gain disappears in later cycles. The original-row
control retains the prepatch production shell, but still shares copied rich-child
controls and the transcript metric scope; it is not a wholly unpatched app.
The early menu-sizing screen predates the guard that returns native fallback for
unspecified/nonfinite proposals. Corrected sizing is covered by native menu tests;
the early timings are retained as historical evidence, not a recommended change.

The `row-content` control covers ordinary fixture rows, keeping the same rich
children, header, spacing, and outer interactions. It forwards quote/reaction
handlers in the current source. It does not cover deleted/editing/thought/outbound,
skill/unfurl/result/thread variants and is not a generic production replacement.
State grouping changes invalidation granularity. Shared metrics use the same
native scaling bases (body 28 pt, callout 16 pt), but do not prove parity for
row-local font overrides or all dynamic-type transitions.

## Final overlay comparison

The `row-overlays` control combines only the seen-by and action-bar decoration
layers in one native `ZStack`. Seen-by keeps bottom-trailing placement; the action
bar keeps top-trailing placement, offsets, focus, popover, and its own menu surface.
The outer context-menu overlay remains above the decorations. No actions or alerts
are removed. Timing fixtures have no seen-by payload; native tests cover that
placement separately.

Measured across midnight on 2026-10-10–11, with diagnostics off. Four renderers,
three directions, three rotated cycles: **36 runs / 180 windows** from one signed
binary. Matching fingerprints, visible IDs, final counts, and separate geometry
checks within 0.5 pt are retained in [raw evidence](row-shell-measurements.json).

| Renderer | Prepend median / worst | Append median / worst | No insertion median / worst |
| --- | ---: | ---: | ---: |
| Default instrumentable shell (`none`) | 51.4 / 74.7 ms | 56.7 / 75.3 ms | 51.3 / 74.6 ms |
| Original row shell | 50.8 / 73.9 ms | 50.0 / 66.6 ms | 48.9 / 66.7 ms |
| Combined decoration overlays | 66.6 / 74.3 ms | 56.2 / 75.6 ms | 55.6 / 72.3 ms |
| Content-only diagnostic renderer | 50.7 / 68.0 ms | 50.0 / 66.9 ms | 43.4 / 61.2 ms |

**179 / 180 windows exceed 25 ms.** The only below-budget window is content-only
without insertion. Overlay consolidation does not improve the symptom; prepend
and no-insertion medians worsen. Removing the entire shell still leaves stalls.
Compared with the original shell, the broad content-only median gain is limited
to no-insertion in this cohort. This qualifies the larger historical shell delta:
diagnostic helpers and capture/run variation must not be mistaken for one faulty
production component. Original-shell stalls remain reproducible without them.

A corrected menu-sizing comparison adds six fresh no-insertion processes / 30
windows. Baseline median/worst **60.8 / 83.3 ms**; finite-proposal control
**58.4 / 86.4 ms**. All 30 windows exceed budget, and the first control cycle is
worse. No repeatable fix results. Six separate diagnostic processes verify the
same heights and IDs for full, original, combined-overlays, content-only,
simplified-content, and corrected menu-sizing renderers. Their timing values are
not performance evidence.

## Native CPU attribution

Eight separate native **Time Profiler + Points of Interest** captures use the same
final Release binary, with no SwiftUI layout tracing. Each scope includes five
exact `Reveal page` signposts through +180 ms, not startup or exit. Actual sample
weights include stackless samples in total CPU; inclusive regions overlap and
must not be added. Longest callback gaps are also aligned by raw uptime offsets;
one overlay capture's longest gap occurs about 438 ms after its mark, outside the
180 ms CPU-total scope, and contains only 9 ms main CPU in a 50 ms scheduling gap.
These observations are not presented-frame measurements.

The first capture suggests cheaper combined overlays; two repeats reject that
attribution:

| Capture cycle | Original main CPU | Combined-overlay main CPU | Original / combined graph CPU | Original / combined layout CPU |
| --- | ---: | ---: | ---: | ---: |
| 1 | 302 ms | 262 ms | 217 / 177 ms | 119 / 99 ms |
| 2, combined first | 309 ms | 293 ms | 223 / 213 ms | 109 / 109 ms |
| 3, original first | 277 ms | 347 ms | 198 / 242 ms | 113 / 118 ms |

Across 15 exact reveal windows per renderer, main CPU totals are **888 / 902 ms**,
graph **638 / 632 ms**, and layout **341 / 326 ms**. The third capture reverses
the apparent overall gain, and repeated unprofiled stalls worsen. These data do
not justify collapsing the overlays in production.

Single corroborating screens measure simplified content with the outer shell at
**283 ms** main CPU (graph 189 / layout 95 ms), and content-only at **245 ms**
(graph 173 / layout 105 ms). Original/full-rich and content-only have **43 ms**
each of sampled selectable-text/TextKit region CPU in those captures. Syntax
captures and PNG decoding occur in background stacks. Named row-body functions
account for 0–10 ms per capture; named menu bridge/handler functions for 0–3 ms.
Inlining and sampling mean these are not complete source-function costs.

The defensible location is **cold SwiftUI graph construction/update and layout of
rich rows**, shared by all reveal modes. The extra shell work remains distributed
across generic framework stacks; these profiles do not identify one expensive
source modifier. State grouping, metric sharing, hover changes, accessibility
extraction, alert relocation, and overlay consolidation supply no repeatable
stall reduction. A small production fix is not established. Retain row actions
and the current production LazyVStack.

See [native CPU evidence](row-shell-profile-summary.json) for exact scopes, region
patterns, stack summaries, callback alignment, and all failed repeats. Native
traces remain local under `/tmp/swiftui-row-shell-profile-20261011` and
`/tmp/swiftui-row-shell-repeat-profile-20261011`. Time Profiler provides no SwiftUI
view/cause graph; earlier SwiftUI-template captures also yielded no cause data.

## Native row-action verification

Five sequential team-signed Debug test runs passed **86 tests**, with zero
failures or skips. These use existing native-window suites with callback-backed
rows, separately from Release performance measurements:

| Control | Existing suites | Passed |
| --- | --- | ---: |
| `none` | MessageContextMenu, MessageHoverDelay, SeenByView, SeenByAttachmentReserve | 28 |
| `row-overlays` | Same four suites | 28 |
| `alert-host` | MessageContextMenu | 12 |
| `hover-events` | MessageHoverDelay | 6 |
| `menu-sizing` | MessageContextMenu | 12 |

Coverage includes body/quote/code/control-click menus, selection copy, quote
callback dispatch, hover-pill row ownership, editing menus, light/dark deletion
confirmation, hover delay and scrolling suppression, seen-by corner layout, and
its popover. It does not prove all keyboard-focus/reaction-picker lifetimes,
VoiceOver action dispatch, or every failure/send-to-self alert. Generated state
and metric variants were source-reviewed and compiled, not given separate native
interaction runs. The benchmark corpus intentionally has no callback-backed
room mutations; native action checks use richer action fixtures instead.

The copied test scheme keeps the timed fixture loop idle with `REPRO_INSPECT=1`.
Test selectors were enumerated before launch; recorded counts are nonzero.
Native bundles and per-control summaries remain locally under
`/tmp/swiftui-row-shell-20261010`.

## Run the portable controls

Build a fresh rich fixture with the existing builder, then run any component
against `--omit none` from the same binary:

```bash
bash apps/apple/prototypes/lazy-prepend/build.sh /tmp/swiftui-shell-controls --rich
python3 apps/apple/prototypes/lazy-prepend/measure.py \
  /tmp/swiftui-shell-controls/ScrollReproduction.app \
  /tmp/swiftui-shell-control-results --rich --reveal-rows \
  --direction no-insertion --omit row-overlays --pairs 3
```

Other current shell choices are `row-content`, `hover-events`, `hover-writes`,
`row-state`, `row-metrics`, `row-accessibility`, `menu-sizing`, `alert-host`, and
`original-row`. The historical flag name `--omit` also selects restructuring
controls; these do not necessarily omit a feature. Add `--diagnostics` only for
separate geometry/evaluation checks, and `--no-insertion-control` instead of
`--direction` for all three reveal modes. Keep processes sequential and avoid
interacting with the native measurement window.

Production scrolling, older-page anchoring, streaming, and saved-position logic
are unchanged. Static reveal controls do not verify those production flows.

Verified Release and Debug team-signed native builds, strict signing, 86 native
action tests, 81 unprofiled rich runs, six geometry runs, eight scoped native CPU
captures, and bare-build smoke. SwiftFormat, strict SwiftLint, Python/shell syntax,
documentation references, and normal commit hooks are required delivery checks.
