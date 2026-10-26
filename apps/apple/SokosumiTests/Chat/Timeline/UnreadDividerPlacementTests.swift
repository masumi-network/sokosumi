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
        // Never invalidated: a request the closing view still starts would raise on an invalidated session.
        let session = TranscriptPageProtocol.session()
        let client = try Client.core(baseURL: #require(URL(string: "https://\(TranscriptPageProtocol.host)/v1")), session: session)
        let state = WorkspaceState(clientProvider: { _ in client })
        try TranscriptPageProtocol.serve([TranscriptPageProtocol.page((0 ..< 100).map(message), cursor: nil, firstUnreadMessageId: "message-60")])
        let room = state.openRoom.room
        room.open(roomId: "room", atUnreadDivider: true)
        defer { room.close() }
        room.hooks = .init(access: { (client, nil) }, failed: { _ in false }, pageLanded: { _ in })
        #expect(await room.load(.initial)?.value == true)
        try #require(room.placesUnreadDivider)

        // No pointer reaches the rows, and none would draw its hover wash or action bar if one did.
        let host = NSHostingView(rootView: RoomTimelineView(roomId: "room").withoutRowHover()
          .environmentObject(state).environmentObject(AuthState()))
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 900, height: 700), styleMask: [.titled], backing: .buffered, defer: false)
        window.ignoresMouseEvents = true
        window.contentView = host
        window.orderFront(nil)
        defer { window.orderOut(nil) }
        let scroll = try await loadedTranscriptScrollView(in: host)

        var fraction: CGFloat?
        let divider = try await waitForView(in: host, timeoutMessage: "The divider did not settle a third of the way down; it sits at \(fraction.map { "\($0)" } ?? "no visible row"); offset \(scroll.contentView.bounds.minY) pt of \(scroll.documentView?.frame.height ?? 0) pt, placement pending \(room.placesUnreadDivider)") {
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
        // The unread run starts a day later, so the divider shares its row with that day's pill.
        message.createdAt = Date(timeIntervalSince1970: 1_700_000_000 + Double(index) + (index >= 60 ? 86400 : 0))
        return message
      }
    }
  }
#endif
