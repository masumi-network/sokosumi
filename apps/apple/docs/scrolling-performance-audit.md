# Chat scrolling performance audit

Status: diagnosis in progress after #4571. No claim of resolved scrolling.

## Acceptance

Room and reply-thread scrolling must stay responsive while image attachments, avatars and link previews load. Preserve message layout, complete-line expansion, rounded edges, hover actions, historic jumps, pagination and follow-latest behavior. Keep shared code iOS 17 compatible. No web edits, new dependencies or API contract changes.

## Evidence

- User confirms link previews work but scrolling is still poor after #4571's parsing optimization. Latest recording: `Bildschirmaufnahme 2026-09-14 um 16.57.53.mov`, 14.175 seconds. An inspected frame shows the Everyone room with a loaded YouTube preview; a frame alone cannot establish hitch timing.
- Earlier manual sample `/tmp/sokosumi-scroll-active.sample`: main-thread SwiftUI/AppKit layout, background Markdown resolution and thumbnail decoding. The sample predates the final fixes and cannot serve as the current-build baseline.
- The parsing regression improved from 19.208 seconds to 0.027 seconds for 100 messages with 80 channels. It measures parsing throughput, not scrolling latency.
- `TranscriptScrollingTests` checks bottom anchoring and movement through 100 rich-text messages. It has no image URLs, remote completion transitions or frame budget. Passing it does not prove fluid scrolling.

## Ranked hypotheses and falsifiable checks

1. **Layout feedback during media arrivals.** `MessageUnfurlView` replaces a 60-point spinner with an image up to 200 points high; `MessageAttachmentView` replaces a 160×100 spinner with an image up to 640×360. `RoomTimelineView` reacts to exact scroll/content geometry and may issue scroll-to-bottom commands after content-size changes. Compare identical scroll runs with media completions delayed versus completed; measure layout duration and scroll-command counts. Preserve image aspect ratios; do not hide the problem with arbitrary fixed card sizes.
2. **Broad observation fan-out.** `WorkspaceState` forwards changes from sidebar, attention, timeline, outbox, pins, thread and streaming through one `objectWillChange`. Transcript and Markdown views observe that coordinator. Count visible/offscreen body updates under isolated read-attention and streaming events. If unrelated changes rebuild rich rows, narrow the dependency at the existing model/view seam.
3. **Repeated rendering tasks and image work.** Markdown is detached but stored per view; thumbnail decoding runs on a serial utility queue without a decoded cache. Image attachments and unfurls use `AsyncImage`. Count task starts, cancellations, decoded pixels and repeat requests while scrolling away and back. Do not attribute background decoding to the main thread without trace evidence.
4. **Rich-text measurement cost.** `ExpandableMessageBody` measures full content and a hidden 16-line text, resolves line-layout preferences and updates geometry state. Profile short text, clamped rich text and media-heavy rows separately, retaining complete-line truncation behavior.

## Existing seams to reuse

- Extend `TranscriptScrollingTests` for a controlled media-loading scenario and timing capture. Its existing app-hosted room/thread setup is preferable to a parallel transcript implementation.
- Reuse `ImageThumbnail.swift` if display-sized decoding is justified; it already isolates ImageIO work off the UI executor. Preserve full-resolution image viewing independently from inline thumbnails.
- Reuse existing `RoomTimeline`, `ThreadSession`, `TimelineScrollIntent` and coordinator lifecycles. A wholesale architecture rewrite is not the starting assumption.
- Keep `ExpandableMessageBody` line-boundary regression coverage when changing measurement.

## Verification plan

1. Establish a current-build baseline with identical content/window size; compare Debug and Release. Capture SwiftUI update/layout and Time Profiler data during cold media loading and a warm second pass.
2. Add a repeatable media-heavy app-hosted scenario. Report event-loop delay/hitches separately from synchronous layout cost; synthetic wheel-event timings alone omit async work.
3. Change one measured cause at a time. Repeat the same capture and retain before/after evidence.
4. Run app tests, affected package tests, iOS 17 compilation, lint/format and visual checks. User confirmation on the affected room is required before describing scrolling as fixed.

