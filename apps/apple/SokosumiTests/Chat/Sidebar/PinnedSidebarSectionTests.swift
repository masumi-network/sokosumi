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
    @MainActor struct PinnedSidebarSectionTests {
      private func room(
        _ id: String, _ name: String, kind: Components.Schemas.ChatRoom.KindPayload = .channel,
        discoverability: Components.Schemas.ChatRoom.DiscoverabilityPayload? = ._public, starredAfter seconds: TimeInterval? = nil,
        unread: Int = 0, mentions: Int = 0, peers: [Components.Schemas.ChatRoomUserParticipant] = []
      ) -> Components.Schemas.ChatRoom {
        .init(
          id: id, name: name, kind: kind, isSelfDirect: false, discoverability: kind == .channel ? discoverability : nil,
          createdByUserId: "me", createdAt: .distantPast, updatedAt: .distantPast, unreadCount: unread, unreadMentionCount: mentions,
          starredAt: seconds.map { Date(timeIntervalSince1970: $0) }, markedUnread: false, myAccess: .member, userMembers: peers, coworkerMembers: [], sokoBotMembers: []
        )
      }

      /// The real sidebar over a scripted room list: Pinned open, in reorder mode, and closed with attention.
      @Test(arguments: ["open", "reorder", "closed"], [false, true])
      func rendersPinnedSection(mode: String, dark: Bool) async throws {
        let state = WorkspaceState()
        let ada = Components.Schemas.ChatRoomUserParticipant(id: "ada", name: "Ada Lovelace", email: "ada@example.com", presence: .online)
        state.rooms = [
          room("private", "design-reviews", discoverability: ._private, starredAfter: 10, unread: 2),
          room("direct", "Ada", kind: .direct, starredAfter: 20, peers: [ada]),
          room("external", "Acme partners", discoverability: .external, starredAfter: 30, unread: 1, mentions: 3),
          room("long", "quarterly-roadmap-planning-and-very-long-launch-review", starredAfter: 40),
          room("plain", "Grace", kind: .direct, peers: [.init(id: "grace", name: "Grace Hopper", email: "grace@example.com", presence: .offline)])
        ]
        state.selectedRoomId = "direct"
        #expect(state.sidebar.partitioned.pinned.map(\.id) == ["private", "direct", "external", "long"])
        switch mode {
        case "reorder":
          state.sidebar.setPinnedReorderMode(true)
          #expect(state.sidebar.pinnedReorderMode)
        case "closed":
          state.sidebar.setExpanded(false, section: .pinned)
        default:
          break
        }
        let content = ConversationSidebarView()
          .environmentObject(state).environmentObject(AuthState())
          .frame(width: 260, height: 360)
          .environment(\.colorScheme, dark ? .dark : .light)
        let host = NSHostingView(rootView: content)
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 260, height: 360), styleMask: [.titled], backing: .buffered, defer: false)
        window.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
        window.contentView = host
        window.orderFront(nil)
        defer { window.orderOut(nil) }
        try await Task.sleep(for: .milliseconds(200))
        host.layoutSubtreeIfNeeded()
        let bitmap = try #require(host.bitmapImageRepForCachingDisplay(in: host.bounds))
        host.cacheDisplay(in: host.bounds, to: bitmap)
        let png = try #require(bitmap.representation(using: .png, properties: [:]))
        try png.write(to: FileManager.default.temporaryDirectory.appendingPathComponent("sidebar-pinned-\(mode)-\(dark ? "dark" : "light").png"))
      }
    }
  }
#endif
