#if os(macOS)
  import AppKit
  import CoreAPI
  @testable import Sokosumi
  import SokosumiChat
  import SwiftUI
  import Testing

  extension NativeWindowTests {
    @MainActor struct ArchivedChannelRowTests {
      @Test(arguments: [false, true])
      func rendersRestoreAndPendingRowsInSidebarList(dark: Bool) async throws {
        func room(_ id: String, _ name: String, _ discoverability: Components.Schemas.ChatRoom.DiscoverabilityPayload) -> Components.Schemas.ChatRoom {
          .init(
            id: id, organizationId: "org", name: name, slug: id, kind: .channel, isSelfDirect: false, topic: nil, discoverability: discoverability,
            createdByUserId: "me", createdAt: .distantPast, updatedAt: .distantPast, unreadCount: 0, unreadMentionCount: 0,
            markedUnread: false, myAccess: .member, userMembers: [], coworkerMembers: [], sokoBotMembers: []
          )
        }
        let rooms = [
          room("design", "Design", ._public),
          room("launch", "Launch planning for the very long quarterly roadmap review", ._private),
          room("partners", "Partners", .external)
        ]
        let content = List {
          Section {
            Text("Archived").font(.subheadline.weight(.semibold)).foregroundStyle(.secondary)
            ForEach(rooms, id: \.id) { room in
              ArchivedChannelRow(room: room, pending: room.id == "partners", busy: room.id == "partners", canDelete: true) { _ in
                Issue.record("Rendering must not request lifecycle actions")
              }
            }
          }
        }
        .listStyle(.sidebar)
        .frame(width: 260, height: 180)
        .environment(\.colorScheme, dark ? .dark : .light)
        let host = NSHostingView(rootView: content)
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 260, height: 180), styleMask: [.titled], backing: .buffered, defer: false)
        window.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
        window.contentView = host
        window.orderFront(nil)
        defer { window.orderOut(nil) }
        try await Task.sleep(for: .milliseconds(200))
        host.layoutSubtreeIfNeeded()
        let bitmap = try #require(host.bitmapImageRepForCachingDisplay(in: host.bounds))
        host.cacheDisplay(in: host.bounds, to: bitmap)
        let png = try #require(bitmap.representation(using: .png, properties: [:]))
        try png.write(to: FileManager.default.temporaryDirectory.appendingPathComponent("archived-channels-\(dark ? "dark" : "light").png"))
      }
    }
  }
#endif
