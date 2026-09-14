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
