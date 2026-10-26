#if os(macOS)
  import AppKit
  import CoreAPI
  @testable import Sokosumi
  import SokosumiAuth
  import SokosumiChat
  import SokosumiWorkspace
  import SwiftUI
  import Testing

  extension NativeWindowTests {
    /// Spec SOK-1481: a room with Room unread opens with its Unread divider about a third of the way down the
    /// transcript, read messages above it.
    @MainActor struct UnreadDividerPlacementTests {
      @Test func theRoomOpensWithTheDividerAThirdOfTheWayDown() async throws {
        let (state, host) = try await openAtTheDivider((0 ..< 100).map(message), firstUnread: "message-60")
        defer { state.openRoom.room.close() }
        defer { host.window?.orderOut(nil) }
        let room = state.openRoom.room
        let scroll = try await loadedTranscriptScrollView(in: host)

        var fraction: CGFloat?
        var wasAtEnd = false
        let divider = try await waitForView(in: host, timeoutMessage: "The divider did not settle a third of the way down; it sits at \(fraction.map { "\($0)" } ?? "no visible row"); offset \(scroll.contentView.bounds.minY) pt of \(scroll.documentView?.frame.height ?? 0) pt, placement pending \(room.placesUnreadDivider)") {
          wasAtEnd = wasAtEnd || room.isAtEnd
          guard let divider = Self.separator(in: host) else { return nil }
          let visible = scroll.convert(scroll.bounds, to: nil)
          let top = visible.maxY - scroll.contentInsets.top
          let height = visible.height - scroll.contentInsets.top - scroll.contentInsets.bottom
          fraction = (top - divider.convert(divider.bounds, to: nil).midY) / height
          return fraction.map { (0.25 ... 0.42).contains($0) } == true && !room.placesUnreadDivider ? divider : nil
        }
        #expect(divider.accessibilityRole() == .splitter)
        try Attachment.record(TranscriptReadingPosition.snapshot(host), named: "unread-divider")
        #expect(scroll.contentView.bounds.minY > 0, "Read messages stay visible above the divider.")
        // Past the placement's settle check.
        try await Task.sleep(for: .milliseconds(400))
        #expect(!wasAtEnd && !room.isAtEnd, "A long unread run opens above the end and reads nothing, not even as the list mounts.")
      }

      /// An unread run short enough that the transcript opens at its end is read on open, as today.
      @Test func aShortUnreadRunOpensAtTheEnd() async throws {
        let (state, host) = try await openAtTheDivider((0 ..< 6).map(message), firstUnread: "message-3")
        defer { state.openRoom.room.close() }
        defer { host.window?.orderOut(nil) }
        let room = state.openRoom.room
        // Content that fits: the list cannot scroll, so the usual readiness check (a document taller than it) never holds.
        _ = try await waitForView(in: host, timeoutMessage: "The list never reported the end; divider placement pending \(room.placesUnreadDivider)") {
          room.isAtEnd && !room.placesUnreadDivider ? host : nil
        }
        #expect(Self.separator(in: host) != nil)
      }

      /// Opens the room at its divider (Core's answer, then the newest page it joins, which the fixture holds) and shows it
      /// in a window, which the caller orders out.
      private func openAtTheDivider(_ messages: [Components.Schemas.ChatRoomMessage],
                                    firstUnread: String) async throws -> (WorkspaceState, NSHostingView<some View>) {
        // Never invalidated: a request the closing view still starts would raise on an invalidated session.
        let session = TranscriptPageProtocol.session()
        let client = try Client.core(baseURL: #require(URL(string: "https://\(TranscriptPageProtocol.host)/v1")), session: session)
        let state = WorkspaceState(clientProvider: { _ in client })
        let page = try TranscriptPageProtocol.page(messages, cursor: nil, firstUnreadMessageId: firstUnread)
        TranscriptPageProtocol.serve([page, page])
        let room = state.openRoom.room
        room.open(roomId: "room", atUnreadDivider: true)
        room.hooks = .init(access: { (client, nil) }, failed: { _ in false }, pageLanded: { _ in })
        let loading = room.load(.initial)
        while TranscriptPageProtocol.pendingResponse.withLock({ $0 == nil }) {
          try await Task.sleep(for: .milliseconds(10))
        }
        try TranscriptPageProtocol.releaseHeldPage()
        #expect(await loading?.value == true)
        try #require(room.placesUnreadDivider)

        // No pointer reaches the rows, and none would draw its hover wash or action bar if one did.
        let host = NSHostingView(rootView: RoomTimelineView(roomId: "room").withoutRowHover()
          .environmentObject(state).environmentObject(AuthState()))
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 900, height: 700), styleMask: [.titled], backing: .buffered, defer: false)
        // The capture draws the list without the window's background: a dark Mac's white text vanishes on it.
        window.appearance = NSAppearance(named: .aqua)
        window.ignoresMouseEvents = true
        window.contentView = host
        window.orderFront(nil)
        return (state, host)
      }

      /// The divider's VoiceOver separator: AppKit's splitter named "New messages" in the reader's language (the
      /// string catalog's, so a German Mac reads "Neue Nachrichten").
      private static func separator(in view: NSView) -> NSView? {
        if view.accessibilityRole() == .splitter,
           view.accessibilityLabel() == String(localized: "New messages", table: "ChatUnreadDivider") {
          return view
        }
        return view.subviews.lazy.compactMap { separator(in: $0) }.first
      }

      private func message(_ index: Int) -> Components.Schemas.ChatRoomMessage {
        var message = chatRoomMessage(from: .init(clientTurnId: "message-\(index)", roomId: "room",
                                                  content: "Message \(index)\n" + String(repeating: "\(index) ", count: 12),
                                                  createdAt: Date(),
                                                  sender: .init(id: "user-\(index % 2)", name: "Example", email: "example@example.com", presence: .online)))
        message.id = "message-\(index)"
        // Read messages are yesterday's and the unread run starts today, so the divider shares its row with Today's pill.
        message.createdAt = Calendar.current.startOfDay(for: Date()).addingTimeInterval(Double(index) - (index >= 60 ? 0 : 86400))
        return message
      }
    }
  }
#endif
