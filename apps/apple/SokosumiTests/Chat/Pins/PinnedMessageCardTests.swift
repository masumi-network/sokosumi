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

    /// Row 21a at the inspector's minimum width: a written pin, a quote-only pin, a quote-only pin whose
    /// author and snippet are both too long, and a blank pin with no quote, which stays sender and time.
    @Test(arguments: [false, true])
    func quoteOnlyPinShowsItsQuoteBesideAWrittenPin(dark: Bool) async throws {
      let width: CGFloat = 280
      let ada = Components.Schemas.ChatRoomMessageQuote(messageId: "source", authorName: "Ada Lovelace", snippet: "Ship the release on Friday.")
      let longQuote = Components.Schemas.ChatRoomMessageQuote(
        messageId: "long", authorName: String(repeating: "Bartholomew Featherstonehaugh ", count: 4),
        snippet: String(repeating: "A long quoted paragraph that has to clamp inside the pin. ", count: 30)
      )
      let (measurements, png) = try await render([("A short **pinned message**.", nil), (" \n", ada), ("", longQuote), ("", nil),
                                                  ("Written over a quote.", ada)], width: width, dark: dark)
      let written = measurements[0].height, quoted = measurements[1].height, blank = measurements[3].height
      // The quote adds its author line and the block's inset to what a one-line body takes.
      #expect(quoted > written + 20)
      // Without the fallback the quote-only pin is the blank pin: sender and time, nothing else.
      #expect(quoted > blank + 30)
      #expect(blank < written)
      // A written body never brings its quote along.
      #expect(abs(measurements[4].height - written) < 1)
      // Long author and snippet truncate and clamp instead of widening or growing the card.
      #expect(measurements[2].height > quoted)
      #expect(measurements[2].height <= 215)
      for measurement in measurements {
        #expect(abs(measurement.width - (width - 24)) < 1)
      }
      Attachment.record(png, named: "pinned-quote-only-\(dark ? "dark" : "light").png")
    }

    private func render(_ sources: [(content: String, quote: Components.Schemas.ChatRoomMessageQuote?)], width: CGFloat,
                        dark: Bool) async throws -> ([HeightMeasurement], Data) {
      let room = Components.Schemas.ChatRoom(id: "fixture", name: "General", kind: .channel, isSelfDirect: false,
                                             createdByUserId: "person", createdAt: .now, updatedAt: .now, unreadCount: 0,
                                             unreadMentionCount: 0, markedUnread: false, myAccess: .member,
                                             userMembers: [], coworkerMembers: [], sokoBotMembers: [])
      let measurements = sources.map { _ in HeightMeasurement() }
      let items = try sources.enumerated().map { index, source in
        let message = chatRoomMessage(from: .init(clientTurnId: "fixture-\(index)", roomId: room.id, content: source.content, quote: source.quote,
                                                  sender: .init(id: "person", name: "Example Person", email: "person@example.com", presence: .online)))
        let payload = try JSONDecoder().decode(Components.Schemas.ChatRoomPinnedMessageListItem.MessagePayload.self,
                                               from: JSONEncoder().encode(message))
        return Components.Schemas.ChatRoomPinnedMessageListItem(messageId: "fixture-\(index)", pinnedAt: .now, message: payload)
      }
      let content = VStack(spacing: 12) {
        ForEach(items.indices, id: \.self) { index in
          PinnedMessageCard(item: items[index], room: room, channels: [], isJumping: false,
                            isUpdating: false, jump: {}, unpin: {})
            .onGeometryChange(for: CGSize.self) { $0.size } action: {
              measurements[index].height = $0.height
              measurements[index].width = $0.width
            }
        }
        Spacer()
      }
      .padding(12).frame(width: width, height: 640)
      .background(.background)
      .environmentObject(WorkspaceState()).environmentObject(AuthState())
      .environment(\.colorScheme, dark ? .dark : .light)
      let host = NSHostingView(rootView: content)
      host.frame = NSRect(x: 0, y: 0, width: width, height: 640)
      for _ in 0 ..< 10 {
        host.layoutSubtreeIfNeeded()
        try await Task.sleep(for: .milliseconds(30))
      }
      let bitmap = try #require(host.bitmapImageRepForCachingDisplay(in: host.bounds))
      host.cacheDisplay(in: host.bounds, to: bitmap)
      return try (measurements, #require(bitmap.representation(using: .png, properties: [:])))
    }

    private final class HeightMeasurement {
      var height: CGFloat = 0
      var width: CGFloat = 0
    }
  }
#endif
