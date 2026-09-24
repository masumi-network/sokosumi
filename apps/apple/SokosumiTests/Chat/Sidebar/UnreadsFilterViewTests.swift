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
    /// Row 24f2: the real sidebar with the Unreads filter on, as web's `OrganizationChatList` draws it: the toggle
    /// row under Threads, one flat list in place of the sections, a room read in the pass dimmed in its place, the
    /// open room listed at full, Pinned below; and caught up, "All caught up" over "Read just now" over the rooms.
    @MainActor struct UnreadsFilterViewTests {
      private static let lastWeek = Date(timeIntervalSince1970: 1_789_500_000)
      private static let reader = Components.Schemas.ChatRoomUserParticipant(
        id: "", name: "Me", email: "me@example.com", image: nil, presence: .offline
      )
      private static let ada = Components.Schemas.ChatRoomUserParticipant(
        id: "019fc7e4-e4bd-7005-900c-66e44d33f5e4", name: "Ada Lovelace", email: "ada@example.com", image: nil, presence: .offline
      )

      /// `rank` orders activity: a smaller rank is newer.
      private static func room(
        _ name: String, rank: Int, kind: Components.Schemas.ChatRoom.KindPayload = .channel, channel: Int = 0,
        thread: String? = nil, pinned: Bool = false
      ) -> Components.Schemas.ChatRoom {
        let id = "550e8400-e29b-41d4-a716-44665544091\(rank)"
        var room = Components.Schemas.ChatRoom(
          id: id, name: name, kind: kind, isSelfDirect: false, isGroupDirect: false,
          discoverability: kind == .channel ? .external : nil, createdByUserId: "ada", createdAt: lastWeek,
          updatedAt: lastWeek.addingTimeInterval(Double(-rank * 60)),
          unreadCount: channel + (thread == nil ? 0 : 1), channelUnreadCount: channel, threadUnreadCount: thread == nil ? 0 : 1,
          unreadThreadCount: thread == nil ? 0 : 1,
          unreadThreads: thread.map { [.init(parentMessageId: "\(id)-0", firstUnreadReplyId: "\(id)-0-reply", parentContent: $0,
                                             unreadReplyCount: 1, unreadMentionCount: 0)] } ?? [],
          unreadMentionCount: 0, mutedAt: nil, markedUnread: false, myAccess: .member,
          userMembers: kind == .direct ? [reader, ada] : [ada], coworkerMembers: [], sokoBotMembers: []
        )
        room.starredAt = pinned ? lastWeek.addingTimeInterval(Double(rank)) : nil
        return room
      }

      private static func read(_ room: Components.Schemas.ChatRoom) -> Components.Schemas.ChatRoom {
        var room = room
        room.unreadCount = 0
        room.channelUnreadCount = 0
        room.threadUnreadCount = 0
        room.unreadThreadCount = 0
        room.unreadThreads = []
        return room
      }

      /// Before the pass: `launch`, `design` and the Direct with Ada (a Thread reply only) are unread, `general` is read, `support` and `ops`
      /// are pinned (`ops` unread).
      private static let rooms = [
        room("launch", rank: 0, channel: 3), room("design", rank: 1, channel: 1),
        room("ada", rank: 2, kind: .direct, thread: "Standup notes"), room("general", rank: 3),
        room("support", rank: 4, pinned: true), room("ops", rank: 5, channel: 2, pinned: true)
      ]

      /// The filter on over `rooms`, whose pass has run; then the rooms move to `now` and `open` is on screen.
      private static func render(
        now: [Components.Schemas.ChatRoom], open: String, dark: Bool, filter: Bool = true, name: String? = nil
      ) async throws -> NSBitmapImageRep {
        let state = WorkspaceState()
        state.rooms = rooms
        if filter {
          state.sidebar.setUnreadsFilter(true)
          try state.sidebar.keepUnreadsFilterPass(#require(state.unreadsFilter).pass)
        }
        state.rooms = now
        state.selectedRoomId = now.first { $0.name == open }?.id
        let size = NSRect(x: 0, y: 0, width: 280, height: 560)
        // The List paints its own background; the account footer below it has none, because in the app the
        // split view's sidebar column shows through. Hosted bare, it would record as transparent pixels.
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
        // The open room is listed, so it keeps the List's selection.
        let selected = views(NSTableRowView.self, in: host).filter(\.isSelected)
        try #require(selected.count == 1, "One selected row, found \(selected.count).")
        // As in `OpenRoomAttentionTests`: `cacheDisplay` cannot composite the selection material.
        selected.flatMap { views(NSVisualEffectView.self, in: $0) }.forEach { $0.isHidden = true }
        host.layoutSubtreeIfNeeded()
        let bitmap = try #require(host.bitmapImageRepForCachingDisplay(in: host.bounds))
        host.cacheDisplay(in: host.bounds, to: bitmap)
        if let name {
          try Attachment.record(#require(bitmap.representation(using: .png, properties: [:])), named: name)
        }
        // The account footer is drawn on the appearance's background, not left transparent.
        let footer = try #require(bitmap.colorAt(x: bitmap.pixelsWide - 40, y: bitmap.pixelsHigh - 30)?.usingColorSpace(.deviceRGB))
        #expect(footer.alphaComponent == 1, "Footer background alpha: \(footer.alphaComponent)")
        #expect(dark ? footer.brightnessComponent < 0.5 : footer.brightnessComponent > 0.5, "Footer brightness: \(footer.brightnessComponent)")
        return bitmap
      }

      private static func views<V: NSView>(_ type: V.Type, in view: NSView) -> [V] {
        ((view as? V).map { [$0] } ?? []) + view.subviews.flatMap { views(type, in: $0) }
      }

      /// `design` was read after the pass took it; `general`, read all along, is the open room.
      private static var readDuringThePass: [Components.Schemas.ChatRoom] {
        rooms.map { $0.name == "design" ? read($0) : $0 }
      }

      private static var allRead: [Components.Schemas.ChatRoom] {
        rooms.map(read)
      }

      private static func differingBytes(_ lhs: NSBitmapImageRep, _ rhs: NSBitmapImageRep) throws -> Int {
        let left = try #require(lhs.bitmapData), right = try #require(rhs.bitmapData)
        let count = lhs.bytesPerRow * lhs.pixelsHigh
        try #require(count == rhs.bytesPerRow * rhs.pixelsHigh)
        return (0 ..< count).count { left[$0] != right[$0] }
      }

      private static func line(_ fragment: String, in lines: [RecognizedLine]) throws -> RecognizedLine {
        try #require(lines.first { $0.text == fragment || $0.text.hasSuffix(" \(fragment)") || $0.text.hasPrefix("\(fragment) ") },
                     "\(fragment) in \(lines.map(\.text))")
      }

      /// Vision's boxes run bottom-up: a lower row has a smaller midY.
      private static func expectTopToBottom(_ fragments: [String], in lines: [RecognizedLine], sourceLocation: SourceLocation = #_sourceLocation) throws {
        let boxes = try fragments.map { try line($0, in: lines).box.midY }
        #expect(boxes == boxes.sorted(by: >), "Top to bottom: \(fragments) in \(lines.map(\.text))", sourceLocation: sourceLocation)
      }

      /// The strongest ink in a recognized line: the darkest pixel in light, the brightest in dark.
      private static func ink(of line: RecognizedLine, in bitmap: NSBitmapImageRep, dark: Bool) throws -> CGFloat {
        let width = CGFloat(bitmap.pixelsWide), height = CGFloat(bitmap.pixelsHigh)
        let columns = Int(line.box.minX * width) ..< Int(line.box.maxX * width)
        let rows = Int((1 - line.box.maxY) * height) ..< Int((1 - line.box.minY) * height)
        var strongest: CGFloat = dark ? 0 : 1
        for column in columns {
          for row in rows {
            let brightness = try #require(bitmap.colorAt(x: column, y: row)?.usingColorSpace(.deviceRGB)).brightnessComponent
            strongest = dark ? max(strongest, brightness) : min(strongest, brightness)
          }
        }
        return strongest
      }

      @Test(arguments: [false, true])
      func rendersTheFlatListInPlaceOfTheSections(dark: Bool) async throws {
        let bitmap = try await Self.render(now: Self.readDuringThePass, open: "general", dark: dark,
                                           name: "unreads-filter-\(dark ? "dark" : "light").png")
        let all = try await Self.render(now: Self.readDuringThePass, open: "general", dark: dark, filter: false)
        #expect(try Self.differingBytes(bitmap, all) > 5000, "The filter draws a different sidebar.")
        // Vision reads text only on a local run (the CI runner returns nil); pixels carry the rest there.
        guard let lines = try RoomThreadOverviewGroupsViewTests.recognizedText(in: bitmap),
              let allLines = try RoomThreadOverviewGroupsViewTests.recognizedText(in: all) else { return }
        let texts = lines.map(\.text)
        try Self.expectTopToBottom(["Threads", "Unreads", "launch", "design", "Ada Lovelace", "Standup notes", "general", "Pinned", "support", "ops"],
                                   in: lines)
        #expect(!texts.contains { $0.contains("Directs") || $0.contains("External") }, "The sections hide: \(texts)")
        #expect(allLines.contains { $0.text.contains("Directs") }, "Off, the sections are back: \(allLines.map(\.text))")
        #expect(allLines.contains { $0.text.contains("Unreads") }, "The toggle row stands with the filter off too.")
        // A room read in the pass is drawn fainter than the open room, which is read too but never dims.
        let design = try Self.ink(of: Self.line("design", in: lines), in: bitmap, dark: dark)
        let general = try Self.ink(of: Self.line("general", in: lines), in: bitmap, dark: dark)
        #expect(dark ? design < general - 0.15 : design > general + 0.15, "design \(design), general \(general)")
      }

      @Test(arguments: [false, true])
      func caughtUpLeadsThenReadJustNowThenPinned(dark: Bool) async throws {
        let bitmap = try await Self.render(now: Self.allRead, open: "design", dark: dark,
                                           name: "unreads-filter-caught-up-\(dark ? "dark" : "light").png")
        guard let lines = try RoomThreadOverviewGroupsViewTests.recognizedText(in: bitmap) else { return }
        try Self.expectTopToBottom(["Unreads", "All caught up", "Read just now", "launch", "design", "Ada Lovelace", "Pinned", "support", "ops"],
                                   in: lines)
        #expect(!lines.contains { $0.text.contains("general") }, "A room that was never unread in the pass is not listed.")
        let launch = try Self.ink(of: Self.line("launch", in: lines), in: bitmap, dark: dark)
        let design = try Self.ink(of: Self.line("design", in: lines), in: bitmap, dark: dark)
        #expect(dark ? launch < design - 0.15 : launch > design + 0.15, "Read rooms dim, the open one does not: launch \(launch), design \(design)")
      }
    }
  }

  /// A line Vision read, with its normalized bounding box.
  private typealias RecognizedLine = (text: String, box: CGRect)
#endif
