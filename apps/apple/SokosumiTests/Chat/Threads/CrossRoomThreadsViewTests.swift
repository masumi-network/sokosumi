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
    /// Row 24f1: the real `CrossRoomThreadsView` (web `/chat/threads`) and the sidebar's Threads row. The test
    /// host builds no accessibility tree, so text is read back with Vision (nil on the CI runner, where only
    /// the pixel checks run) and the tint is found by colour.
    @MainActor struct CrossRoomThreadsViewTests {
      private static let general = "550e8400-e29b-41d4-a716-446655440a01"
      private static let design = "550e8400-e29b-41d4-a716-446655440b02"
      private static let width: CGFloat = 440

      /// Both groups, each row naming its room: unread rows tinted with "N new · #room", the one naming the
      /// reader with its `@` pill, then Earlier with "#room · N replies".
      @Test(arguments: [false, true])
      func rendersBothGroupsWithTheirRooms(dark: Bool) async throws {
        let rooms = [Self.room(Self.general, "general", unreadThreads: 1, mentions: 1), Self.room(Self.design, "design", unreadThreads: 1)]
        let threads = try await Self.loaded(rooms: rooms, unread: [
          Self.unread("u1", room: Self.general, content: "Release checklist", replies: 2, mentions: 1),
          Self.unread("u2", room: Self.design, content: "Launch copy", replies: 1)
        ], earlier: [Self.earlier("e1", room: Self.design, content: "Design review notes", replies: 4)])
        #expect(threads.unreadState(rooms: rooms, roomsLive: true) == .rows && threads.showsEarlier(rooms: rooms))
        let bitmap = try await Self.render(threads: threads, rooms: rooms, dark: dark, name: "cross-room-threads-\(dark ? "dark" : "light").png")
        let scale = CGFloat(bitmap.pixelsWide) / Self.width
        let tinted = RoomThreadOverviewGroupsViewTests.coloredPixels(in: bitmap, columns: 0 ..< Int(52 * scale))
        #expect(tinted.count > 40, "Both unread rows lead with a tinted mark.")

        guard let lines = try RoomThreadOverviewGroupsViewTests.recognizedText(in: bitmap) else { return }
        let texts = lines.map(\.text)
        func top(_ fragment: String) -> CGFloat? {
          lines.first { $0.text.contains(fragment) }.map { (1 - $0.box.maxY) * CGFloat(bitmap.pixelsHigh) }
        }
        let unreadHeading = try #require(top("Unread"), "\(texts)")
        let release = try #require(top("Release checklist"), "\(texts)")
        let launch = try #require(top("Launch copy"), "\(texts)")
        let earlier = try #require(top("Earlier"), "\(texts)")
        let design = try #require(top("Design review notes"), "\(texts)")
        #expect(unreadHeading < release && release < launch && launch < earlier && earlier < design, "Core's order under each heading: \(texts)")
        #expect(texts.contains { $0.contains("2 new") && $0.contains("#general") }, "\(texts)")
        #expect(texts.contains { $0.contains("1 new") && $0.contains("#design") }, "\(texts)")
        #expect(texts.contains { $0.contains("#design") && $0.contains("4 replies") }, "\(texts)")
        #expect(!texts.contains { $0.contains("Started by") || $0.contains("All caught up") }, "\(texts)")
        #expect(tinted.allSatisfy { CGFloat($0.y) < earlier }, "Only the rows under Unread are tinted.")
      }

      /// Live rooms counting no unread Thread say "All caught up" under Unread, with Earlier below it and
      /// no tint anywhere.
      @Test(arguments: [false, true])
      func aCaughtUpReaderSeesAllCaughtUpOverEarlier(dark: Bool) async throws {
        let rooms = [Self.room(Self.general, "general"), Self.room(Self.design, "design")]
        let threads = try await Self.loaded(rooms: rooms, unread: nil, earlier: [
          Self.earlier("e1", room: Self.general, content: "Release checklist", replies: 1),
          Self.earlier("e2", room: Self.design, content: "Design review notes", replies: 4)
        ])
        let bitmap = try await Self.render(threads: threads, rooms: rooms, dark: dark, name: "cross-room-threads-caught-up-\(dark ? "dark" : "light").png")
        #expect(RoomThreadOverviewGroupsViewTests.coloredPixels(in: bitmap, columns: 0 ..< bitmap.pixelsWide).isEmpty,
                "Nothing is tinted with nothing unread.")
        guard let lines = try RoomThreadOverviewGroupsViewTests.recognizedText(in: bitmap) else { return }
        let texts = lines.map(\.text)
        func top(_ fragment: String) -> CGFloat? {
          lines.first { $0.text.contains(fragment) }.map { (1 - $0.box.maxY) * CGFloat(bitmap.pixelsHigh) }
        }
        let caughtUp = try #require(top("All caught up"), "\(texts)")
        let earlier = try #require(top("Earlier"), "\(texts)")
        #expect(try #require(top("Unread"), "\(texts)") < caughtUp && caughtUp < earlier, "\(texts)")
        #expect(texts.contains { $0.contains("#general") && $0.contains("1 reply") }, "\(texts)")
      }

      /// The sidebar's Threads row, above every section: bold with the muted count of unread Threads, the
      /// mention badge instead when one names the reader, plain at zero.
      @Test(arguments: [false, true])
      func theSidebarThreadsRowCarriesOneNumber(dark: Bool) async throws {
        let counted = try await Self.renderSidebar([Self.room(Self.general, "general", unreadThreads: 3)], dark: dark, name: "threads-row-count-\(dark ? "dark" : "light").png")
        let mentioned = try await Self.renderSidebar([Self.room(Self.general, "general", unreadThreads: 3, mentions: 2)], dark: dark, name: "threads-row-mention-\(dark ? "dark" : "light").png")
        let quiet = try await Self.renderSidebar([Self.room(Self.general, "general")], dark: dark, name: "threads-row-quiet-\(dark ? "dark" : "light").png")
        let counts = try [counted, mentioned, quiet].map { bitmap in
          try RoomThreadOverviewGroupsViewTests.recognizedText(in: bitmap).map { lines in
            let row = lines.first { $0.text.contains("Threads") }
            // The number drawn on the Threads row's line, by the row's own band.
            return lines.filter { line in
              guard let row else { return false }
              return abs(line.box.midY - row.box.midY) < 0.03 && line.text != row.text
            }.map(\.text) + [row?.text ?? ""]
          }
        }
        guard let countedTexts = counts[0], let mentionedTexts = counts[1], let quietTexts = counts[2] else { return }
        // Vision reads the small muted "3" as a Cyrillic "З" at times; what matters is one number on the line.
        #expect(countedTexts.count == 2 && countedTexts.contains { $0.contains("Threads") }, "\(countedTexts)")
        #expect(mentionedTexts.count == 2 && mentionedTexts.contains("2"), "One number, the mentions: \(mentionedTexts)")
        #expect(quietTexts.count == 1, "\(quietTexts)")
      }

      // MARK: Fixtures

      private static func room(_ id: String, _ name: String, unreadThreads: Int = 0, mentions: Int = 0) -> Components.Schemas.ChatRoom {
        .init(
          id: id, name: name, kind: .channel, isSelfDirect: false, isGroupDirect: false, discoverability: ._public,
          createdByUserId: "me", createdAt: .distantPast, updatedAt: .distantPast, unreadCount: 0,
          unreadThreadCount: unreadThreads, unreadThreadMentionCount: mentions, unreadMentionCount: 0,
          markedUnread: false, myAccess: .member, userMembers: [], coworkerMembers: [], sokoBotMembers: []
        )
      }

      private static let lastWeek = "2026-09-16T12:00:00.000Z"

      private static func unread(_ id: String, room: String, content: String, replies: Int, mentions: Int = 0) -> String {
        """
        {"parentMessageId":"\(id)","firstUnreadReplyId":"\(id)-reply","parentContent":"\(content)","unreadReplyCount":\(replies),"unreadMentionCount":\(mentions),"roomId":"\(room)","lastUnreadAt":"\(lastWeek)"}
        """
      }

      private static func earlier(_ id: String, room: String, content: String, replies: Int) -> String {
        """
        {"roomId":"\(room)","parentMessageId":"\(id)","parentContent":"\(content)","replyCount":\(replies),"lastReplyAt":"\(lastWeek)","lastReplyId":"\(id)-last"}
        """
      }

      private static func page(_ items: [String]) -> String {
        "{\"data\":[\(items.joined(separator: ","))],\"meta\":{\"timestamp\":\"\(lastWeek)\",\"requestId\":\"fixture\",\"pagination\":{\"cursor\":null,\"limit\":50,\"total\":\(items.count),\"nextCursor\":null}}}"
      }

      /// The lists as Core answered them. `unread: nil` leaves the Unread list unread, as the rooms answer.
      private static func loaded(rooms: [Components.Schemas.ChatRoom], unread: [String]?, earlier: [String]) async throws -> CrossRoomThreads {
        let transport = ThreadsFixtureTransport(unread: page(unread ?? []), earlier: page(earlier))
        let client = try Client.connecting(to: #require(URL(string: "https://example.com")), transport: transport)
        let threads = CrossRoomThreads()
        if unread != nil {
          try await threads.load(.unread, rooms: rooms, scope: "fixture", client: client, organizationSlug: nil)
        }
        try await threads.load(.earlier, rooms: rooms, scope: "fixture", client: client, organizationSlug: nil)
        return threads
      }

      private static func render(threads: CrossRoomThreads, rooms: [Components.Schemas.ChatRoom], dark: Bool, name: String) async throws -> NSBitmapImageRep {
        let height: CGFloat = 330
        let host = NSHostingView(rootView: CrossRoomThreadsView(
          threads: threads, rooms: rooms, roomsLive: true, currentUserId: "me", scope: "fixture", load: { _ in }, open: { _, _ in }
        )
        .frame(width: width, height: height).background(.background)
        .environment(\.colorScheme, dark ? .dark : .light))
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: width, height: height), styleMask: [.titled], backing: .buffered, defer: false)
        defer { window.orderOut(nil) }
        window.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
        window.contentView = host
        window.orderFront(nil)
        for _ in 0 ..< 10 {
          host.layoutSubtreeIfNeeded()
          try await Task.sleep(for: .milliseconds(20))
        }
        let bitmap = try fittedBitmap(of: host, in: window)
        try Attachment.record(#require(bitmap.representation(using: .png, properties: [:])), named: name)
        return bitmap
      }

      /// The real sidebar with the Threads view open, so the Threads row is the selected one.
      private static func renderSidebar(_ rooms: [Components.Schemas.ChatRoom], dark: Bool, name: String) async throws -> NSBitmapImageRep {
        let state = WorkspaceState()
        state.rooms = rooms
        state.showThreadsView()
        // The List paints its own background; the account footer below it has none, because in the app the
        // split view's sidebar column shows through. Hosted bare, it would record as transparent pixels, so the
        // fixture puts the appearance's window background behind the whole sidebar.
        let host = NSHostingView(rootView: ConversationSidebarView()
          .environmentObject(state).environmentObject(AuthState())
          .frame(width: 260, height: 200)
          .background(.background)
          .environment(\.colorScheme, dark ? .dark : .light))
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 260, height: 200), styleMask: [.titled], backing: .buffered, defer: false)
        window.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
        window.contentView = host
        window.orderFront(nil)
        defer { window.orderOut(nil) }
        try await Task.sleep(for: .milliseconds(200))
        host.layoutSubtreeIfNeeded()
        // The Threads row is the List's selection while the view is open.
        let selected = views(NSTableRowView.self, in: host).filter(\.isSelected)
        #expect(selected.count == 1, "The Threads row is selected while its view is open.")
        // As in `OpenRoomAttentionTests`: `cacheDisplay` cannot composite the selection material, so the
        // bitmap leaves it out and shows the selected row's own content.
        selected.flatMap { views(NSVisualEffectView.self, in: $0) }.forEach { $0.isHidden = true }
        host.layoutSubtreeIfNeeded()
        let bitmap = try #require(host.bitmapImageRepForCachingDisplay(in: host.bounds))
        host.cacheDisplay(in: host.bounds, to: bitmap)
        try Attachment.record(#require(bitmap.representation(using: .png, properties: [:])), named: name)
        // The account footer below the List is drawn on the appearance's background, not left transparent: a
        // viewer shows transparency as white, which hides the dark footer's light "Me".
        let footer = try #require(bitmap.colorAt(x: bitmap.pixelsWide - 40, y: bitmap.pixelsHigh - 30)?.usingColorSpace(.deviceRGB))
        #expect(footer.alphaComponent == 1, "Footer background alpha: \(footer.alphaComponent)")
        #expect(dark ? footer.brightnessComponent < 0.5 : footer.brightnessComponent > 0.5, "Footer brightness: \(footer.brightnessComponent)")
        return bitmap
      }

      private static func views<V: NSView>(_ type: V.Type, in view: NSView) -> [V] {
        ((view as? V).map { [$0] } ?? []) + view.subviews.flatMap { views(type, in: $0) }
      }
    }
  }

  private nonisolated struct ThreadsFixtureTransport: ClientTransport {
    let unread: String
    let earlier: String
    func send(_: HTTPRequest, body _: HTTPBody?, baseURL _: URL, operationID: String) async throws -> (HTTPResponse, HTTPBody?) {
      (HTTPResponse(status: .ok), HTTPBody(operationID.hasSuffix("earlier") ? earlier : unread))
    }
  }
#endif
