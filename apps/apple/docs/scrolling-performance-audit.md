# Chat scrolling performance

Room and reply-thread scrolling must stay responsive while image attachments, avatars, and link previews load. Preserve message layout, complete-line expansion, rounded edges, hover actions, historic jumps, pagination, and follow-latest. Shared code stays iOS 17 compatible. No web edits, new dependencies, or API contract changes.

#4571 improved parsing throughput. That is not a scrolling fix. Users still reported poor scrolling after the link-preview work.

Further performance tuning is deferred. Keep the standard SwiftUI lazy transcript and background preparation. Do not build a custom list engine or extra optimization infrastructure. Further live profiling is not an acceptance gate for this slice. Publish UI state on the main actor. Parse transcripts in a detached task with Sendable snapshots, cancellation, and stale-result checks. Bound reuse to the previous snapshot.

## Reuse

- Extend `TranscriptScrollingTests` for media-loading scenarios.
- Reuse `ImageThumbnail.swift` if display-sized decoding is needed.
- Reuse `RoomTimeline`, `ThreadSession`, `TimelineScrollIntent`, and coordinator lifecycles.
- Keep `ExpandableMessageBody` line-boundary coverage when measurement changes.
