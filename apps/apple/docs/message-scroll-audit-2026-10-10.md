# Apple message scrolling audit — 2026-10-10

## Decision

Keep Apple's normal-direction `ScrollView` / `LazyVStack`, stable message IDs,
prepared Markdown, and native scroll phase/position APIs. Older-page insertion
at idle is a justified mitigation for the measured lazy-stack prepend cost.
It is not a universal requirement for SwiftUI lists.

Apple provides [scroll anchors](https://developer.apple.com/documentation/swiftui/view/defaultscrollanchor(_:for:))
for initial placement and size changes, and [scroll phase observation](https://developer.apple.com/documentation/swiftui/view/onscrollphasechange(_:))
for native motion and idle transitions. Using those APIs keeps the app aligned
with the framework.

## Apple findings and fixes

The existing [paging profile](scrolling-hover-harness.md) measured 55–65 ms
insertion frames at an 800 pt window. SwiftUI remeasured realized rows through
`LazyStack.measureEstimates` / `lengthAndSpacing`; a bare lazy-stack control
reproduced the prepend stall. Changing IDs, row equality, scroll bindings,
boundary chrome, or array projection did not improve it beyond measurement
noise. These are previous measurements, not new timing results from this change.

The audit found four fixable behavior problems:

- The old prepared snapshot hid new arrivals and returned stale Markdown while
  an older page waited. Projection now uses live rows from the first surviving
  snapshot message onward. Document lookup checks content, and the waiting
  snapshot supplies freshly prepared documents without releasing its prefix.
- Deleting or confirming the oldest row could misclassify a pending prepend.
  Projection and prepend detection now share the same surviving-row lookup.
- Programmatic scroll animations were treated as rest. Older pages and the
  settled position correction now require native `.idle`. Landing reads the
  current waiting snapshot and validates its room scope when it executes.
- An outgoing thread child could reevaluate old immutable rows against a new
  workspace scope before teardown. The child now validates its prepared scope
  before rendering. Hosted-window controls reproduced old visible text for
  both a replacement parent and a new generation of the same parent.

Per-row reading-position geometry writes into a non-observable holder; this
audit found no evidence that it rebuilds the entire transcript on every scroll.
The list implementation remains native. The lazy-stack insertion cost remains;
deferral moves it outside the active gesture rather than removing it.

## Verification

- Apple chat package: **1,157 tests pass** across 137 suites.
- Native hosted-window checks pass for older pages, streamed Markdown during
  a held page, reading-position retention, live-edge growth, history scrolling,
  jump preparation, hover behavior, and scroll phase semantics.
- Strict Swift lint and format checks pass. The performance runner's seven
  checker tests pass.
- Biome and the final diff whitespace check pass.

The Release CPU-work matrix passes all **12 cases**: room/thread, plain/mixed,
and 50/500/2,000 messages, with 30 wheel events per case. Stable scrolling
causes **zero transcript projection rebuilds and zero Markdown preparations**.
All **24 live-update checks** pass across room and thread, including edits,
prepared Markdown, optimistic reactions and rollback, arrivals, deletions,
pending/failed sends, and scope replacement. Both new native scope-change
controls and the existing thread reading-position check pass with the guard.

The final matrix rebuilt the changed thread guard in the retained copied
Release workspace and reran the runner's unchanged measurement/checker
functions. Raw logs, the binary snapshot, and a passing summary are in
`/tmp/sokosumi-scroll-audit-verified-20261010`. Earlier failed fixture attempts
remain separately recorded. The retained fixture now uses an in-memory token
store, current message initializer arguments, and a projection counter inside
the validated thread render branch.

The Apple CPU-work matrix checks avoidable projection work, not perceived
smoothness or FPS.

## Fresh frame measurements — 2026-10-10

Measured the current working-tree transcript in a foreground, team-signed
Release fixture on this Mac: macOS 27.0.1, Xcode 27.0, arm64, 60 Hz, and an
800 pt window. The fixture renders the real `RoomTimelineView` and mixed rows
(text, Markdown, pictures, quotes, reactions, and threads). Normal scrolling
starts with 600 messages. Paging starts with 100 of 600, uses the app's 100-row
page request and a deterministic 150 ms Core response. It injects phased wheel
and momentum events into the native scroll view. This isolates transcript
performance; it is not a recording of a signed-in production room or an iPhone.

All builds in this measurement pass use team **GVWN7HXYJB**, signed by
`Developer ID Application: utxo AG (GVWN7HXYJB)`. The disposable profiling app
retains the sandbox and adds `get-task-allow`; it uses `InMemoryTokenStore`.
No ad-hoc build or real account Keychain access is used.

| Scenario | Measured interval | Actual presentation hitches | Worst presentation delay |
| --- | --- | --- | --- |
| Normal scrolling, six flicks | 11.939 s | 3 | 16.67 ms |
| Older-page scrolling, five 100-row publications | 19.214 s | 22 | 83.33 ms |

These are Instruments' animation-hitch events, scoped to the fixture's
`MEASURE_BEGIN` / `MEASURE_END` logs. Startup hitches and termination hangs are
excluded. Four 83.33 ms hitches start about 50 ms after older-page publications
2–5. Hitch duration is missed presentation time; the trace does not provide
complete frame durations or a reliable aggregate FPS value.

The normal-scroll display-link callbacks separately recorded 12 gaps of about
33.33 ms, with median and p95 intervals of 16.67 ms. Unprofiled baseline paging
runs reproduced insertion-window callback gaps of 74–85 ms. Callback intervals
measure main-thread scheduling, not presented frames, and are not interchangeable
with the hitch table above.

### Bottleneck and tested controls

In the 170 ms window after the second older-page publication, Time Profiler
samples **114.5 ms of main-thread CPU work**. Inclusive stacks include
`AG::Graph::UpdateStack::update` (71.4 ms), `LayoutEngineBox.sizeThatFits`
(35.4 ms), and `LazyHVStack.lengthAndSpacing` (17.9 ms). `MessageRowView.body`
accounts for 2.0 ms. These weights overlap and must not be added. Together with
the previous bare-lazy-stack control, the evidence points to remeasurement and
layout of realized rich rows, rather than room-data processing or Markdown
preparation. Normal-scroll samples also show native hover dispatch and layout;
row body evaluation is 2.57% of sampled main-thread weight.

Three minimal controls were tested only in the disposable copy, with three
alternating pairs per control:

| Control | Comparable result | Decision |
| --- | --- | --- |
| Remove nested paragraph vertical `fixedSize` | First insertion window: baseline 76/85/74 ms; control 89/76/76 ms | Reject: no repeatable gain |
| Drop the pointer-only hidden action bar while scrolling | Normal callback gaps over 25 ms: baseline 11/14/13; control 11/12/15 | Reject: no repeatable gain |
| Give the entire unary message row its ideal vertical height | First publication window: baseline 67/70/71 ms; control 86/77/73 ms | Reject: slower |

The final row-height runs record the actual deferred publication time, rather
than only the earlier network/state update. The number of pages traversed varies
with native anchoring and scheduling, so whole-run costs with different page
counts are not treated as an improvement. Likewise, the old harness's `kept`
heuristic compares estimated document growth with clip offsets; it is not a
visual reading-position assertion.

**No performance code from these experiments is retained.** Keep the current
native list and idle insertion deferral. Deferral avoids publishing during
active native motion, but the insertion stall remains. This pass does not prove
that a larger container rewrite would improve performance. The preceding
streaming and position-restoration fixes and their native verification remain
in the working tree.

### Evidence and runnable stall check

Raw JSON, signed binary snapshots, source probes, build logs, and traces are in
`/tmp/sokosumi-apple-frame-perf-20261010`. The corrected CPU window is
`foreground-page-layout-stacks-corrected.json`; the phase-scoped actual frame
results are `foreground-paging-swiftui-v2-scoped-hitches.json` and
`normal-baseline-swiftui-scoped-hitches.json`. The first background capture's
empty hitch lane is discarded for presentation measurements. Even the valid
foreground captures have empty SwiftUI view/cause lanes; those are missing
attribution, not zero updates.

The retained local check fails when a deferred publication blocks the main
callback for more than two 60 Hz intervals. It currently fails at **92 ms**:

```sh
python3 /tmp/sokosumi-apple-frame-perf-20261010/check_stalls.py \
  /tmp/sokosumi-apple-frame-perf-20261010/row-sizing-current-paging-1.json
```

For a new baseline capture using the saved original binary (about 30 seconds
plus trace finalization), launch the unique executable so Instruments cannot
resolve the installed Sokosumi app instead:

```sh
xcrun xctrace record --template SwiftUI --device Homer --time-limit 30s \
  --output /tmp/sokosumi-repeat-paging.trace \
  --env HITCH_MODE=paging --env HITCH_FLICKS=8 \
  --target-stdout /tmp/sokosumi-repeat-paging.json --launch -- \
  /tmp/sokosumi-apple-frame-perf-20261010/ForegroundBaseline.app/Contents/MacOS/SokosumiScrollProfile
```

Use `--env HITCH_MODE=normal --env HITCH_FLICKS=6` for the normal-scroll capture.
A trace output path must be new. Saved profiling binaries are developer fixtures,
not distribution builds. Their complete source copy is
`/private/tmp/sokosumi-scroll-audit-final-v4-20261010/apple`; discarded controls
are identified by `HITCH_SKIP_SCROLL_BAR` and `HITCH_FIXED_ROWS` in that copy.

## Native SwiftUI List experiment

A disposable room-only prototype replaced `ScrollView` / `LazyVStack` with a
plain `List`, keeping the unary message rows, message IDs, coordinator, prepared
Markdown, and existing scrolling logic. Zero row insets and hidden separators
kept the message presentation close to the existing view. No List implementation
is included in this PR. Builds and test hosts used team `GVWN7HXYJB`, signed with
`Developer ID Application: utxo AG (GVWN7HXYJB)`, and in-memory auth.

The unchanged room checks distinguish the swap from the LazyVStack control:

| Check | List prototype | LazyVStack control |
| --- | --- | --- |
| Initial bottom placement and scrolling up through rich room history | Only 80 pt away from bottom after the gesture; fails the 400 pt minimum | Pass |
| Automatic older-page loading and visible position retention | No older request; cannot reach insertion/pixel-retention assertions | Pass |
| Streamed content while an older page waits | Blocked by the missing older request | Pass |
| Newest message grows while pinned, including tall growth | Pass | Pass |
| Message growth while reading history or actively scrolling | Reading offset jumps 220 pt | Pass |
| Prepared message-link landing in the room | Target not visible in OCR check | Pass |

One unchanged thread/media assertion failed in both runs because no media request
had completed by the assertion. The focused LazyVStack scrolling/jump retry passed
all four parameter cases. That shared failure is not attributed to List.

Automatic List paging did not work in this fixture, so its normal-scroll callback
timings are not accepted as a performance win. A separate insertion control used
100 loaded rich messages and injected 30 older rows after one native flick had
ended. This tests prepend cost independently of automatic loading. Three
alternating pairs measured first-arrival display-callback gaps of **38/42/43 ms
for List**, versus **67/59/51 ms for LazyVStack**. These are callback gaps, not
presentation delays or FPS. They are not comparable to the earlier 100-row Core
page measurements.

One foreground Instruments capture per variant recorded two controlled prefixes.
Within the first publication window (50 ms before through 700 ms after), List
recorded **no presentation hitch**, while LazyVStack recorded **50 ms** of
presentation delay. The second windows recorded none and 16.67 ms respectively.
Startup and teardown are excluded; measurement windows come from console log
timestamps relative to the trace start date. Both traces lack SwiftUI view/cause
data, so they provide presentation evidence without SwiftUI attribution.

**Decision: do not adopt the minimal swap.** List shows promising prepend cost,
but paging, history growth, and target restoration have not passed. This does not
establish that List lacks geometry or phase support: Apple documents
[List geometry callbacks](https://developer.apple.com/documentation/macos-release-notes/macos-15_2-release-notes)
and [List scroll phases](https://developer.apple.com/documentation/swiftui/scrollphase/animating).
The existing ScrollView position/coordinate logic needs a verified native
List integration before the timing advantage can justify a replacement.

Raw paired JSON, prototype source, team-signed binaries, native `.xcresult`
bundles, scoped hitch reports, and both traces are saved in
`/tmp/sokosumi-apple-list-perf-20261010`. The prototype is
`RoomTimelineView.list.swift`; native comparisons are `list-native-tests.xcresult`
and `lazy-native-control.xcresult`, with the focused retry in
`lazy-scrolling-retry.xcresult`.