## Text-only baseline (Debug, 2026-09-14)

Extended the existing app-hosted fixture with monotonic timing and serialized room/thread runs. Command: `xcodebuild -project Sokosumi.xcodeproj -scheme Sokosumi -configuration Debug -destination 'platform=macOS,arch=arm64' -derivedDataPath /tmp/sokosumi-attachments-build -skipPackagePluginValidation DEVELOPMENT_TEAM='' CODE_SIGN_IDENTITY=- test -only-testing:SokosumiTests/TranscriptScrollingTests -parallel-testing-enabled NO -enableCodeCoverage NO` from `apps/apple`.

| Fixture | Layout p95 | Layout max | Total step p95 | Total step max |
| --- | --- | --- | --- | --- |
| Room | 0.198 ms | 2.377 ms | 17.568 ms | 19.163 ms |
| Reply thread | 12.543 ms | 17.093 ms | 28.574 ms | 37.556 ms |

One run, 30 wheel events per fixture. Total step includes a requested 16 ms sleep; it is not a presented-frame interval. Metrics are emitted into app-container temporary files named `scroll-baseline-<thread>-<pid>.txt`. The fixture has no network media. These results establish a comparison point, not an acceptance threshold or a causal conclusion. App-hosted scroll tests and pinned lint/format pass. Raw output: `/tmp/scroll-audit-baseline-final.log`.

## Extended fixture: delayed images and longer sweep

`TranscriptScrollingTests` now exercises text-only and mixed image-attachment/unfurl histories in both room and thread views. `ScrollMediaProtocol` intercepts only `scroll-fixture.invalid`, returns a generated 2400×1600 PNG after 50 ms, and counts completed requests. Unique URLs prevent an earlier case's image cache from bypassing the load. Each media case asserts a response completed. No production requests or messages are involved.

120 wheel events × 60 pixels replace the short 30-event sweep. A serial Debug run passed all cases (`/tmp/scroll-media-current-tests.log`), with these diagnostic measurements:

| Fixture | Layout p95 | Layout max | Total step p95 | Total step max |
| --- | --- | --- | --- | --- |
| Room, rich text | 29.276 ms | 50.644 ms | 47.300 ms | 71.291 ms |
| Room, mixed media | 10.154 ms | 19.323 ms | 38.110 ms | 44.089 ms |
| Thread, rich text | 18.403 ms | 23.806 ms | 36.004 ms | 40.312 ms |
| Thread, mixed media | 10.895 ms | 16.308 ms | 37.419 ms | 48.028 ms |

Media cases intentionally contain shorter text (two paragraphs rather than eight), so the table does not isolate image overhead. The longer sweep reveals more layout cost than the short baseline. All four cases log `<OnScrollGeometryChange Modifier> tried to update multiple times per frame` during setup. This is reproducible evidence worth profiling, but not proof that the warning causes the user's stalls. Next: profile this app-hosted scenario, separate setup from active scrolling, and compare the same geometry callback with semantically coalesced state. The next experiment below targets the geometry-update path.

## First measured change: semantic scroll boundaries

The repeatable fixture CPU sample (`/tmp/scroll-fixture-before.sample`) is dominated by SwiftUI layout and graph updates; application-level Markdown rendering is a small part of sampled main-thread stacks. Snapshot footprint was 336 MB (peak 366 MB), including the test host; do not treat this as a product memory baseline because a subsequent audit corrected a retain cycle in the fixture loader. This does not establish an image-decoding bottleneck on the main thread.

Replaced per-pixel geometry values with `TranscriptScrollEdges`, shared by room and thread views. Its equality changes only at near-top, near-bottom and bottom-alignment boundaries. Room follow-latest also skips redundant scroll commands when already aligned. `TimelineScrollIntent` consumes the semantic near-bottom flag; its obsolete distance-based entry point was replaced, not retained.

