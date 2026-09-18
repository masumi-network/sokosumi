#if os(macOS)
  import AppKit
  import CoreAPI
  @testable import Sokosumi
  import SokosumiAuth
  import SokosumiChat
  import SokosumiWorkspace
  import SwiftUI
  import Testing

  @MainActor struct PinnedMessageCardTests {
    @Test(arguments: [false, true])
    func previewsFitInspectorWithoutExpandingShortMessages(dark: Bool) async throws {
      let room = Components.Schemas.ChatRoom(id: "fixture", name: "General", kind: .channel, isSelfDirect: false,
                                             createdByUserId: "person", createdAt: .now, updatedAt: .now, unreadCount: 0,
                                             unreadMentionCount: 0, markedUnread: false, myAccess: .member,
                                             userMembers: [], coworkerMembers: [], sokoBotMembers: [])
      let sources: [String?] = ["A short **pinned message**.",
                                String(repeating: "A longer paragraph with **bold text** and `code`. ", count: 30), nil]
      let measurements = sources.map { _ in HeightMeasurement() }
      let items = try sources.enumerated().map { index, source in
        let message = source.map {
          chatRoomMessage(from: .init(clientTurnId: "fixture-\(index)", roomId: room.id, content: $0,
                                      sender: .init(id: "person", name: "Example Person", email: "person@example.com", presence: .online)))
        }
        let payload = try message.map { try JSONDecoder().decode(
          Components.Schemas.ChatRoomPinnedMessageListItem.MessagePayload.self, from: JSONEncoder().encode($0)
        ) }
        return Components.Schemas.ChatRoomPinnedMessageListItem(messageId: "fixture-\(index)", pinnedAt: .now, message: payload)
      }
      let content = VStack(spacing: 12) {
        ForEach(items.indices, id: \.self) { index in
          PinnedMessageCard(item: items[index], room: room, channels: [], isJumping: false,
                            isUpdating: false, jump: {}, unpin: {})
            .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { measurements[index].height = $0 }
        }
        Spacer()
      }
      .padding(12).frame(width: 340, height: 540)
      .background(.background)
      .environmentObject(WorkspaceState()).environmentObject(AuthState())
      .environment(\.colorScheme, dark ? .dark : .light)
      let host = NSHostingView(rootView: content)
      host.frame = NSRect(x: 0, y: 0, width: 340, height: 540)
      for _ in 0 ..< 10 {
        host.layoutSubtreeIfNeeded()
        try await Task.sleep(for: .milliseconds(30))
      }
      #expect(measurements[0].height > 30)
      #expect(measurements[0].height < 100)
      #expect(measurements[1].height <= 175)
      #expect(measurements[2].height < 100)
      let bitmap = try #require(host.bitmapImageRepForCachingDisplay(in: host.bounds))
      host.cacheDisplay(in: host.bounds, to: bitmap)
      let png = try #require(bitmap.representation(using: .png, properties: [:]))
      try png.write(to: URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("pinned-cards-\(dark ? "dark" : "light").png"))
    }

    private final class HeightMeasurement {
      var height: CGFloat = 0
    }
  }
#endif
