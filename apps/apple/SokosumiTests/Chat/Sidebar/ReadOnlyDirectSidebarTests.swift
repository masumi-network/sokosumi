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
    /// The real sidebar names a Read-only Direct after its Former member, never the reader, and draws that
    /// member's face dimmed without a presence mark (web `DirectRoomAvatarStack`, `getRoomDisplayName`).
    @MainActor struct ReadOnlyDirectSidebarTests {
      private static let lastWeek = Date(timeIntervalSince1970: 1_789_500_000)

      /// The fixture has no signed-in user, so the reader's id is empty.
      private static let reader = Components.Schemas.ChatRoomUserParticipant(
        id: "", name: "Andreas", email: "andreas@example.com", image: nil, presence: .online
      )

      private static func direct(sarthiLeft: Bool) -> Components.Schemas.ChatRoom {
        let sarthi = Components.Schemas.ChatRoomUserParticipant(
          id: "sarthi", name: "Sarthi", email: "sarthi@example.com", image: nil, presence: .online
        )
        return .init(
          id: "550e8400-e29b-41d4-a716-446655440901", name: "Direct", kind: .direct, isSelfDirect: false, isGroupDirect: false,
          isReadOnly: sarthiLeft, createdByUserId: "", createdAt: lastWeek, updatedAt: lastWeek, unreadCount: 0,
          unreadMentionCount: 0, markedUnread: false, myAccess: .init(value1: .member, value2: "member"),
          userMembers: sarthiLeft ? [reader] : [reader, sarthi],
          formerUserMembers: sarthiLeft ? [.init(id: "sarthi", name: "Sarthi", email: "sarthi@example.com", image: nil)] : [],
          coworkerMembers: [], sokoBotMembers: []
        )
      }

      private static func render(sarthiLeft: Bool, dark: Bool, name: String? = nil) async throws -> NSBitmapImageRep {
        let state = WorkspaceState()
        state.rooms = [direct(sarthiLeft: sarthiLeft)]
        let size = NSRect(x: 0, y: 0, width: 260, height: 280)
        let host = NSHostingView(rootView: ConversationSidebarView()
          .environmentObject(state).environmentObject(AuthState())
          .frame(width: size.width, height: size.height)
          .background(.background)
          .environment(\.colorScheme, dark ? .dark : .light))
        let window = NSWindow(contentRect: size, styleMask: [.titled], backing: .buffered, defer: false)
        window.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
        window.contentView = host
        window.orderFront(nil)
        defer { window.orderOut(nil) }
        try await Task.sleep(for: .milliseconds(200))
        host.layoutSubtreeIfNeeded()
        let bitmap = try #require(host.bitmapImageRepForCachingDisplay(in: host.bounds))
        host.cacheDisplay(in: host.bounds, to: bitmap)
        if let name {
          try Attachment.record(#require(bitmap.representation(using: .png, properties: [:])), named: name)
        }
        return bitmap
      }

      private static func differingBytes(_ lhs: NSBitmapImageRep, _ rhs: NSBitmapImageRep) throws -> Int {
        let left = try #require(lhs.bitmapData), right = try #require(rhs.bitmapData)
        let count = lhs.bytesPerRow * lhs.pixelsHigh
        try #require(count == rhs.bytesPerRow * rhs.pixelsHigh)
        return (0 ..< count).count { left[$0] != right[$0] }
      }

      @Test(arguments: [false, true])
      func namesTheFormerMemberAndDimsTheirFace(dark: Bool) async throws {
        let readOnly = try await Self.render(sarthiLeft: true, dark: dark, name: "read-only-direct-sidebar-\(dark ? "dark" : "light").png")
        let readOnlyAgain = try await Self.render(sarthiLeft: true, dark: dark)
        let writable = try await Self.render(sarthiLeft: false, dark: dark)
        // Same name and initial either way; only the dimmed face and the missing presence mark differ.
        let noise = try Self.differingBytes(readOnly, readOnlyAgain)
        let difference = try Self.differingBytes(readOnly, writable)
        #expect(difference > max(noise, SidebarRoomAttentionTests.pixelNoiseFloor) * 4, "\(difference) bytes differ; control pair \(noise)")
        // Vision reads text only on a local run (the CI runner returns nil).
        guard let lines = try RoomThreadOverviewGroupsViewTests.recognizedText(in: readOnly) else { return }
        #expect(lines.contains { $0.text.hasSuffix("Sarthi") }, "The row names who left: \(lines.map(\.text))")
        #expect(!lines.contains { $0.text.hasSuffix("Andreas") }, "Nothing names the reader: \(lines.map(\.text))")
      }
    }
  }
#endif