The same 120-event Debug fixture passed and no longer emitted the multiple-updates-per-frame warning (`/tmp/scroll-edges-tests.log`). One measured comparison:

| Fixture | Layout p95 before → after | Total step p95 before → after |
| --- | --- | --- |
| Room, rich text | 29.276 → 14.739 ms | 47.300 → 34.468 ms |
| Room, mixed media | 10.154 → 9.339 ms | 38.110 → 35.821 ms |
| Thread, rich text | 18.403 → 15.735 ms | 36.004 → 32.904 ms |
| Thread, mixed media | 10.895 → 2.495 ms | 37.419 → 36.222 ms |

These are single-run diagnostic results, not a guaranteed frame-rate improvement. Full app tests (including threshold/equality coverage), 354 Chat tests, iOS 17 Workspace compilation and pinned lint/format pass. Release comparison and live user verification remain pending. No broad observation rewrite, new caching subsystem or image-loader replacement has been justified yet.

## Optimized-build comparison

Release fixture tests pass (`/tmp/scroll-release-benchmark.log`) using command-only overrides `ENABLE_TESTABILITY=YES ONLY_ACTIVE_ARCH=YES ENABLE_HARDENED_RUNTIME=NO` for the local ad-hoc test host. Production build settings are unchanged. The first attempt lacked testability; the second compiled but the ad-hoc host failed hardened-runtime library validation. Neither was a product performance result.

With the retained boundary fix, Release room rich-text layout p95 was 24.298 ms and total step p95 41.468 ms; mixed-media room layout p95 was 8.235 ms and total step p95 37.948 ms. Reply rich-text layout p95 was 14.297 ms and total step p95 31.472 ms. This does not support dismissing the problem as Debug-only overhead.

A separate experiment moved the remaining room message/gap reads outside the lazy builder. The fixture compiled and passed (`/tmp/scroll-hoisted-final.log`), but room rich-text layout p95 was 23.309 ms and total step p95 41.365 ms—no meaningful improvement over the repeated baseline. That experiment was discarded. Do not infer that arbitrary local bindings necessarily break laziness from the earlier review note.

The retained code change remains boundary coalescing. Live verification of the user's affected chat is still outstanding, and additional architectural changes require evidence from that scenario. The controlled fixture does not yet reproduce the reported severity reliably.

## Live capture after boundary coalescing

On September 14 at 17:54 CEST, captured the Xcode-launched app (PID 97060) with `sample 97060 15 1 -file /tmp/sokosumi-scroll-live-97060.sample`. A second, older app was running from `/private/tmp/Sokosumi-4571-DerivedData`; it was not sampled. The user confirmed clear visible stutter during the capture in the Xcode-launched app. This establishes that boundary coalescing has not resolved the reported problem.

Of 10,282 main-thread samples, 4,709 ended in the Mach message wait. A traversal counting only the outermost matching stack within each category found 3,561 samples in view layout/render paths and 1,441 in AttributeGraph update paths. These categories overlap and must not be added together. Image-decoding matches on the main thread numbered only two; this capture does not justify blaming main-thread image decoding. Sampling does not provide individual presented-frame times or identify which state mutation started a layout pass.

Next diagnostic target: correlate transcript state changes and rich-body measurement with expensive layout passes. Preserve the complete-line clipping behavior while testing one cause at a time. Separately, CI run `34863501053` reported two failing scrolling-fixture cases without assertion details in the console or an uploaded result bundle; reproduce the full app suite before treating those checks as reliable evidence.

## Scroll-position binding isolation

The full local app suite passed (`/tmp/scroll-live-full-tests.log`), so the CI failure remains unexplained. CI now prints the native Xcode result summary on failure.

