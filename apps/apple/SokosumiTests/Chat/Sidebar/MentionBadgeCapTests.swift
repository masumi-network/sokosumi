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
    @MainActor struct MentionBadgeCapTests {
      private func room(_ id: String, _ name: String, mentions: Int) -> Components.Schemas.ChatRoom {
        .init(
          id: id, name: name, kind: .channel, isSelfDirect: false, discoverability: .external,
          createdByUserId: "me", createdAt: .distantPast, updatedAt: .distantPast, unreadCount: mentions, unreadMentionCount: mentions,
          markedUnread: false, myAccess: .member, userMembers: [], coworkerMembers: [], sokoBotMembers: []
        )
      }

      /// The real sidebar with mention counts around the cap: no badge at zero, "99", and "99+" for 100 and 250.
      @Test(arguments: [false, true])
      func rendersCappedMentionBadges(dark: Bool) async throws {
        let state = WorkspaceState()
        state.rooms = [
          room("a-none", "announcements", mentions: 0),
          room("b-one", "design", mentions: 1),
          room("c-cap", "engineering", mentions: 99),
          room("d-over", "general", mentions: 100),
          room("e-loud", "quarterly-roadmap-planning-and-very-long-launch-review", mentions: 250)
        ]
        // External shows in every workspace kind; Channels needs an organization.
        #expect(state.sidebar.partitioned.external.count == 5)
        let content = ConversationSidebarView()
          .environmentObject(state).environmentObject(AuthState())
          .frame(width: 260, height: 300)
          .environment(\.colorScheme, dark ? .dark : .light)
        let host = NSHostingView(rootView: content)
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 260, height: 300), styleMask: [.titled], backing: .buffered, defer: false)
        window.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
        window.contentView = host
        window.orderFront(nil)
        defer { window.orderOut(nil) }
        try await Task.sleep(for: .milliseconds(200))
        host.layoutSubtreeIfNeeded()
        let bitmap = try #require(host.bitmapImageRepForCachingDisplay(in: host.bounds))
        host.cacheDisplay(in: host.bounds, to: bitmap)
        let png = try #require(bitmap.representation(using: .png, properties: [:]))
        try png.write(to: FileManager.default.temporaryDirectory.appendingPathComponent("sidebar-mention-badge-cap-\(dark ? "dark" : "light").png"))
      }
    }
  }
#endif
