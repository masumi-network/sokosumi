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
    /// Row 25c (web `performRoomSearchJump`): a jump that lands on a Thread reply also puts the room on the
    /// Thread's parent and marks it there, on its own clock started with the jump. On the Mac the Thread is pushed over the room, so
    /// the parent's mark shows when the reader closes the Thread inside the hold, with what is left of it.
    @MainActor struct ThreadParentMarkTests {
      /// Mid-transcript, so the room has to move off the newest message to show it.
      private static let parentId = "fixture-40"
      private static let replyId = "reply-12"

      /// The room's detail pane as the app composes it, the room loaded at its newest message.
      private static func hostedRoom(dark: Bool, clock: any JumpMarkClock = SystemJumpMarkClock()) async throws -> JumpLanding {
        let state = try TranscriptScrollingTests.fixtureState(thread: false, media: false)
        let room = Components.Schemas.ChatRoom(id: "fixture", name: "General", kind: .channel, isSelfDirect: false, isGroupDirect: false, isReadOnly: false,
                                               createdByUserId: "person", createdAt: .now, updatedAt: .now, unreadCount: 0,
                                               unreadMentionCount: 0, markedUnread: false, myAccess: .init(value1: .member, value2: "member"),
                                               userMembers: [], formerUserMembers: [], coworkerMembers: [], sokoBotMembers: [])
        let auth = AuthState()
        let host = NSHostingView(rootView: AnyView(RoomNavigationStack(room: room)
            .background(.background)
            .overlay { JumpMarkViewTests.hoverBlocker }
            .environment(\.jumpMarkClock, clock)
            .environmentObject(state).environmentObject(auth)))
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 900, height: 700), styleMask: [.titled], backing: .buffered, defer: false)
        window.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
        window.ignoresMouseEvents = true
        window.contentView = host
        try JumpMarkViewTests.keepPointerOff(window)
        window.orderFront(nil)
        let scroll = try await loadedTranscriptScrollView(in: host)
        #expect(TranscriptScrollingTests.distanceFromBottom(scroll) < 40, "The room opens at its newest message.")
        return JumpLanding(state: state, host: host, window: window, scroll: scroll, diagnosis: JumpDiagnosis(state: state, host: host, scroll: scroll))
      }

      /// Opens the parent's Thread over the room with its replies loaded, then jumps to one as a search hit does
      /// (`openMessageReply`, which loads nothing here). Returns once the Thread has landed on the reply and the
      /// room has marked the parent behind it.
      private static func jumpToReply(_ state: WorkspaceState, host: NSView) async throws {
        let parent = try #require(state.timeline.messages.first { $0.id == Self.parentId })
        state.thread.open(parent)
        state.thread.timeline.failInitialLoad(message: "", generation: state.thread.timeline.generation)
        state.thread.timeline.messages = (0 ..< 30).map { index in
          var reply = state.timeline.messages[index + 50]
          reply.id = "reply-\(index)"
          reply.parentMessageId = parent.id
          return reply
        }
        let hit = try #require(state.thread.timeline.messages.first { $0.id == Self.replyId })
        #expect(try await state.openMessageReply(hit, auth: AuthState()) == .opened)
        try await JumpMarkViewTests.poll(host) { state.thread.jumpTarget?.mark != nil && state.messageJump == nil }
        #expect(state.thread.jumpTarget?.mark?.messageId == Self.replyId, "The Thread landed on the reply.")
        #expect(state.messageJump == nil, "The room took the parent's jump.")
      }

      /// Moves the clock on until the room marks the parent again: a room jump marks once it lands, and a mark
      /// opens over its first tenth.
      private static func advanceUntilMarked(_ clock: ManualJumpMarkClock, host: NSView, scroll: NSScrollView) async throws {
        try await JumpMarkViewTests.poll(host) {
          clock.advance(by: 0.05)
          return try JumpMarkViewTests.markedRows(in: host, scroll: scroll, column: 6) > 40
        }
      }

      /// The room's scroll offset once it has held still for five polls.
      private static func settledOffset(of scroll: NSScrollView, host: NSView) async throws -> CGFloat {
        var offsets: [CGFloat] = []
        try await JumpMarkViewTests.poll(host) {
          offsets.append(scroll.contentView.bounds.minY)
          return offsets.count >= 5 && Set(offsets.suffix(5)).count == 1
        }
        return scroll.contentView.bounds.minY
      }

      /// The Thread lands on the reply; 2.5 s later, inside the hold, the reader closes it. The room is on the
      /// parent, marked, where a room jump to it would centre it, and the mark ends 4.5 s after the jump,
      /// not after the close. The mark runs on a clock the test moves, so a slow runner cannot outlive the hold.
      @Test(arguments: [false, true])
      func closingTheThreadInsideTheHoldShowsTheParentsMark(dark: Bool) async throws {
        let clock = ManualJumpMarkClock()
        let room = try await Self.hostedRoom(dark: dark, clock: clock)
        let (state, host) = (room.state, room.host)
        defer { room.window.orderOut(nil) }
        try await Self.jumpToReply(state, host: host)
        clock.move(to: 2.5)
        state.thread.close()

        let scroll = try await loadedTranscriptScrollView(in: host)
        var marked = 0
        try await JumpMarkViewTests.poll(host) {
          marked = try JumpMarkViewTests.markedRows(in: host, scroll: scroll, column: 6)
          return marked > 40
        }
        #expect(marked > 40, "The parent is marked once the Thread closes inside the hold.")
        #expect(TranscriptScrollingTests.distanceFromBottom(scroll) > 400, "The room moved off its newest message to the parent.")
        let landed = try await Self.settledOffset(of: scroll, host: host)
        #expect(try JumpMarkViewTests.markedRows(in: host, scroll: scroll, column: 6) > 40, "Still marked once the room has settled on the parent.")

        host.layoutSubtreeIfNeeded()
        let bitmap = try #require(host.bitmapImageRepForCachingDisplay(in: host.bounds))
        host.cacheDisplay(in: host.bounds, to: bitmap)
        try Attachment.record(#require(bitmap.representation(using: .png, properties: [:])), named: "thread-parent-mark-\(dark ? "dark" : "light").png")
        let corner = try #require(bitmap.colorAt(x: 2, y: bitmap.pixelsHigh - 2)?.usingColorSpace(.deviceRGB))
        #expect(corner.alphaComponent == 1, "Hosted over the window background: alpha \(corner.alphaComponent)")

        // A mark started at the close would hold to 2.5 + 4.5 s and still be at full strength here; one started
        // with the jump has ended.
        clock.move(to: JumpMark.hold + 0.1)
        try await JumpMarkViewTests.poll(host) { try JumpMarkViewTests.markedRows(in: host, scroll: scroll, column: 6) == 0 }
        #expect(try JumpMarkViewTests.markedRows(in: host, scroll: scroll, column: 6) == 0, "On the jump's clock: gone 4.6 s after the jump.")

        // Centred where a room jump to the parent centres it: that jump barely moves the room.
        #expect(try await state.openMessage(Self.parentId, auth: AuthState()) == .opened)
        try await Self.advanceUntilMarked(clock, host: host, scroll: scroll)
        let centred = try await Self.settledOffset(of: scroll, host: host)
        #expect(abs(centred - landed) < 40, "Already centred on the parent: a jump to it moved the room from \(landed) to \(centred).")
      }

      /// Closed after the hold, the Thread leaves the room on the parent with no mark. A room jump to the parent
      /// then barely moves it, because it is already centred there.
      @Test func closingTheThreadAfterTheHoldLeavesTheRoomOnTheParent() async throws {
        let clock = ManualJumpMarkClock()
        let room = try await Self.hostedRoom(dark: false, clock: clock)
        let (state, host) = (room.state, room.host)
        defer { room.window.orderOut(nil) }
        try await Self.jumpToReply(state, host: host)
        clock.move(to: JumpMark.hold + 0.5)
        state.thread.close()

        let scroll = try await loadedTranscriptScrollView(in: host)
        let settled = Date().addingTimeInterval(0.5)
        try await JumpMarkViewTests.poll(host) { Date() >= settled }
        #expect(try JumpMarkViewTests.markedRows(in: host, scroll: scroll, column: 6) == 0, "The hold ran out behind the Thread.")
        #expect(TranscriptScrollingTests.distanceFromBottom(scroll) > 400, "The room moved off its newest message to the parent.")
        let closed = try await Self.settledOffset(of: scroll, host: host)
        let diagnosis = JumpDiagnosis(state: state, host: host, scroll: scroll)
        diagnosis.snap("closed")

        #expect(try await state.openMessage(Self.parentId, auth: AuthState()) == .opened)
        try await Self.advanceUntilMarked(clock, host: host, scroll: scroll)
        let centred = try await Self.settledOffset(of: scroll, host: host)
        #expect(abs(centred - closed) < 40, "Already on the parent: a jump to it moved the room from \(closed) to \(centred).")
        if abs(centred - closed) >= 40 {
          diagnosis.attach("centred")
        }
      }

      /// A parent that left the room's loaded rows before the Thread closed cannot be landed on, and is forgotten:
      /// when it is loaded again and another Thread opens and closes, the room stays at its newest message
      /// (Grok's review of #5710).
      @Test func aParentThatCannotBeLandedIsForgotten() async throws {
        let room = try await Self.hostedRoom(dark: false)
        let (state, host) = (room.state, room.host)
        defer { room.window.orderOut(nil) }
        try await Self.jumpToReply(state, host: host)
        let parent = try #require(state.timeline.messages.first { $0.id == Self.parentId })
        let loaded = state.timeline.messages
        state.timeline.messages = loaded.filter { $0.id != Self.parentId }
        state.thread.close()

        let scroll = try await loadedTranscriptScrollView(in: host)
        var settled = Date().addingTimeInterval(0.5)
        try await JumpMarkViewTests.poll(host) { Date() >= settled }
        #expect(TranscriptScrollingTests.distanceFromBottom(scroll) < 40, "Nothing to land on: the room stays at its newest message.")

        state.timeline.messages = loaded
        let other = try #require(state.timeline.messages.first { $0.id == "fixture-60" })
        state.thread.open(other)
        state.thread.timeline.failInitialLoad(message: "", generation: state.thread.timeline.generation)
        settled = Date().addingTimeInterval(0.5)
        try await JumpMarkViewTests.poll(host) { Date() >= settled }
        state.thread.close()
        settled = Date().addingTimeInterval(1)
        try await JumpMarkViewTests.poll(host) { Date() >= settled }
        let roomScroll = try await loadedTranscriptScrollView(in: host)
        // The old parent is some sixty rows up, thousands of points from the bottom; re-adding it above the
        // viewport may shift the offset by its own height.
        #expect(TranscriptScrollingTests.distanceFromBottom(roomScroll) < 1000,
                "The room did not move to the old parent \(parent.id): \(TranscriptScrollingTests.distanceFromBottom(roomScroll)) pt from the bottom.")
      }
    }
  }
#endif