A sequential A/B/A experiment used the same serial Debug scrolling fixture. B temporarily removed only the room's `.scrollPosition(id: $scrollTarget, anchor: .center)` modifier. All runs passed the scrolling fixture; this fixture does not verify deep links. Room rich-text layout p95 was 23.986 ms with the binding, 14.781 ms without, and 23.611 ms after restoration. Total step p95 was 42.886, 32.658 and 40.931 ms respectively. Reply rich-text layout, unchanged by the experiment, remained 14.507, 14.063 and 14.895 ms. Logs: `/tmp/scroll-binding-baseline.log`, `/tmp/scroll-binding-experiment.log`, `/tmp/scroll-binding-restored.log`.

The binding contributes measurable room overhead in this fixture. Removing it is not a valid fix because historical jumps and resizing use it. The experiment is fully reverted. Next: distinguish ID tracking/parent invalidation from scroll-target layout cost, and evaluate the existing macOS scroll-position API while preserving deep-link, resize, paging and return-to-latest tests. The remaining roughly 15 ms rich-text layout cost also needs investigation; this result does not establish that the binding explains all live stutter.

The subsequent local candidate uses native `ScrollPosition(idType: String.self)` in the macOS-only room view. The same fixture passed with room rich-text layout p95 12.764 ms and total step p95 31.609 ms (`/tmp/scroll-position-experiment.log`). The full app suite and pinned lint/format passed. Rendered historical jumps and resize alignment still need verification before this candidate is ready.

Content-growth coverage now tests a visible message expanding by more than 100 points, both while following the bottom and after scrolling into history. Bottom alignment and the reader's existing offset remain within one point (`/tmp/scroll-growth-visible-tests.log`). An initial offscreen-row version appeared to pass but did not actually increase layout height; adding the height-growth assertion exposed that weak fixture, which was corrected to modify a visible row. These tests do not yet cover an image growing above the viewport or growth during an active gesture. Those scenarios remain required by the user's September 14 clarification.

CI's result summary identified an absolute-offset failure: final offset 18,186 versus initial offset minus 400 of 7,957. Local probes confirmed substantial lazy document-height revisions during scrolling. The room test now retains its initial bottom-alignment assertion and uses SwiftUI target visibility to require older message identities after scrolling. It cannot pass with no visible targets. The callback does not reliably emit an initial untouched position, so it is used only for the post-scroll check. Reply threads do not declare a target layout; their existing offset assertion remains for now. The revised room/thread fixture passes locally (`/tmp/scroll-visible-final.log`); CI remains unverified. Temporary accessibility and file-output probes were removed.

The growth test now also keeps the synthetic scroll gesture active while a visible row grows; all three cases pass (`/tmp/scroll-growth-active.log`). A separate attempt to grow the row immediately above visible targets produced no document-height increase because lazy layout deferred the offscreen row. That probe was discarded rather than counted as viewport-preservation evidence. Real image completion above the viewport and rendered deep-link/resize behavior remain open checks.

## Candidate live navigation verification

Signed candidate build succeeded (`/tmp/scroll-position-signed.log`) and was relaunched from the Xcode DerivedData app path as PID 14619. Native UI verification opened Everyone's Pins pane, selected an approximately three-week-old pinned message, and confirmed the loaded historical target was visible and highlighted after the pane closed. Showing the sidebar changed transcript width; the highlighted message remained visible with reflowed text. Scrolling upward cleared the highlight and revealed an image and link preview. Jump to latest returned to the newest messages with scrollbar value 1. The original hidden-sidebar layout was restored. No messages or reactions were changed.

These observations verify the candidate's historical navigation and width-change behavior, not presented-frame performance. Updated-build user feedback on image/preview scrolling is pending. The full local app suite passed at the candidate (`/tmp/scroll-position-current-full.log`), and the candidate plus tests was pushed as `c0fea4e11`; CI remains pending.

## Follow-latest regression in the subsequent CI fix

