import CoreAPI
import Foundation
import HTTPTypes
import OpenAPIRuntime
import SokosumiChat
import Testing

/// Row 24f2: the sidebar's Unreads filter, as web's `organization-chat-list.client.tsx` lists it
/// (`unread-filter-pass.test.ts`, `organization-chat-list-unread-filter.test.tsx`, `roomUnreadReads` in
/// `room-attention.ts`, Mark all in `chat-unread-nav-rows.tsx` and `markAllUnreadRead` in `chat-room.service.ts`).
struct UnreadsFilterTests {
  private static let fixedDate = Date(timeIntervalSince1970: 1_790_000_000)

  /// `age` in minutes: a smaller age is newer activity.
  private static func room(
    _ name: String, age: Int, channel: Int = 0, threads: Int? = 0, listed: Int = 0, mentions: Int = 0, marked: Bool = false,
    muted: Bool = false, pinnedAt: Int? = nil
  ) -> Components.Schemas.ChatRoom {
    .init(
      id: "room-\(name)", name: name, kind: .channel, isSelfDirect: false, isGroupDirect: false, discoverability: ._public,
      createdByUserId: "user_1", createdAt: fixedDate, updatedAt: fixedDate.addingTimeInterval(Double(-age * 60)),
      unreadCount: channel + (threads ?? listed), channelUnreadCount: channel, threadUnreadCount: threads ?? listed,
      unreadThreadCount: threads, unreadThreads: (0 ..< listed).map {
        .init(parentMessageId: "\(name)-parent-\($0)", firstUnreadReplyId: "\(name)-reply-\($0)", parentContent: "Parent",
              unreadReplyCount: 1, unreadMentionCount: 0)
      },
      unreadMentionCount: mentions, starredAt: pinnedAt.map { fixedDate.addingTimeInterval(Double($0)) },
      mutedAt: muted ? fixedDate : nil, markedUnread: marked, myAccess: .member, userMembers: [], coworkerMembers: [], sokoBotMembers: []
    )
  }

  private static func read(_ room: Components.Schemas.ChatRoom) -> Components.Schemas.ChatRoom {
    var room = room
    room.unreadCount = 0
    room.channelUnreadCount = 0
    room.threadUnreadCount = 0
    room.unreadThreadCount = 0
    room.unreadThreads = []
    room.unreadMentionCount = 0
    room.markedUnread = false
    return room
  }

  private static func list(
    _ rooms: [Components.Schemas.ChatRoom], after pass: UnreadsFilterPass = .init(), open: String? = nil, invitation: Bool = false
  ) -> UnreadsFilterList {
    unreadsFilterList(rooms: rooms, pass: pass, activeRoomId: open, hasPendingInvitation: invitation)
  }

  // MARK: What a room still needs (`roomUnreadReads`)

