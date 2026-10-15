#if os(macOS)
  import AppKit
  import CoreAPI
  @testable import Sokosumi
  import SokosumiAuth
  import SokosumiWorkspace
  import SwiftUI
  import Testing

  extension NativeWindowTests {
    /// The room composer takes focus when its room was clicked in the sidebar, and only then.
    @MainActor struct RoomComposerFocusTests {
      private static let room = Components.Schemas.ChatRoom(
        id: "fixture", name: "launch", kind: .channel, isSelfDirect: false, isGroupDirect: false, isReadOnly: false,
        createdByUserId: "", createdAt: .distantPast, updatedAt: .distantPast, unreadCount: 0, unreadMentionCount: 0,
        markedUnread: false, myAccess: .init(value1: .member, value2: "member"), userMembers: [], formerUserMembers: [],
        coworkerMembers: [], sokoBotMembers: []
      )

      private static func editableTextViews(_ view: NSView) -> [NSTextView] {
        ((view as? NSTextView).flatMap { $0.isEditable ? [$0] : nil } ?? []) + view.subviews.flatMap(editableTextViews)
      }

      private static func focusedEditor(in host: NSView, window: NSWindow) -> NSTextView? {
        editableTextViews(host).first { window.firstResponder === $0 }
      }

      private static func host(_ request: ComposerFocusRequest, empty: Bool = false) async throws -> (NSHostingView<some View>, NSWindow) {
        let state = try TranscriptScrollingTests.fixtureState(thread: false, media: false)
        state.rooms = [room]
        if empty {
          state.openRoom.room.timeline.messages = []
          state.openRoom.room.timeline.errorMessage = nil
        }
        let host = NSHostingView(rootView: RoomTimelineView(roomId: "fixture")
          .background(.background).environment(\.locale, Locale(identifier: "en"))
          .environment(\.composerFocusRequest, request).environmentObject(state).environmentObject(AuthState()))
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 700, height: 420), styleMask: [.titled], backing: .buffered, defer: false)
        window.ignoresMouseEvents = true
        window.contentView = host
        window.orderFront(nil)
        if !empty {
          _ = try await loadedTranscriptScrollView(in: host)
        }
        _ = try await waitForView(in: host, timeoutMessage: "The composer never mounted") { editableTextViews(host).first }
        return (host, window)
      }

      @Test func aClickedRoomOpensReadyToType() async throws {
        let request = ComposerFocusRequest()
        try request.roomPicked("fixture", by: ComposerFocusRequestTests.mouse(.leftMouseUp))
        let (host, window) = try await Self.host(request)
        defer { window.orderOut(nil) }
        _ = try await waitForView(in: host, timeoutMessage: "The composer never took focus") {
          Self.focusedEditor(in: host, window: window)
        }
        #expect(!request.take("fixture"), "The composer consumed the request")
        try await Task.sleep(for: .milliseconds(500))
        host.layoutSubtreeIfNeeded()
        #expect(Self.focusedEditor(in: host, window: window) != nil, "The composer keeps focus once the room has settled")
      }

      /// An empty room shows its empty state at once, so the composer is asked as it appears.
      @Test func aClickedEmptyRoomOpensReadyToType() async throws {
        let request = ComposerFocusRequest()
        try request.roomPicked("fixture", by: ComposerFocusRequestTests.mouse(.leftMouseUp))
        let (host, window) = try await Self.host(request, empty: true)
        defer { window.orderOut(nil) }
        _ = try await waitForView(in: host, timeoutMessage: "The composer never took focus") {
          Self.focusedEditor(in: host, window: window)
        }
        #expect(!request.take("fixture"), "The composer consumed the request")
        try await Task.sleep(for: .milliseconds(500))
        host.layoutSubtreeIfNeeded()
        #expect(Self.focusedEditor(in: host, window: window) != nil, "The composer keeps focus once the room has settled")
      }

      @Test func aRoomOpenedWithoutAClickLeavesFocusAlone() async throws {
        let (host, window) = try await Self.host(ComposerFocusRequest())
        defer { window.orderOut(nil) }
        try await Task.sleep(for: .milliseconds(500))
        host.layoutSubtreeIfNeeded()
        #expect(Self.focusedEditor(in: host, window: window) == nil)
      }
    }
  }
#endif