Remote commit `b5696ec9c` added `.tracking` to user scroll phases and replaced the test's absolute-offset assertion with distance from the bottom. It also inferred reader motion from geometry alone. After integrating that commit, the existing content-growth test failed: growing the bottom row left a 160-point gap (`/tmp/scroll-external-fix-tests.log`). Geometry changes cannot by themselves distinguish media/content growth from a wheel gesture.

Removed the geometry-only inference and its implementation-mirroring unit test, retaining `.tracking` handling and the distance-based fixture correction. The existing growth regression and both scrolling fixtures pass again (`/tmp/scroll-growth-regression-fixed.log`). No tolerance was relaxed. Full app verification and CI are required after this correction.


## Unrelated workspace notification probe

The user reports the ScrollPosition candidate is still not perfectly fluid (recording at 18:46 on September 14). All CI checks pass on `ef792dad0` (Apple run `34869814742`); passing those checks does not satisfy the performance acceptance criterion.

An app-hosted diagnostic rendered one `MessageMarkdownView`, allowed its initial layout, then sent ten sidebar `objectWillChange` notifications, 30 ms apart. A temporary main-actor counter in the Markdown body recorded ten evaluations. The zero-update expectation failed (`/tmp/scroll-update-probe.log`). The first method-filtered invocation selected zero tests and is not evidence; the subsequent full `TranscriptScrollingTests` invocation executed the probe.

Separated the existing Markdown rendering and parsing state into a private `MessageMarkdownContent` view within the same file. Workspace/auth observation, channel navigation, participant popovers and open-URL handling remain in the existing outer view. Rendering receives the same source, room and channels as values. The same probe recorded one content-body evaluation (`/tmp/scroll-isolated-markdown-probe.log`). An additional layout pass and 500 ms settling delay still recorded one (`/tmp/scroll-isolated-markdown-settled.log`), so the zero-update expectation remains unproven. This demonstrates reduced body evaluation for the isolated notification scenario, not a frame-rate result or complete isolation.

Removed the temporary counter and probe rather than shipping a false zero-update assertion or a permissive count threshold. Existing rendering and app tests validate behavior; live scrolling and ancestor-driven row invalidation remain open. This change neither replaces the coordinator nor introduces a second rendering path.

Full app tests pass with instrumentation removed (`/tmp/scroll-markdown-isolation-full.log`); strict pinned SwiftLint passes (`/tmp/scroll-markdown-isolation-lint.log`).


## Rich text layout isolation (September 14, after renderer separation)

User feedback on the signed `d0e112bb8` build: better, but not perfect. Signed build passed (`/tmp/scroll-isolated-signed.log`); running app PID was 30900. Apple CI run `34871651308` completed successfully. A 31-second attached SwiftUI Instruments capture was saved at `/tmp/sokosumi-render-isolation-live.trace`, but UI scroll actions failed with `noWindowsAvailable` or left scrollbar value 1. It is not scrolling evidence. The trace contains a 413 ms microhang during automation, which cannot be attributed to the reported scrolling problem.

Sequential Debug fixture experiments below use the same 120-event serial room/thread tests. Figures are synchronous host-layout p95 in milliseconds, not presented-frame times. All runs passed the existing scrolling assertions. Text-only rows contain eight Markdown paragraphs; media rows contain two paragraphs, so comparisons across those categories are not causal.

| Candidate | Room text | Thread text | Room media | Thread media |
| --- | ---: | ---: | ---: | ---: |
| Formatted baseline (`34018`) | 16.320 | 19.395 | 7.580 | 5.578 |
| One plain Text for text-only documents (`35045`) | 0.171 | 1.079 | 4.099 | 1.669 |
| Restored formatted renderer (`36084`) | 14.686 | 19.258 | 9.092 | 6.911 |
| Plain strings, original block hierarchy (`36471`) | 11.703 | 17.543 | 3.466 | 7.164 |
| Original formatting, no line-layout preference reader (`37811`) | 16.842 | 18.343 | 5.001 | 5.477 |
| Original formatting, text selection disabled (`40907`) | 11.970 | 2.810 | 6.324 | 1.054 |
| Direct Text for single-segment paragraphs (`41521`) | 16.694 | 17.110 | 8.245 | 9.972 |

