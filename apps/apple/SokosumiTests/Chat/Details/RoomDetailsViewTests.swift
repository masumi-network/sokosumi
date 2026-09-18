#if os(macOS)
  import AppKit
  import CoreAPI
  @testable import Sokosumi
  import SokosumiAuth
  import SokosumiWorkspace
  import SwiftUI
  import Testing

  extension NativeWindowTests {
    @MainActor struct RoomDetailsViewTests {
      @Test(arguments: [false, true])
      func rendersAtMinimumInspectorWidth(dark: Bool) async throws {
        let room = Components.Schemas.ChatRoom(
          id: "fixture", name: "Design", kind: .channel, isSelfDirect: false,
          topic: "Discuss designs and share feedback with the team.", discoverability: ._private, createdByUserId: "me",
          createdAt: .distantPast, updatedAt: .distantPast, unreadCount: 0, unreadMentionCount: 0,
          markedUnread: false, myAccess: .member,
          userMembers: [.init(id: "person", name: "Alexandra Long Recipient Name", email: "alexandra@example.com", presence: .afk)],
          coworkerMembers: [.init(id: "coworker", name: "Research assistant", slug: "research", presence: .online)],
          sokoBotMembers: [.init(id: "bot", name: "Personal assistant", caption: "Your assistant", presence: .offline)]
        )
        let content = RoomDetailsView(room: room, close: {})
          .environmentObject(WorkspaceState()).environmentObject(AuthState())
          .frame(width: 280, height: 480).background(.background)
          .environment(\.colorScheme, dark ? .dark : .light)
        let host = NSHostingView(rootView: content)
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 280, height: 480), styleMask: [.titled], backing: .buffered, defer: false)
        window.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
        window.contentView = host
        window.orderFront(nil)
        defer { window.orderOut(nil) }
        try await Task.sleep(for: .milliseconds(200))
        host.layoutSubtreeIfNeeded()
        let bitmap = try #require(host.bitmapImageRepForCachingDisplay(in: host.bounds))
        host.cacheDisplay(in: host.bounds, to: bitmap)
        let png = try #require(bitmap.representation(using: .png, properties: [:]))
        try png.write(to: FileManager.default.temporaryDirectory.appendingPathComponent("room-details-\(dark ? "dark" : "light").png"))
      }
    }
  }
#endif
