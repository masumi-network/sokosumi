# Chat scrolling performance

Room and reply-thread scrolling must stay responsive while image attachments, avatars, and link previews load. Preserve message layout, complete-line expansion, rounded edges, hover actions, historic jumps, pagination, and follow-latest. Shared code stays iOS 17 compatible. No web edits, new dependencies, or API contract changes.

#4571 improved parsing throughput. That is not a scrolling fix. Users still reported poor scrolling after the link-preview work.

**Reopened 2026-09-19** (user report: web scrolls well, the Mac app does not). The earlier line — "further performance tuning is deferred … do not build a custom list engine" — closed this while #4571's parsing work was the only thing on the table. It no longer holds, and the next agent should not read it as a reason to skip the problem. Tracked as **M6** in [PARITY.md](../PARITY.md) under macOS-native additions; it is not a parity row, because web's virtualizer is explicitly not a native requirement.

Nothing here is measured. No one has profiled this app. Two candidate causes, in order of suspicion:

1. **The rendered set is unbounded.** `ScrollView` + `LazyVStack` (`Sokosumi/Chat/Timeline/RoomTimelineView.swift:163`) creates rows lazily but does not discard them once created, so paging back through a long room grows the live view count without limit. Web keeps its rendered set constant with TanStack Virtual. The concept worth porting is windowing; the SwiftUI construct that already recycles is `List`. Porting TanStack itself is not the move.
2. **Whole-transcript preparation on every input change.** `PreparedTranscript.prepare` (`Packages/SokosumiChat/Sources/SokosumiChat/PreparedTranscript.swift:33`) walks every message, reusing by id and content. Steady state is cheap, but `Input.messages` carries the pending-reaction overlay, so a single reaction tap re-walks the array.

A third possibility is independent of both: [scroll-geometry-warning.md](scroll-geometry-warning.md) reproduces `OnScrollGeometryChange … tried to update multiple times per frame` in a 40-line standalone app with no chat models, rendering or networking.

**Profile first.** Instruments plus SwiftUI view-body counts on a long transcript, before any code changes — the cause may be none of the above.

**What a change must not break.** Moving off `ScrollView` means rewriting `ScrollPosition`, `.defaultScrollAnchor(.bottom, for: .sizeChanges)` and the geometry-edge callbacks that drive pagination and follow-latest. That machinery carries the most user-accepted behavior in the app. Regression gates: reading position when an older page is inserted, historic jumps, gap rows, follow-latest, and the reader's position while images grow.

Still in force: publish UI state on the main actor; parse transcripts in a detached task with Sendable snapshots, cancellation and stale-result checks; bound reuse to the previous snapshot.

## Reuse

- Extend `TranscriptScrollingTests` for media-loading scenarios.
- Reuse `ImageThumbnail.swift` if display-sized decoding is needed.
- Reuse `RoomTimeline`, `ThreadSession`, `TimelineScrollIntent`, and coordinator lifecycles.
- Keep `ExpandableMessageBody` line-boundary coverage when measurement changes.
