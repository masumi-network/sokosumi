#if os(macOS)
  import AppKit
  import CoreAPI
  @testable import Sokosumi
  import SokosumiAuth
  import SokosumiWorkspace
  import SwiftUI
  import Testing

  extension NativeWindowTests {
    /// The room composer is mounted once per room: its editor, and with it the caret, attached skills and focus,
    /// survives the transcript's switch from the loading view or the empty state to the message list.
    @MainActor struct RoomComposerIdentityTests {
      private static func editableTextViews(_ view: NSView) -> [NSTextView] {
        ((view as? NSTextView).flatMap { $0.isEditable ? [$0] : nil } ?? []) + view.subviews.flatMap(editableTextViews)
      }

      private static func host(_ state: WorkspaceState) -> (NSHostingView<some View>, NSWindow) {
        let host = NSHostingView(rootView: RoomTimelineView(roomId: "fixture")
          .background(.background).environment(\.locale, Locale(identifier: "en"))
          .environmentObject(state).environmentObject(AuthState()))
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 700, height: 420), styleMask: [.titled], backing: .buffered, defer: false)
        window.ignoresMouseEvents = true
        window.contentView = host
        window.orderFront(nil)
        return (host, window)
      }

      /// The editor in the window once `ready` holds and layout has settled, checked to be `editor` throughout.
      private static func expectSameEditor(_ editor: NSTextView, in host: NSView, sourceLocation: SourceLocation = #_sourceLocation) async throws {
        try await Task.sleep(for: .milliseconds(500))
        host.layoutSubtreeIfNeeded()
        let editors = editableTextViews(host)
        #expect(editors.count == 1, "One composer editor", sourceLocation: sourceLocation)
        #expect(editors.first === editor, "The composer's editor was replaced", sourceLocation: sourceLocation)
        #expect(editor.window != nil, "The composer's editor left the window", sourceLocation: sourceLocation)
      }

      @Test func theEditorSurvivesTheLoadingViewGivingWayToMessages() async throws {
        let state = try TranscriptScrollingTests.fixtureState(thread: false, media: false)
        let (host, window) = Self.host(state)
        defer { window.orderOut(nil) }
        // The transcript prepares asynchronously, so the composer first mounts beside the loading view.
        let editor = try await waitForView(in: host, timeoutMessage: "The composer never mounted") { Self.editableTextViews(host).first }
        #expect(Self.editableTextViews(host).count == 1)
        _ = try await loadedTranscriptScrollView(in: host)
        try await Self.expectSameEditor(editor, in: host)
      }

      @Test func theEditorSurvivesTheFirstMessageReplacingTheEmptyState() async throws {
        let state = try TranscriptScrollingTests.fixtureState(thread: false, media: false)
        let first = try #require(state.openRoom.room.timeline.messages.first)
        state.openRoom.room.timeline.messages = []
        state.openRoom.room.timeline.errorMessage = nil
        let (host, window) = Self.host(state)
        defer { window.orderOut(nil) }
        let editor = try await waitForView(in: host, timeoutMessage: "The composer never mounted") { Self.editableTextViews(host).first }
        try await Task.sleep(for: .milliseconds(300))
        state.openRoom.room.timeline.messages = [first]
        _ = try await waitForView(in: host, timeoutMessage: "The message list never appeared") {
          Self.scrollViews(host).first { $0 !== editor.enclosingScrollView && ($0.documentView?.frame.height ?? 0) > 0 }
        }
        try await Self.expectSameEditor(editor, in: host)
      }

      private static func scrollViews(_ view: NSView) -> [NSScrollView] {
        (view as? NSScrollView).map { [$0] } ?? view.subviews.flatMap(scrollViews)
      }
    }
  }
#endif