Logs are `/tmp/scroll-rich-comparison-baseline.log`, `/tmp/scroll-plain-comparison.log`, `/tmp/scroll-rich-comparison-restored.log`, `/tmp/scroll-plain-blocks-comparison.log`, `/tmp/scroll-no-line-preference-comparison.log`, `/tmp/scroll-selection-disabled-comparison.log`, and `/tmp/scroll-direct-paragraph-comparison.log`. Matching `*-metrics.txt` files retain the exact timings and test-process filenames.

The one-Text experiment retained Markdown parsing and `ExpandableMessageBody`, but joined text-only block strings with double newlines. It removed inline attributes and changed paragraph spacing/row heights, so it isolates a broad display-path difference, not a drop-in replacement. Restoring the original renderer restored the higher cost. Removing inline attributes alone while retaining block hierarchy remained slow. Removing the line-preference reader or a single stack/ForEach wrapper did not improve room cost. Disabling selection improved thread measurements much more than room measurements; that result requires a repeated control before attributing the difference to selection alone.

Every experiment is reverted. Preserve selection, all formatting, paragraph spacing and complete-line truncation. Next: compare one attributed text layout against the existing multi-block hierarchy using equivalent content and account for row-height differences; correlate costs with actual lazy-row layout. Do not ship the plain-text substitution, disabled selection or removed cutoff measurement as a performance fix.


## Initial render transition isolation

A single attributed Text for paragraph-only documents retained bold/link attributes and measured room text layout p95 0.118 ms, thread text 6.591 ms (`/tmp/scroll-single-attributed-comparison.log`, process 42192). Paragraph spacing still differed, so it remains a diagnostic only.

A stronger experiment retained the entire original multi-block renderer, inline styling, text selection and complete-line cutoff. It temporarily computed the document immediately rather than starting with raw Text and replacing it from `.task`. Room text layout p95 was 0.082 ms and thread text 0.157 ms (`/tmp/scroll-no-render-transition-comparison.log`, process 42724). Room/thread media layout p95 was 0.089/0.378 ms. Restoring the asynchronous initial replacement brought text layout back to 17.155/23.351 ms (`/tmp/scroll-transition-restored-comparison.log`, process 44076). All fixture assertions passed. This is stronger evidence for repeated initial presentation changes than the earlier broad attribution to block count alone.

The immediate-render experiment is reverted: it moved parsing onto the UI executor and is not the intended production fix. It also changes when work happens relative to the fixture's initial settling interval; the synchronous layout metric alone cannot prove total startup/frame cost. The next implementation should prepare presentation data off the UI executor before exposing rows, preserving the existing formatting and avoiding one raw-text-to-block transition per newly visible row. Validate first-render latency, scrolling, streaming updates, cancellation, stale room switches and mention/channel refresh before claiming the problem resolved.

### Native loading placeholder

Replaced the initial raw-source Text with a small native ProgressView, outside ExpandableMessageBody. The existing formatted document remains visible while an edit or stream update prepares. Cancellation still prevents an obsolete task from publishing. No parser, dependency, or Core contract changes.

The seven parameterized room/thread scrolling and content-growth cases pass (`/tmp/scroll-loading-placeholder.log`). Pinned formatting and strict lint pass for the changed renderer. This is a presentation improvement, not a scrolling performance fix: PID 47557 measured layout p95 of 24.130 ms (room text), 14.561 ms (thread text), 13.287 ms (room media), and 10.985 ms (thread media). The initial placeholder-to-block transition still requires layout. Preparing documents before publishing transcript rows remains the next performance step. Live appearance is not yet verified.

Full app suite also passes (`/tmp/scroll-placeholder-full.log`). Review of the patch confirms the existing task cancellation guard and retained document state are unchanged.
