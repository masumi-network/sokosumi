#if os(macOS)
  import AppKit
  import CoreAPI
  import HTTPTypes
  import OpenAPIRuntime
  @testable import Sokosumi
  import SokosumiAuth
  import SokosumiChat
  import SokosumiWorkspace
  import SwiftUI
  import Testing

  extension NativeWindowTests {
    /// Web's `resolveRoomAttention` does not know which room is open, so the selected row keeps
    /// its bold name, mention badge and opt-in count until the room is read, marked read or muted.
    @MainActor struct OpenRoomAttentionTests {
      private static let openRoomId = "a-open"

      private func room(
        _ id: String, _ name: String, unread: Int = 0, mentions: Int = 0, marked: Bool = false, muted: Bool = false
      ) -> Components.Schemas.ChatRoom {
        .init(
          id: id, name: name, kind: .channel, isSelfDirect: false, discoverability: .external,
          createdByUserId: "me", createdAt: .distantPast, updatedAt: .distantPast, unreadCount: unread, unreadMentionCount: mentions,
          mutedAt: muted ? .distantPast : nil, markedUnread: marked, myAccess: .member, userMembers: [], coworkerMembers: [], sokoBotMembers: []
        )
      }

      /// The open room first, then the same attention on a row that is not selected, a read room,
      /// a muted room holding unread and mentions, and a room marked unread.
      private func workspace(openUnread: Int, openMentions: Int) async throws -> WorkspaceState {
        let state = WorkspaceState()
        state.rooms = [
          room(Self.openRoomId, "design-reviews", unread: openUnread, mentions: openMentions),
          room("b-other", "engineering", unread: 12, mentions: 3),
          room("c-read", "general"),
          room("d-muted", "random", unread: 7, mentions: 2, muted: true),
          room("e-marked", "support", marked: true)
        ]
        state.selectedRoomId = Self.openRoomId
        let preferences = #"{"data":{"marketingOptIn":false,"notificationsOptIn":false,"pushOptIn":false,"showRoomUnreadCount":true,"notificationPreferences":[]},"meta":{"timestamp":"2026-09-21T12:00:00.000Z","requestId":"fixture"}}"#
        try await state.chatDisplay.refresh(client: Client.connecting(
          to: #require(URL(string: "https://example.com")), transport: PreferencesFixtureTransport(body: preferences)
        ))
        return state
      }

      private func attention(_ room: Components.Schemas.ChatRoom, in state: WorkspaceState) -> RoomAttention {
        resolveRoomAttention(
          unreadCount: room.unreadCount, unreadMentionCount: room.unreadMentionCount, markedUnread: room.markedUnread,
          isMuted: room.mutedAt != nil, showUnreadCount: state.chatDisplay.showsRoomUnreadCount
        )
      }

      /// The real sidebar in a window. `emphasized` asks for the key window with the list as first
      /// responder, which is what draws the accent selection. A test host that is not the active
      /// app is refused that, so the selected row view is then told to draw emphasized, which is
      /// the same AppKit drawing path.
      private func render(_ state: WorkspaceState, dark: Bool, emphasized: Bool) async throws -> NSBitmapImageRep {
        let content = ConversationSidebarView()
          .environmentObject(state).environmentObject(AuthState())
          .frame(width: 260, height: 300)
          .environment(\.colorScheme, dark ? .dark : .light)
        let host = NSHostingView(rootView: content)
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 260, height: 300), styleMask: [.titled], backing: .buffered, defer: false)
        window.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
        window.contentView = host
        if emphasized {
          NSApplication.shared.activate(ignoringOtherApps: true)
          window.makeKeyAndOrderFront(nil)
        } else {
          window.orderFront(nil)
        }
        defer { window.orderOut(nil) }
        try await Task.sleep(for: .milliseconds(200))
        host.layoutSubtreeIfNeeded()
        let selectedRows = Self.views(NSTableRowView.self, in: host).filter(\.isSelected)
        try #require(selectedRows.count == 1)
        if emphasized {
          let table = try #require(Self.views(NSTableView.self, in: host).first)
          let focused = window.makeFirstResponder(table) && window.isKeyWindow
          if !focused {
            selectedRows.forEach { $0.isEmphasized = true }
          }
          try await Task.sleep(for: .milliseconds(200))
          let drawnEmphasized = selectedRows.filter(\.isEmphasized).count
          #expect(drawnEmphasized == 1)
        }
        // Opt-in pause with the window on screen, for a composited capture of the real highlight:
        // `TEST_RUNNER_SIDEBAR_FIXTURE_HOLD=4 xcodebuild test …` and `screencapture -l <window id>`.
        if let hold = ProcessInfo.processInfo.environment["SIDEBAR_FIXTURE_HOLD"].flatMap(Double.init) {
          try await Task.sleep(for: .seconds(hold))
        }
        // `cacheDisplay` cannot composite the selection material: it comes out solid black and, in
        // light, swallows the row drawn over it. The bitmap therefore leaves the material out and
        // shows the selected row's own content; the highlight itself is in the window captures.
        selectedRows.flatMap { Self.views(NSVisualEffectView.self, in: $0) }.forEach { $0.isHidden = true }
        host.layoutSubtreeIfNeeded()
        let bitmap = try #require(host.bitmapImageRepForCachingDisplay(in: host.bounds))
        host.cacheDisplay(in: host.bounds, to: bitmap)
        return bitmap
      }

      private static func views<V: NSView>(_ type: V.Type, in view: NSView) -> [V] {
        ((view as? V).map { [$0] } ?? []) + view.subviews.flatMap { views(type, in: $0) }
      }

      private func differingBytes(_ lhs: NSBitmapImageRep, _ rhs: NSBitmapImageRep) throws -> Int {
        let left = try #require(lhs.bitmapData), right = try #require(rhs.bitmapData)
        let count = lhs.bytesPerRow * lhs.pixelsHigh
        try #require(count == rhs.bytesPerRow * rhs.pixelsHigh)
        return (0 ..< count).count { left[$0] != right[$0] }
      }

      /// The selected row carries unread bold, a mention badge and the opt-in count, above an
      /// unselected row with the same numbers, in light and dark, unemphasized and emphasized.
      @Test(arguments: [false, true], [false, true])
      func rendersAttentionOnTheSelectedRow(dark: Bool, emphasized: Bool) async throws {
        let state = try await workspace(openUnread: 12, openMentions: 3)
        // What the picture claims: the count preference is on, the first room is the open one,
        // and it resolves to exactly the chrome its unselected neighbour gets.
        #expect(state.chatDisplay.showsRoomUnreadCount)
        // External shows in every workspace kind; muted rooms sort last, so "random" is the bottom row.
        #expect(state.sidebar.partitioned.external.map(\.id) == [Self.openRoomId, "b-other", "c-read", "e-marked", "d-muted"])
        let open = try #require(state.rooms.first { $0.id == state.selectedRoomId })
        #expect(open.id == Self.openRoomId)
        #expect(attention(open, in: state) == .init(bold: true, badgeCount: 3, unreadTextCount: 12))
        #expect(attention(open, in: state) == attention(state.rooms[1], in: state))
        #expect(attention(state.rooms[3], in: state) == .init(bold: false, badgeCount: 0))
        #expect(attention(state.rooms[4], in: state) == .init(bold: true, badgeCount: 0))
        // Web keeps Mark unread off for the room being read and for muted rooms.
        #expect(!state.sidebar.canPerform(.markUnread, roomId: Self.openRoomId))
        #expect(!state.sidebar.canPerform(.markUnread, roomId: "d-muted"))
        #expect(state.sidebar.canPerform(.markUnread, roomId: "b-other"))
        _ = try await render(state, dark: dark, emphasized: emphasized)
      }

      /// The selected row draws its unread state: the same sidebar with the open room unread and
      /// read differs by more than two renders of the read sidebar differ from each other.
      @Test(arguments: [false, true])
      func theSelectedRowDrawsItsUnreadState(dark: Bool) async throws {
        let unread = try await render(workspace(openUnread: 12, openMentions: 3), dark: dark, emphasized: false)
        let read = try await render(workspace(openUnread: 0, openMentions: 0), dark: dark, emphasized: false)
        let readAgain = try await render(workspace(openUnread: 0, openMentions: 0), dark: dark, emphasized: false)
        let noise = try differingBytes(read, readAgain)
        #expect(try differingBytes(unread, read) > noise)
      }
    }
  }

  private nonisolated struct PreferencesFixtureTransport: ClientTransport {
    let body: String
    func send(_: HTTPRequest, body _: HTTPBody?, baseURL _: URL, operationID _: String) async throws -> (HTTPResponse, HTTPBody?) {
      (HTTPResponse(status: .ok), HTTPBody(body))
    }
  }
#endif
