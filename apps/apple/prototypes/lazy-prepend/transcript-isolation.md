# Production transcript isolation

Measured 2026-10-10, after the bare reproduction. The production rich row brings
back 60+ ms scheduling gaps even without room projection, a scroll reader, or
position correction. CPU samples concentrate in SwiftUI graph updates and native
layout of realized rows. This narrows the expensive path; it does **not** identify
a single faulty component or establish a SwiftUI defect. No verified production
fix resulted from these controls.

## Method

The disposable Apple workspace reuses the real `MessageRowView`, Markdown,
quote, reaction, avatar, and day-separator components. A deterministic mixed
corpus contains paragraphs, code, images, quotes with thumbnails, reactions,
and reply metadata. Core HTTP is intercepted at URLSession: 100 initial messages,
five 100-message older pages, 150 ms page latency, 600 messages at the end.
Every run completes six requests and five publications.

The foreground native window is 1100 × 800 pt. A native scroller drag precedes
each request; publication occurs after scrolling rests. The environment and
team signing match the standalone reproduction. Builds and benchmarks run
sequentially. Authentication uses an in-memory store.

The staged view prepares all 600 Markdown body documents before measurement.
It publishes the loaded suffix directly into an observed row model. Quote
snippets and media still use their production components' asynchronous work.
The production-path control instead uses the real `RoomTimelineView`, page
preparation, deferred insertion, and position correction.

The harness records both display-link timestamps and actual main-thread callback
times. The table uses **actual callback gaps** overlapping publication through
+700 ms. Display-link timestamp windows extend from −50 to +700 ms and remain
separate in [the measurements](transcript-isolation-results.json). Neither metric
is a presented-frame hitch duration or FPS. The first fresh production baseline
used the older timestamp-only probe and reached 61–76 ms.

## Adding components

The numbers below are each run's five publication-window maxima, in milliseconds.
Screens with one run establish candidates, rather than statistical attribution.

| View | Actual callback maxima |
| --- | --- |
| Plain text, same mixed corpus | 17 / 17 / 17 / 17 / 25 |
| Avatar placeholder, sender header, plain body | 33 / 17 / 20 / 19 / 17 |
| Add production body clamp | 33 / 23 / 27 / 34 / 33 |
| Add prepared production Markdown, run 1 | 19 / 33 / 24 / 33 / 24 |
| Prepared Markdown, run 2 | 37 / 32 / 32 / 32 / 35 |
| Full production message row, run 1 | 62 / 46 / 40 / 34 / 32 |
| Full production message row, run 2 | 64 / 56 / 58 / 40 / 46 |
| Add day separators | 67 / 67 / 67 / 56 / 50 |
| Add `ScrollPosition` and target layout | 67 / 33 / 50 / 50 / 50 |

The full row reproduces the 60+ ms amplitude. The direct staged view does not
reproduce the production path's consistently high gaps on every page. Day
separators and target layout do not show a clear additional cost in these
single-run screens.

A second pass restored the row's 8 pt sender-group spacing and added extras to
the prepared-Markdown row: quotes reached 50 ms, reactions 50 ms, both 50 ms,
and both with the real avatar/profile button 58 ms. This is a narrower screening
path, not a pixel-identical replacement for the full row. It does not isolate
one component that explains the entire production stall.

## Removal controls

Every control below retains the full row except for the named change. These
single-run screens did not clear the delay and were not adopted:

| Control | Actual callback maxima |
| --- | --- |
| Remove unconditional native menu overlay | 68 / 67 / 67 / 50 / 50 |
| Replace profile buttons with their labels | 56 / 54 / 50 / 55 / 48 |
| Suppress quote snippet parsing/state publication | 69 / 67 / 50 / 54 / 50 |
| Native HStack instead of wrapping reaction layout | 50 / 68 / 67 / 50 / 67 |
| Disable fixture host sizing options | 67 / 50 / 51 / 54 / 50 |
| Retain content, remove row interaction modifiers | 67 / 54 / 54 / 50 / 33 |

The fixture directly hosts the transcript in `NSHostingView`; production uses
`WindowGroup`, navigation containers, and automatic minimum-content sizing.
Disabling fixture sizing is a diagnostic control, not a production fix.

## Native ID anchoring

The staged full row with `.scrollPosition(id:anchor:)` peaked at 50 ms in all
three runs. Its neighboring baselines peaked at 58 and 71 ms. The native binding
was therefore tried in the production transcript, retaining explicit centered
and bottom jumps through `ScrollViewReader`.

| Production-path run | Actual callback maxima |
| --- | --- |
| ID binding 1 | 58 / 53 / 51 / 44 / 70 |
| Baseline 1 | 53 / 73 / 53 / 67 / 67 |
| Baseline 2 | 58 / 54 / 33 / 58 / 47 |
| ID binding 2 | 61 / 49 / 53 / 50 / 69 |

The production timing gain did not hold consistently. More decisively, the clean
native ID migration failed **both older-page reading-position tests**: the
previously visible middle message disappeared after insertion. Normal room/thread
scrolling, message-link jumps, and five streaming/content-growth cases passed.
That is nine passing parameter runs and two failures across nine test methods.

Apple's [ID-binding documentation](https://developer.apple.com/documentation/swiftui/view/scrollposition(id:anchor:)) describes attempting to preserve the bound
view's visibility, rather than an exact pixel offset. The identified production
row also contains its day separator, which can disappear after a same-day
prepend. The existing correction deliberately uses the second row when possible.
The experiment does not establish the precise cause of its position failures.

After restoring the unchanged production implementation, **all nine test methods /
eleven parameter runs passed** with team signing. The existing LazyVStack,
deferred publication, and position correction remain the production path.

## CPU evidence and limits

A separate SwiftUI-template trace of the staged full row reproduced actual gaps
of 90 / 71 / 84 / 68 / 70 ms under profiler overhead. The trace again contained
no SwiftUI cause data. Five approximate publication windows, −50 to +160 ms,
contained 374.7 ms of main-thread CPU samples. Inclusive weights included graph
updates 234.6 ms, layout sizing 146.1 ms, lazy-stack estimate measurements 93.2 ms,
scroll-view sizing 84.7 ms, and root geometry 69.1 ms. These weights overlap and
must not be added.

Window alignment uses the trace's wall-clock start and calibrated
`mach_absolute_time`; the template did not capture publication log markers.
These are approximate CPU slices, not exact native-signpost attribution.
The evidence points toward realized rich-row graph/layout work, but neither
the sizing control nor the component-removal screens established a safe fix.

The staged source, controls, signed binaries, logs, and trace remain in the
clearly marked disposable directory
`/tmp/sokosumi-transcript-pieces-20261010`. Native result bundles are
`id-anchor-acceptance.xcresult` and `restored-acceptance.xcresult` there. This
report and the compact raw measurements preserve the findings; the staged
workspace is not a new production path or a separately portable reproduction.
No Apple Feedback report was submitted.

## Portable follow-up

The [portable rich-row fixture](README.md#portable-rich-rows) now preserves the full
production message rendering in this PR. It builds from a fresh checkout and runs
without the earlier disposable workspace. Three alternating pairs with identical
incoming content measured prepend median 47.5 ms / worst 71.7 ms versus append
median 16.5 ms / worst 16.7 ms. The top viewport makes prepends visible and appends
offscreen; this includes realization cost. See [raw paired results](rich-measurements.json).
The historical controls above remain measurements of the earlier staged workspace.
