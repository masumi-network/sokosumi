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
    /// Row 24g1: the real sidebar draws web's ADR 0037 rows. Thread replies alone leave a room quiet, a
    /// Thread mention bolds and badges it, a row draws one number (the badge, or else the muted count at
    /// the trailing edge), and a Direct of two draws its count instead of a badge.
    @MainActor struct SidebarRoomAttentionTests {
      private static let lastWeek = Date(timeIntervalSince1970: 1_789_500_000)

      /// The fixture has no signed-in user, so the reader's id is empty.
      private static let reader = Components.Schemas.ChatRoomUserParticipant(
        id: "", name: "Me", email: "me@example.com", image: nil, presence: .offline
      )

      private static func person(_ name: String) -> Components.Schemas.ChatRoomUserParticipant {
        .init(id: name.lowercased(), name: name, email: "\(name.lowercased())@example.com", image: nil, presence: .offline)
      }

      /// `rank` orders the rows: newer activity lists first.
      private static func room(
        _ name: String, rank: Int, kind: Components.Schemas.ChatRoom.KindPayload = .channel,
        members: [Components.Schemas.ChatRoomUserParticipant] = [], channel: Int = 0, thread: Int = 0, mentions: Int = 0,
        threads: Int = 0, threadMentions: Int = 0
      ) -> Components.Schemas.ChatRoom {
        let updated = lastWeek.addingTimeInterval(Double(-rank * 60))
        return .init(
          id: "550e8400-e29b-41d4-a716-44665544080\(rank)", name: name, kind: kind, isSelfDirect: false, isGroupDirect: members.count > 2,
          discoverability: kind == .channel ? .external : nil, createdByUserId: "ada", createdAt: lastWeek, updatedAt: updated,
          unreadCount: channel + thread, channelUnreadCount: channel, threadUnreadCount: thread, unreadThreadCount: threads,
          unreadThreadMentionCount: threadMentions, unreadMentionCount: mentions, markedUnread: false, myAccess: .member,
          userMembers: members, coworkerMembers: [], sokoBotMembers: []
        )
      }

      /// External rooms show in every workspace kind; the arguments change one room's counts.
      private static func rooms(
        designThread: Int = 4, engineeringChannel: Int = 12, adaMentions: Int = 2
      ) -> [Components.Schemas.ChatRoom] {
        [
          room("design", rank: 0, thread: designThread, threads: 2),
          room("launch", rank: 1, thread: 1, mentions: 1, threads: 1, threadMentions: 1),
          room("engineering", rank: 2, channel: engineeringChannel, mentions: 3),
          room("support", rank: 3, channel: 5),
          room("general", rank: 4),
          room("ada", rank: 5, kind: .direct, members: [reader, person("Ada")], channel: 2, mentions: adaMentions),
          room("team", rank: 6, kind: .direct, members: [reader, person("Ada"), person("Grace")], channel: 3, mentions: 1)
        ]
      }

      private static func workspace(_ rooms: [Components.Schemas.ChatRoom]) async throws -> WorkspaceState {
        let state = WorkspaceState()
        state.rooms = rooms
        let preferences = #"{"data":{"marketingOptIn":false,"notificationsOptIn":false,"pushOptIn":false,"showRoomUnreadCount":true,"notificationPreferences":[]},"meta":{"timestamp":"2026-09-23T12:00:00.000Z","requestId":"fixture"}}"#
        try await state.chatDisplay.refresh(client: Client.connecting(
          to: #require(URL(string: "https://example.com")), transport: AttentionPreferencesTransport(body: preferences)
        ))
        return state
      }

      private static func render(_ rooms: [Components.Schemas.ChatRoom], dark: Bool, name: String? = nil) async throws -> NSBitmapImageRep {
        let state = try await workspace(rooms)
        let size = NSRect(x: 0, y: 0, width: 260, height: 500)
        // The List paints its own background; the account footer below it has none, because in the app the
        // split view's sidebar column shows through. Hosted bare, it would record as transparent pixels, so the
        // fixture puts the appearance's window background behind the whole sidebar.
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

      /// Bytes two renders of the same sidebar may differ by even when the control pair matches exactly. Measured
      /// on 2026-09-23 by regressing each rule the pixel tests guard: Thread replies bolding the row changed 3294
      /// (light) / 3333 (dark) bytes, the count drawn beside a badge 540 / 540, a Direct of two badged 579 / 612;
      /// the control pairs differed by 0. The floor is under 10 % of the smallest of those, 540.
      static let pixelNoiseFloor = 50

      /// `subject` looks like `reference`: it differs by no more than two renders of the reference differ from
      /// each other, or than `pixelNoiseFloor` when those two happen to match exactly.
      private static func expectSamePicture(
        _ subject: NSBitmapImageRep, _ reference: NSBitmapImageRep, _ referenceAgain: NSBitmapImageRep,
        sourceLocation: SourceLocation = #_sourceLocation
      ) throws {
        let difference = try differingBytes(subject, reference)
        let noise = try differingBytes(reference, referenceAgain)
        #expect(difference <= max(noise, pixelNoiseFloor), "\(difference) bytes differ; control pair \(noise)", sourceLocation: sourceLocation)
      }

      /// What the recorded picture claims, from the resolver the row draws with.
      @Test(arguments: [false, true])
      func rendersTheRowsWebDraws(dark: Bool) async throws {
        let rooms = Self.rooms()
        let attention = rooms.map { resolveRoomAttention($0, showUnreadCount: true) }
        #expect(attention == [
          .init(bold: false, badgeCount: 0),
          .init(bold: true, badgeCount: 1),
          .init(bold: true, badgeCount: 3),
          .init(bold: true, badgeCount: 0, unreadTextCount: 5),
          .init(bold: false, badgeCount: 0),
          .init(bold: true, badgeCount: 2, mentionCount: 0, unreadTextCount: 2),
          .init(bold: true, badgeCount: 1)
        ])
        let bitmap = try await Self.render(rooms, dark: dark, name: "sidebar-room-attention-\(dark ? "dark" : "light").png")
        // The account footer below the List is drawn on the appearance's background, not left transparent: a
        // viewer shows transparency as white, which hid the dark footer's light "Me".
        let footer = try #require(bitmap.colorAt(x: bitmap.pixelsWide - 40, y: bitmap.pixelsHigh - 30)?.usingColorSpace(.deviceRGB))
        #expect(footer.alphaComponent == 1, "Footer background alpha: \(footer.alphaComponent)")
        #expect(dark ? footer.brightnessComponent < 0.5 : footer.brightnessComponent > 0.5, "Footer brightness: \(footer.brightnessComponent)")
        // Vision reads text only on a local run (the CI runner returns nil); pixels carry the other tests.
        guard let lines = try RoomThreadOverviewGroupsViewTests.recognizedText(in: bitmap) else { return }
        /// Web draws the count in the badge's column, so the name ends its text line (Vision reads the globe
        /// before it as "@" at times, or leaves it out).
        func isRow(_ text: String, _ name: String) -> Bool {
          text == name || text.hasSuffix(" \(name)")
        }
        for name in ["design", "support", "engineering"] {
          #expect(lines.contains { isRow($0.text, name) }, "\(name) ends its line: \(lines.map(\.text))")
        }
        func band(_ name: String) -> [String] {
          guard let row = lines.first(where: { isRow($0.text, name) }) else { return [] }
          return lines.filter { abs($0.box.midY - row.box.midY) < 0.02 && $0.text != row.text }.map(\.text)
        }
        #expect(band("design").isEmpty, "Thread replies alone draw no number: \(band("design"))")
        // Vision reads the small badge "3" as a Cyrillic "З" at times; what matters is that 12 is not drawn.
        #expect(!band("engineering").contains { $0.contains("12") }, "The badge stands alone: \(band("engineering"))")
      }

      /// Thread unread alone does not change a room's row: the same sidebar with the replies and without.
      @Test(arguments: [false, true])
      func threadRepliesAloneDrawNothing(dark: Bool) async throws {
        let replies = try await Self.render(Self.rooms(designThread: 4), dark: dark)
        let none = try await Self.render(Self.rooms(designThread: 0), dark: dark)
        let noneAgain = try await Self.render(Self.rooms(designThread: 0), dark: dark)
        try Self.expectSamePicture(replies, none, noneAgain)
      }

      /// One number per row: with a mention badge the message count is not drawn, so 12 and 7 look alike.
      @Test(arguments: [false, true])
      func aBadgedRowDrawsNoCount(dark: Bool) async throws {
        let twelve = try await Self.render(Self.rooms(engineeringChannel: 12), dark: dark)
        let seven = try await Self.render(Self.rooms(engineeringChannel: 7), dark: dark)
        let sevenAgain = try await Self.render(Self.rooms(engineeringChannel: 7), dark: dark)
        try Self.expectSamePicture(twelve, seven, sevenAgain)
      }

      /// A Direct of two draws its count, never a mention badge: two messages look the same with or without
      /// Core counting them toward the badge.
      @Test(arguments: [false, true])
      func aDirectOfTwoDrawsNoBadge(dark: Bool) async throws {
        let badged = try await Self.render(Self.rooms(adaMentions: 2), dark: dark)
        let plain = try await Self.render(Self.rooms(adaMentions: 0), dark: dark)
        let plainAgain = try await Self.render(Self.rooms(adaMentions: 0), dark: dark)
        try Self.expectSamePicture(badged, plain, plainAgain)
      }
    }
  }

  private nonisolated struct AttentionPreferencesTransport: ClientTransport {
    let body: String
    func send(_: HTTPRequest, body _: HTTPBody?, baseURL _: URL, operationID _: String) async throws -> (HTTPResponse, HTTPBody?) {
      (HTTPResponse(status: .ok), HTTPBody(body))
    }
  }
#endif
