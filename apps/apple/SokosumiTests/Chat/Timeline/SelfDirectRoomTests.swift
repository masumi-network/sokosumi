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
    /// Row 27c: the real sidebar names the reader's Self Direct "You" beside their own face, and its empty transcript
    /// says what the room is for (web `getRoomDisplayName`, `DirectRoomAvatarStack`, `rooms-client.tsx`:3219-3230).
    @MainActor struct SelfDirectRoomTests {
      private static let roomId = "550e8400-e29b-41d4-a716-446655440272"
      private static let created = Date(timeIntervalSince1970: 1_790_000_000)

      /// The fixture has no signed-in user, so the reader's id is empty.
      private static let selfDirect = Components.Schemas.ChatRoom(
        id: roomId, name: "Direct", kind: .direct, isSelfDirect: true, isGroupDirect: false, isReadOnly: false,
        createdByUserId: "", createdAt: created, updatedAt: created, unreadCount: 0, unreadMentionCount: 0,
        markedUnread: false, myAccess: .init(value1: .member, value2: "member"),
        userMembers: [.init(id: "", name: "Ada Lovelace", email: "ada@example.com", image: nil, presence: .online)],
        formerUserMembers: [], coworkerMembers: [], sokoBotMembers: []
      )

      private static func render(dark: Bool) async throws -> NSBitmapImageRep {
        let state = WorkspaceState(clientProvider: { _ in Client.connecting(to: URL(string: "https://example.com")!) })
        state.rooms = [selfDirect]
        state.timeline.reset(roomId: roomId)
        state.timeline.failInitialLoad(message: "", generation: state.timeline.generation)
        state.transcriptError = nil
        let size = NSRect(x: 0, y: 0, width: 900, height: 360)
        let host = NSHostingView(rootView: HStack(spacing: 0) {
          ConversationSidebarView().frame(width: 260)
          Divider()
          RoomTimelineView(roomId: roomId)
        }
        .frame(width: size.width, height: size.height)
        .background(.background)
        .environment(\.locale, Locale(identifier: "en"))
        .environment(\.colorScheme, dark ? .dark : .light)
        .environmentObject(state).environmentObject(AuthState()))
        let window = NSWindow(contentRect: size, styleMask: [.titled], backing: .buffered, defer: false)
        window.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
        window.ignoresMouseEvents = true
        window.contentView = host
        window.orderFront(nil)
        defer { window.orderOut(nil) }
        try await Task.sleep(for: .milliseconds(400))
        host.layoutSubtreeIfNeeded()
        let bitmap = try #require(host.bitmapImageRepForCachingDisplay(in: host.bounds))
        host.cacheDisplay(in: host.bounds, to: bitmap)
        try Attachment.record(#require(bitmap.representation(using: .png, properties: [:])),
                              named: "self-direct-room-\(dark ? "dark" : "light").png")
        return bitmap
      }

      @Test(arguments: [false, true])
      func theRowIsYouAndTheEmptyTranscriptSaysWhatItIsFor(dark: Bool) async throws {
        let bitmap = try await Self.render(dark: dark)
        // Opaque everywhere: the window background shows through nowhere.
        let corner = try #require(bitmap.colorAt(x: 2, y: 2))
        #expect(corner.alphaComponent == 1)
        // Vision reads text only on a local run (the CI runner returns nil).
        guard let lines = try RoomThreadOverviewGroupsViewTests.recognizedText(in: bitmap) else { return }
        let texts = lines.map(\.text)
        #expect(texts.contains { $0 == "You" || ($0.hasSuffix(" You") && !$0.hasPrefix("Message")) }, "The row is named You: \(texts)")
        #expect(!texts.contains { $0.contains("Ada Lovelace") }, "Nothing names the reader: \(texts)")
        #expect(texts.contains("Message yourself"), "\(texts)")
        #expect(texts.contains { $0.contains("Send yourself notes and to-dos") }, "\(texts)")
        #expect(!texts.contains("No messages yet"), "\(texts)")
      }
    }
  }
#endif