  @Test func aRoomNeedsTheReadsItsRowAndThreadsAsk() {
    #expect(roomUnreadReads(Self.room("a", age: 0, channel: 2)) == .init(roomId: "room-a", readRoom: true, lookThreads: false))
    #expect(roomUnreadReads(Self.room("b", age: 0, threads: 1)) == .init(roomId: "room-b", readRoom: false, lookThreads: true),
            "Thread replies alone leave the row quiet (ADR 0037) but still need a Look.")
    #expect(roomUnreadReads(Self.room("c", age: 0, channel: 1, threads: 2)) == .init(roomId: "room-c", readRoom: true, lookThreads: true))
    #expect(roomUnreadReads(Self.room("d", age: 0, threads: 1, mentions: 1)).readRoom, "A Thread mention bolds the row, so the room is read.")
    #expect(roomUnreadReads(Self.room("e", age: 0, marked: true)).readRoom, "A hand-set mark bolds the row.")
    #expect(roomUnreadReads(Self.room("f", age: 0, threads: nil, listed: 2)).lookThreads, "An older summary falls back to the listed Threads.")
    #expect(!roomUnreadReads(Self.room("g", age: 0, channel: 3, threads: 2, mentions: 1, muted: true)).isNeeded, "A muted room needs nothing.")
    #expect(!roomUnreadReads(Self.room("h", age: 0)).isNeeded)
  }

  @Test func markAllTargetsEveryRoomAReadWouldChange() {
    let targets = unreadsMarkAllTargets([
      Self.room("launch", age: 0, channel: 1), Self.room("general", age: 1), Self.room("design", age: 2, threads: 1),
      Self.room("ops", age: 3, channel: 4, muted: true), Self.room("support", age: 4, channel: 1, pinnedAt: 0)
    ])
    #expect(targets.map(\.roomId) == ["room-launch", "room-design", "room-support"], "Pinned rooms are read too; muted and read ones are not.")
  }

  // MARK: The pass (`advanceUnreadFilterPass`)

  private static func advance(_ steps: [[String]]) -> UnreadsFilterPass {
    steps.reduce(UnreadsFilterPass()) { $0.advanced(unreadIds: $1) }
  }

  @Test func thePassListsTheFirstUnreadRoomsInTheOrderTheyCame() {
    #expect(Self.advance([["launch", "design"]]).seen == ["launch", "design"])
  }

  @Test func aRoomKeepsItsPlaceOnceRead() {
    #expect(Self.advance([["launch", "design", "ada"], ["launch", "ada"], []]).seen == ["launch", "design", "ada"])
  }

  @Test func aRoomThatTurnsUnreadLaterGoesOnTop() {
    #expect(Self.advance([["launch", "design"], ["release", "design"]]).seen == ["release", "launch", "design"])
  }

  @Test func thePassNeverListsARoomThatWasNotUnread() {
    #expect(Self.advance([[], []]).seen.isEmpty)
  }

  @Test func aRoomThatTurnsUnreadAgainDoesNotMove() {
    #expect(Self.advance([["launch", "design"], ["launch"], ["design"]]).seen == ["launch", "design"])
  }

  // MARK: The list

  @Test func listsEveryUnpinnedRoomAReadWouldChangeNewestFirst() {
    let rooms = [
      Self.room("general", age: 0), Self.room("design", age: 2, threads: 1), Self.room("launch", age: 1, channel: 3),
      Self.room("ops", age: 3, channel: 2, muted: true), Self.room("support", age: 4, channel: 1, pinnedAt: 1),
      Self.room("wiki", age: 5, pinnedAt: 0)
    ]
    let list = Self.list(rooms)
    #expect(list.rooms.map(\.name) == ["launch", "design"], "Thread unread counts; muted and read rooms do not; pins stay in Pinned.")
    #expect(list.pinned.map(\.name) == ["wiki", "support"], "Pinned holds every pin in the reader's own order.")
    #expect(list.pass.seen == ["room-launch", "room-design"])
    #expect(!list.isDimmed("room-support") && list.isDimmed("room-wiki"), "An unread pin stands at full; a read one dims.")
    #expect(!list.caughtUp && !list.showsReadLabel)
    #expect(list.markAllTargets.map(\.roomId) == ["room-design", "room-launch", "room-support"], "In the rooms' own order.")
  }

  @Test func equalActivityOrdersById() {
    let list = Self.list([Self.room("b", age: 0, channel: 1), Self.room("a", age: 0, channel: 1)])
    #expect(list.rooms.map(\.name) == ["a", "b"])
  }

  @Test func aRoomReadDuringThePassStaysInItsPlaceDimmed() {
    let launch = Self.room("launch", age: 0, channel: 1), design = Self.room("design", age: 1, channel: 1)
    let first = Self.list([launch, design])
    let later = Self.list([Self.read(launch), design], after: first.pass)
    #expect(later.rooms.map(\.name) == ["launch", "design"])
    #expect(later.isDimmed("room-launch") && !later.isDimmed("room-design"))
    #expect(later.pass == first.pass, "Nothing arrived, so the pass is the same.")
    let arrived = Self.list([Self.read(launch), design, Self.room("release", age: 2, channel: 1)], after: later.pass)
    #expect(arrived.rooms.map(\.name) == ["release", "launch", "design"], "A room turning unread later goes on top.")
  }

  @Test func theOpenRoomIsListedAndNeverDimmed() {
    let launch = Self.room("launch", age: 0, channel: 1), general = Self.room("general", age: 1)
    let list = Self.list([launch, general], open: "room-general")
    #expect(list.rooms.map(\.name) == ["launch", "general"], "The open room is listed while it is open, read or not.")
    #expect(!list.isDimmed("room-general"))
    let first = Self.list([launch, general])
    let readOpen = Self.list([Self.read(launch), general], after: first.pass, open: "room-launch")
    #expect(!readOpen.isDimmed("room-launch"), "Dimmed, the open room's highlight would read as disabled.")
    #expect(readOpen.caughtUp && readOpen.showsReadLabel, "Caught up with only the open room left.")
  }

  @Test func caughtUpLeadsThenReadJustNowThenPinned() {
    let launch = Self.room("launch", age: 0, channel: 1), support = Self.room("support", age: 1, pinnedAt: 0)
    let first = Self.list([launch, support])
    let list = Self.list([Self.read(launch), support], after: first.pass)
    #expect(list.caughtUp && list.showsReadLabel)
    #expect(list.rooms.map(\.name) == ["launch"] && list.isDimmed("room-launch"))
    #expect(list.pinned.map(\.name) == ["support"] && list.isDimmed("room-support"))
    #expect(list.markAllTargets.isEmpty, "Nothing is left for Mark all.")
  }

  @Test func caughtUpWithOnlyPinnedRoomsSaysNoReadJustNow() {
    let list = Self.list([Self.room("support", age: 0, pinnedAt: 0), Self.room("general", age: 1)])
    #expect(list.caughtUp && !list.showsReadLabel && list.rooms.isEmpty && list.pinned.count == 1)
  }

  @Test func aPinnedRoomAloneKeepsTheReaderFromBeingCaughtUp() {
    let list = Self.list([Self.room("support", age: 0, channel: 1, pinnedAt: 0)])
    #expect(!list.caughtUp && list.rooms.isEmpty)
  }

  @Test func aPendingInvitationKeepsTheReaderFromBeingCaughtUp() {
    #expect(!Self.list([Self.room("general", age: 0)], invitation: true).caughtUp)
  }

  @Test func aRoomPinnedDuringThePassLeavesTheListAndComesBackInItsPlace() {
    let launch = Self.room("launch", age: 0, channel: 1), design = Self.room("design", age: 1, channel: 1)
    let first = Self.list([launch, design])
    var pinned = design
    pinned.starredAt = Self.fixedDate
    let whilePinned = Self.list([launch, pinned], after: first.pass)
    #expect(whilePinned.rooms.map(\.name) == ["launch"] && whilePinned.pinned.map(\.name) == ["design"])
    let unpinned = Self.list([Self.room("release", age: 2, channel: 1), launch, design], after: whilePinned.pass)
    #expect(unpinned.rooms.map(\.name) == ["release", "launch", "design"], "Unpinning puts it back where it was.")
  }

  // MARK: The sidebar's filter

  @MainActor @Test func theFilterIsRememberedPerInstallAndStartsOff() throws {
    let suite = "sokosumi-unreads-filter-tests.\(UUID().uuidString)"
    let defaults = try #require(UserDefaults(suiteName: suite))
    defer { defaults.removePersistentDomain(forName: suite) }
    let first = ConversationSidebar(unreadsFilter: .init(defaults: defaults))
    #expect(!first.unreadsFilterOn)
    first.setUnreadsFilter(true)
    #expect(first.unreadsFilterOn)
    #expect(ConversationSidebar(unreadsFilter: .init(defaults: defaults)).unreadsFilterOn, "A new launch opens on the filter.")
    first.setUnreadsFilter(false)
    #expect(!ConversationSidebar(unreadsFilter: .init(defaults: defaults)).unreadsFilterOn)
    let transient = ConversationSidebar()
    transient.setUnreadsFilter(true)
    #expect(transient.unreadsFilterOn && !ConversationSidebar().unreadsFilterOn, "Tests and previews remember nothing.")
  }

  @MainActor @Test func switchingTheFilterOffEndsThePass() throws {
    let sidebar = ConversationSidebar()
    sidebar.rooms = [Self.room("launch", age: 0, channel: 1), Self.room("design", age: 1, channel: 1)]
    #expect(sidebar.unreadsFilter(activeRoomId: nil, hasPendingInvitation: false) == nil, "Off, there is no list.")
    sidebar.setUnreadsFilter(true)
    let list = try #require(sidebar.unreadsFilter(activeRoomId: nil, hasPendingInvitation: false))
    sidebar.keepUnreadsFilterPass(list.pass)
    #expect(sidebar.unreadsFilterPass.seen == ["room-launch", "room-design"])
    sidebar.rooms = [Self.read(sidebar.rooms[0]), sidebar.rooms[1]]
    #expect(sidebar.unreadsFilter(activeRoomId: nil, hasPendingInvitation: false)?.rooms.map(\.name) == ["launch", "design"])
    sidebar.setUnreadsFilter(false)
    #expect(sidebar.unreadsFilterPass.seen.isEmpty)
    sidebar.keepUnreadsFilterPass(list.pass)
    #expect(sidebar.unreadsFilterPass.seen.isEmpty, "A late keep does not bring a finished pass back.")
    sidebar.setUnreadsFilter(true)
    #expect(sidebar.unreadsFilter(activeRoomId: nil, hasPendingInvitation: false)?.rooms.map(\.name) == ["design"],
            "A new pass lists only what is unread now.")
  }

  /// Web's `canReorderPinned` is false under the filter: its Pinned group is fixed, and reordering lives on the
  /// full section's header, which the filter replaces.
  @MainActor @Test func theFilterEndsPinnedReorderMode() {
    let sidebar = ConversationSidebar()
    sidebar.rooms = [Self.room("a", age: 0, pinnedAt: 0), Self.room("b", age: 1, pinnedAt: 1)]
    sidebar.setPinnedReorderMode(true)
    #expect(sidebar.pinnedReorderMode)
    sidebar.setUnreadsFilter(true)
    #expect(!sidebar.pinnedReorderMode && !sidebar.canReorderPinned)
    sidebar.setUnreadsFilter(false)
    #expect(sidebar.canReorderPinned && !sidebar.pinnedReorderMode, "Off, the mode does not come back by itself.")
  }

  @MainActor @Test func aWorkspaceChangeEndsThePassAndKeepsTheFilter() throws {
    let sidebar = ConversationSidebar()
    sidebar.rooms = [Self.room("launch", age: 0, channel: 1)]
    sidebar.setUnreadsFilter(true)
    try sidebar.keepUnreadsFilterPass(#require(sidebar.unreadsFilter(activeRoomId: nil, hasPendingInvitation: false)).pass)
    sidebar.dropPendingActions()
    #expect(sidebar.unreadsFilterPass.seen.isEmpty && sidebar.unreadsFilterOn)
    try sidebar.keepUnreadsFilterPass(#require(sidebar.unreadsFilter(activeRoomId: nil, hasPendingInvitation: false)).pass)
    sidebar.reset()
    #expect(sidebar.unreadsFilterPass.seen.isEmpty && sidebar.unreadsFilterOn, "Signing out keeps the reader's choice, as web's cookie does.")
  }

  @MainActor @Test func theListReadsTheRoomsWithTheirReadOverlay() async throws {
    let sidebar = ConversationSidebar()
    let launch = Self.room("launch", age: 0, channel: 1)
    sidebar.rooms = [launch]
    sidebar.readAttention.setVisible(true, window: UUID())
    sidebar.setUnreadsFilter(true)
    try sidebar.keepUnreadsFilterPass(#require(sidebar.unreadsFilter(activeRoomId: nil, hasPendingInvitation: false)).pass)
    let transport = MarkAllTransport(failing: [])
    _ = try await sidebar.readAttention.readIfNeeded(room: launch, content: .init(messages: []), historyReadable: true,
                                                     client: makeMarkAllClient(transport), organizationSlug: nil)
    let list = try #require(sidebar.unreadsFilter(activeRoomId: nil, hasPendingInvitation: false))
    #expect(list.isDimmed("room-launch") && list.caughtUp, "A read the row already shows dims the room at once.")
  }

  // MARK: Mark all as read

  @MainActor @Test func markAllRunsEachRoomsReadsAtOnce() async throws {
    let sidebar = ConversationSidebar()
    sidebar.rooms = [
      Self.room("launch", age: 0, channel: 2, threads: 1), Self.room("design", age: 1, threads: 2),
      Self.room("support", age: 2, mentions: 1), Self.room("ops", age: 3, channel: 5, muted: true), Self.room("general", age: 4)
    ]
    sidebar.readAttention.setVisible(true, window: UUID())
    let transport = MarkAllTransport(failing: [])
    #expect(try await sidebar.markAllUnreadRead(client: makeMarkAllClient(transport), organizationSlug: "acme"))
    let calls = await transport.calls
    #expect(Set(calls) == ["read room-launch", "threads room-launch", "threads room-design", "read room-support"])
    #expect(await transport.slugs.allSatisfy { $0 == "acme" })
    #expect(await transport.maxInFlight > 1, "The reads run at once, as web's `Promise.allSettled`.")
    let launch = try #require(sidebar.readAttention.applying(to: sidebar.rooms).first)
    #expect(!resolveRoomAttention(launch).bold, "A room read settles its row on Core's answer.")
    #expect(!sidebar.isMarkingAllUnreadRead && sidebar.actionError == nil)
  }

  @MainActor @Test func markAllRunsEveryReadThenSaysItFailed() async throws {
    let sidebar = ConversationSidebar()
    sidebar.rooms = [Self.room("launch", age: 0, channel: 1), Self.room("design", age: 1, threads: 1), Self.room("support", age: 2, channel: 1)]
    sidebar.readAttention.setVisible(true, window: UUID())
    let transport = MarkAllTransport(failing: ["read room-launch"])
    await #expect(throws: (any Error).self) {
      try await sidebar.markAllUnreadRead(client: makeMarkAllClient(transport), organizationSlug: nil)
    }
    #expect(await Set(transport.calls) == ["read room-launch", "threads room-design", "read room-support"], "Every read runs.")
    #expect(sidebar.actionError == "Could not mark everything as read.")
    #expect(!sidebar.isMarkingAllUnreadRead)
    let rooms = sidebar.readAttention.applying(to: sidebar.rooms)
    #expect(resolveRoomAttention(rooms[0]).bold && !resolveRoomAttention(rooms[2]).bold, "The failed room keeps its row; the rest settle.")
  }

  @MainActor @Test func markAllWithNothingUnreadAsksNothing() async throws {
    let sidebar = ConversationSidebar()
    sidebar.rooms = [Self.room("general", age: 0), Self.room("ops", age: 1, channel: 2, muted: true)]
    sidebar.readAttention.setVisible(true, window: UUID())
    let transport = MarkAllTransport(failing: [])
    #expect(try await !sidebar.markAllUnreadRead(client: makeMarkAllClient(transport), organizationSlug: nil))
    #expect(await transport.calls.isEmpty)
  }
}

/// Answers a room read with that room read and a thread Mark all with one marked Thread, by path, so reads that
/// run at once each get their own answer. Paths in `failing` answer 500.
private actor MarkAllTransport: ClientTransport {
  private let failing: Set<String>
  private(set) var calls: [String] = []
  private(set) var slugs: [String?] = []
  private(set) var maxInFlight = 0
  private var inFlight = 0

  init(failing: Set<String>) {
    self.failing = failing
  }

  func send(_ request: HTTPRequest, body _: HTTPBody?, baseURL _: URL, operationID _: String) async throws -> (HTTPResponse, HTTPBody?) {
    let parts = (request.path ?? "").split(separator: "/").map(String.init)
    let roomId = parts.first { $0.hasPrefix("room-") } ?? ""
    let call = parts.last == "read" && parts.dropLast().last == "threads" ? "threads \(roomId)" : "read \(roomId)"
    calls.append(call)
    slugs.append(HTTPField.Name("X-Organization-Slug").flatMap { request.headerFields[$0] })
    inFlight += 1
    maxInFlight = max(maxInFlight, inFlight)
    // Let the other reads start before this one answers.
    for _ in 0 ..< 20 {
      await Task.yield()
    }
    inFlight -= 1
    if failing.contains(call) {
      return (HTTPResponse(status: .internalServerError), HTTPBody(#"{"error":"Internal","message":"Boom","meta":{"timestamp":"\#(testTimestamp)","requestId":"req-1","path":"/","method":"POST"}}"#))
    }
    if call.hasPrefix("threads") {
      return (HTTPResponse(status: .ok), HTTPBody(#"{"data":{"markedCount":1},"meta":{"timestamp":"\#(testTimestamp)","requestId":"req-1"}}"#))
    }
    let room = testAttentionRoomJSON(unread: 0).replacingOccurrences(of: testRoomId, with: roomId)
      .replacingOccurrences(of: "\"unreadMentionCount\":1", with: "\"unreadMentionCount\":0")
    return (HTTPResponse(status: .ok), HTTPBody(#"{"data":\#(room),"meta":{"timestamp":"\#(testTimestamp)","requestId":"req-1"}}"#))
  }
}

private func makeMarkAllClient(_ transport: MarkAllTransport) throws -> Client {
  try Client.connecting(to: #require(URL(string: "https://core.example/v1")), transport: transport)
}
