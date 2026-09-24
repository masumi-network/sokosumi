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
    /// Row 24g2: the real sidebar insets a room's unread Threads under its row, as web's `ChatRoomThreadRows`
    /// does: each Thread named by its parent with one number, the overflow row under them, nothing under a
    /// muted room or while Pinned is being reordered, and the room row keeps the List's selection.
    @MainActor struct SidebarThreadRowsViewTests {
      private static let lastWeek = Date(timeIntervalSince1970: 1_789_500_000)
      private static let adaId = "019fc7e4-e4bd-7005-900c-66e44d33f5e4"
      private static let reader = Components.Schemas.ChatRoomUserParticipant(
        id: "", name: "Me", email: "me@example.com", image: nil, presence: .offline
      )
      private static let ada = Components.Schemas.ChatRoomUserParticipant(
        id: adaId, name: "Ada Lovelace", email: "ada@example.com", image: nil, presence: .offline
      )

      /// `rank` orders the rows: newer activity lists first.
      private static func room(
        _ name: String, rank: Int, kind: Components.Schemas.ChatRoom.KindPayload = .channel,
        listed: [ListedThread] = [], threadCount: Int? = nil, channel: Int = 0, muted: Bool = false, pinned: Bool = false
      ) -> Components.Schemas.ChatRoom {
        let id = "550e8400-e29b-41d4-a716-44665544090\(rank)"
        var room = Components.Schemas.ChatRoom(
          id: id, name: name, kind: kind, isSelfDirect: false, isGroupDirect: false,
          discoverability: kind == .channel ? .external : nil, createdByUserId: "ada", createdAt: lastWeek,
          updatedAt: lastWeek.addingTimeInterval(Double(-rank * 60)),
          unreadCount: channel + listed.reduce(0) { $0 + $1.replies }, channelUnreadCount: channel,
          threadUnreadCount: listed.reduce(0) { $0 + $1.replies }, unreadThreadCount: threadCount ?? listed.count,
          unreadThreads: listed.enumerated().map { index, thread in
            .init(parentMessageId: "\(id)-\(index)", firstUnreadReplyId: "\(id)-\(index)-reply", parentContent: thread.content,
                  unreadReplyCount: thread.replies, unreadMentionCount: thread.mentions)
          },
          unreadMentionCount: 0, mutedAt: muted ? lastWeek : nil, markedUnread: false, myAccess: .member,
          userMembers: kind == .direct ? [reader, ada] : [ada], coworkerMembers: [], sokoBotMembers: []
        )
        room.starredAt = pinned ? lastWeek.addingTimeInterval(Double(rank)) : nil
        return room
      }

      private static let designThreads = [
        ListedThread(content: "Release checklist", replies: 2),
        ListedThread(content: "@\(adaId):ada can you check the copy?", replies: 3, mentions: 1),
        ListedThread(content: "")
      ]

      /// External rooms show in every workspace kind. `threads: false` is the same sidebar with no Thread listed.
      private static func rooms(threads: Bool = true, launchListed: Bool = true) -> [Components.Schemas.ChatRoom] {
        [
          room("design", rank: 0, listed: threads ? designThreads : [], threadCount: threads ? 5 : 0, channel: 1),
          room("launch", rank: 1, listed: launchListed ? [ListedThread(content: "Muted parent", replies: 4)] : [], muted: true),
          room("general", rank: 2),
          room("ada", rank: 3, kind: .direct, listed: threads ? [ListedThread(content: "Standup notes", replies: 1)] : [])
        ]
      }

      private static func pinnedRooms(threads: Bool) -> [Components.Schemas.ChatRoom] {
        [
          // The counts stay and no Thread names the reader, so the Threads row above draws the same either way.
          room("design", rank: 0, listed: threads ? [ListedThread(content: "Release checklist", replies: 2), ListedThread(content: "Launch copy")] : [],
               threadCount: 5, pinned: true),
          room("support", rank: 1, listed: threads ? [ListedThread(content: "Pager rotation")] : [], threadCount: 1, pinned: true),
          room("general", rank: 2)
        ]
      }

      private static func render(
        _ rooms: [Components.Schemas.ChatRoom], dark: Bool, reordering: Bool = false, name: String? = nil
      ) async throws -> RenderedSidebar {
        let state = WorkspaceState()
        state.rooms = rooms
        state.selectedRoomId = rooms.first?.id
        if reordering {
          state.sidebar.setPinnedReorderMode(true)
          try #require(state.sidebar.pinnedReorderMode)
        }
        let size = NSRect(x: 0, y: 0, width: 280, height: 520)
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
        // One row is the List's selection: the open room's, never an inset Thread row.
        let selected = views(NSTableRowView.self, in: host).filter(\.isSelected)
        try #require(selected.count == 1, "One selected row, found \(selected.count).")
        let selection = selected[0].convert(selected[0].bounds, to: host)
        // As in `OpenRoomAttentionTests`: `cacheDisplay` cannot composite the selection material.
        selected.flatMap { views(NSVisualEffectView.self, in: $0) }.forEach { $0.isHidden = true }
        host.layoutSubtreeIfNeeded()
        let bitmap = try #require(host.bitmapImageRepForCachingDisplay(in: host.bounds))
        host.cacheDisplay(in: host.bounds, to: bitmap)
        if let name {
          try Attachment.record(#require(bitmap.representation(using: .png, properties: [:])), named: name)
        }
        return RenderedSidebar(bitmap: bitmap, selection: selection)
      }

      private static func views<V: NSView>(_ type: V.Type, in view: NSView) -> [V] {
        ((view as? V).map { [$0] } ?? []) + view.subviews.flatMap { views(type, in: $0) }
      }

      private static func differingBytes(_ lhs: NSBitmapImageRep, _ rhs: NSBitmapImageRep) throws -> Int {
        let left = try #require(lhs.bitmapData), right = try #require(rhs.bitmapData)
        let count = lhs.bytesPerRow * lhs.pixelsHigh
        try #require(count == rhs.bytesPerRow * rhs.pixelsHigh)
        return (0 ..< count).count { left[$0] != right[$0] }
      }

      /// `subject` looks like `reference`: it differs by no more than two renders of the reference differ, or
      /// than the 24g1 fixture's noise floor when those two match exactly.
      private static func expectSamePicture(
        _ subject: NSBitmapImageRep, _ reference: NSBitmapImageRep, _ referenceAgain: NSBitmapImageRep,
        sourceLocation: SourceLocation = #_sourceLocation
      ) throws {
        let difference = try differingBytes(subject, reference)
        let noise = try differingBytes(reference, referenceAgain)
        #expect(difference <= max(noise, SidebarRoomAttentionTests.pixelNoiseFloor), "\(difference) bytes differ; control pair \(noise)",
                sourceLocation: sourceLocation)
      }

      @Test(arguments: [false, true])
      func rendersTheInsetRows(dark: Bool) async throws {
        let rendered = try await Self.render(Self.rooms(), dark: dark, name: "sidebar-thread-rows-\(dark ? "dark" : "light").png")
        let bitmap = rendered.bitmap
        let footer = try #require(bitmap.colorAt(x: bitmap.pixelsWide - 40, y: bitmap.pixelsHigh - 30)?.usingColorSpace(.deviceRGB))
        #expect(footer.alphaComponent == 1, "Footer background alpha: \(footer.alphaComponent)")
        #expect(dark ? footer.brightnessComponent < 0.5 : footer.brightnessComponent > 0.5, "Footer brightness: \(footer.brightnessComponent)")
        let without = try await Self.render(Self.rooms(threads: false), dark: dark)
        // Four Thread rows and the overflow row are a large part of the picture.
        #expect(try Self.differingBytes(bitmap, without.bitmap) > 5000, "The inset rows draw.")
        #expect(rendered.selection.height == without.selection.height, "The room row holds the selection, not a Thread row.")
        #expect(abs(rendered.selection.minY - without.selection.minY) < 1, "Rows inset under the open room do not move it.")
        // Vision reads text only on a local run (the CI runner returns nil); pixels carry the other tests.
        guard let lines = try RoomThreadOverviewGroupsViewTests.recognizedText(in: bitmap) else { return }
        let texts = lines.map(\.text)
        func line(_ fragment: String) -> (text: String, box: CGRect)? {
          lines.first { $0.text.contains(fragment) }
        }
        let design = try #require(line("design"), "\(texts)")
        let release = try #require(line("Release checklist"), "\(texts)")
        let copy = try #require(line("Ada Lovelace can you"), "\(texts)")
        let more = try #require(line("2 more unread threads"), "\(texts)")
        let standup = try #require(line("Standup notes"), "\(texts)")
        // Vision's boxes run bottom-up: a lower row has a smaller midY.
        #expect(design.box.midY > release.box.midY && release.box.midY > copy.box.midY && copy.box.midY > more.box.midY, "\(texts)")
        #expect(more.box.midY > standup.box.midY, "Ada's Thread sits under Ada's row, below design's.")
        #expect(release.box.minX > design.box.minX, "The Thread rows are inset from their room's name.")
        // Vision reads a Thread's line with or without its mark, so the label column is where the line starts
        // or one mark and its gap further in. Measured 2026-09-24: 0.011 off that second reading on the right
        // column, 0.018 with the row 8 pt too far in.
        let markAndGap = (SidebarThreadRowLabel.markDiameter + 8) / 280
        let offset = more.box.minX - release.box.minX
        #expect(abs(offset) < 0.015 || abs(offset - markAndGap) < 0.015,
                "The overflow row starts on the Thread labels' column: \(more.box.minX) vs \(release.box.minX).")
        #expect(texts.contains { $0 == "Thread" || $0.hasSuffix(" Thread") }, "An empty parent reads Thread: \(texts)")
        #expect(!texts.contains { $0.contains("Muted parent") }, "A muted room lists no Thread: \(texts)")
      }

      /// Room mute outranks everything a room holds: a muted room with a listed Thread draws like one without.
      @Test(arguments: [false, true])
      func aMutedRoomDrawsNoInsetRows(dark: Bool) async throws {
        let listed = try await Self.render(Self.rooms(launchListed: true), dark: dark)
        let none = try await Self.render(Self.rooms(launchListed: false), dark: dark)
        let noneAgain = try await Self.render(Self.rooms(launchListed: false), dark: dark)
        try Self.expectSamePicture(listed.bitmap, none.bitmap, noneAgain.bitmap)
      }

      /// Pinned reorder mode keeps every row one height: the pinned rooms' Threads are not listed.
      @Test(arguments: [false, true])
      func reorderModeDrawsNoInsetRows(dark: Bool) async throws {
        let listed = try await Self.render(Self.pinnedRooms(threads: true), dark: dark, reordering: true)
        let none = try await Self.render(Self.pinnedRooms(threads: false), dark: dark, reordering: true)
        let noneAgain = try await Self.render(Self.pinnedRooms(threads: false), dark: dark, reordering: true)
        try Self.expectSamePicture(listed.bitmap, none.bitmap, noneAgain.bitmap)
        let resting = try await Self.render(Self.pinnedRooms(threads: true), dark: dark)
        let restingNone = try await Self.render(Self.pinnedRooms(threads: false), dark: dark)
        #expect(try Self.differingBytes(resting.bitmap, restingNone.bitmap) > 5000, "Out of reorder mode the pinned rooms list their Threads.")
      }
    }
  }

  /// One of a fixture room's listed unread Threads.
  private struct ListedThread {
    let content: String
    var replies = 1
    var mentions = 0
  }

  private struct RenderedSidebar {
    let bitmap: NSBitmapImageRep
    /// The selected row's frame in the hosting view.
    let selection: CGRect
  }
#endif
