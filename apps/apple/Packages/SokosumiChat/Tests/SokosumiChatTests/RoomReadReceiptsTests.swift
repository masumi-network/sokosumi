import CoreAPI
import Foundation
import SokosumiChat
import Testing

private let viewer = "user-viewer"
private let roomId = "room-1"
private let newest = "message-newest"
private let origin = Date(timeIntervalSince1970: 1_800_000_000)

private func at(_ minutes: Double) -> Date {
  origin.addingTimeInterval(minutes * 60)
}

private func member(_ id: String, _ lastReadAt: Date?) -> Components.Schemas.ChatRoomUserParticipant {
  .init(id: id, name: id, email: "\(id)@example.com", image: nil, presence: .offline, lastReadAt: lastReadAt)
}

private func room(
  _ members: [Components.Schemas.ChatRoomUserParticipant], id: String = roomId,
  kind: Components.Schemas.ChatRoom.KindPayload = .channel, access: Components.Schemas.ChatRoomAccess = .member
) throws -> Components.Schemas.ChatRoom {
  try .init(
    id: id, organizationId: "org", name: "Team", slug: "team", kind: kind, isSelfDirect: false, isGroupDirect: kind == .direct, isReadOnly: false,
    topic: nil, discoverability: nil, createdByUserId: viewer, createdAt: .distantPast, updatedAt: .distantPast,
    unreadCount: 0, unreadMentionCount: 0, markedUnread: false, myAccess: .init(value1: access, value2: .init(stringLiteral: access.rawValue)), userMembers: members,
    formerUserMembers: [], coworkerMembers: [.init(id: "agent", name: "Agent", slug: "agent", caption: nil, image: nil, presence: .online)],
    sokoBotMembers: [.init(id: "bot", name: "Assistant", caption: nil, ownerUserId: "me", presence: .offline)]
  )
}

private func receipts(
  _ members: [Components.Schemas.ChatRoomUserParticipant], live: [String: Date] = [:],
  access: Components.Schemas.ChatRoomAccess = .member
) throws -> RoomReadReceipts {
  try RoomReadReceipts(room: room(members, access: access), currentUserId: viewer, liveReads: live)
}

private func ids(_ readers: [RoomReader]) -> [String] {
  readers.map(\.participant.id)
}

/// Row 31b1: web's `useRoomReadReceipts`, `seenByReadersFor` and `seenByPendingFor`, fixed ids and times.
struct RoomReadReceiptsTests {
  @Test func seedsReadersFromThePayloadMostRecentFirst() throws {
    let receipts = try receipts([member("user-a", at(0)), member("user-b", at(120)), member("user-c", nil)])
    #expect(ids(receipts.readers) == ["user-b", "user-a"])
    #expect(receipts.nonReaders.map(\.id) == ["user-c"])
  }

  /// Posting advances the sender's own mark, so keeping the viewer would add one to every count.
  @Test func leavesTheViewerOutOfBothLists() throws {
    let receipts = try receipts([member(viewer, at(180)), member("user-a", nil)])
    #expect(receipts.readers.isEmpty)
    #expect(receipts.nonReaders.map(\.id) == ["user-a"])
  }

  /// Receipts count people: Coworkers and Soko Bots are not on `userMembers`, so they are on neither list.
  @Test func countsPeopleOnly() throws {
    let receipts = try receipts([member("user-a", at(0))])
    #expect(ids(receipts.readers) == ["user-a"])
    #expect(receipts.nonReaders.isEmpty)
  }

  @Test func aLiveMarkMovesAMemberFromNotReadToRead() throws {
    let receipts = try receipts([member("user-a", nil)], live: ["user-a": at(0)])
    #expect(ids(receipts.readers) == ["user-a"])
    #expect(receipts.nonReaders.isEmpty)
  }

  /// The payload is the floor and the live marks the ceiling; whichever is later wins.
  @Test func theLaterOfPayloadAndLiveMarkWins() throws {
    let fresher = try receipts([member("user-a", at(0))], live: ["user-a": at(120)])
    #expect(fresher.readers.first?.lastReadAt == at(120))
    let staleLive = try receipts([member("user-a", at(120))], live: ["user-a": at(0)])
    #expect(staleLive.readers.first?.lastReadAt == at(120))
  }

  @Test func aLiveMarkForSomeoneOffTheRosterShowsNobody() throws {
    let receipts = try receipts([member("user-a", nil)], live: ["user-stranger": at(0)])
    #expect(receipts.readers.isEmpty)
    #expect(receipts.nonReaders.map(\.id) == ["user-a"])
  }

  /// Equal marks keep the roster's own order.
  @Test func tiesKeepRosterOrder() throws {
    let receipts = try receipts([member("user-b", at(5)), member("user-a", at(5)), member("user-c", at(5))])
    #expect(ids(receipts.readers) == ["user-b", "user-a", "user-c"])
  }

  @Test func readersAsOfAMomentIncludeAnEqualMark() throws {
    let receipts = try receipts([member("user-a", at(60)), member("user-b", at(180)), member("user-c", nil)])
    #expect(ids(receipts.readers(asOf: at(0))) == ["user-b", "user-a"])
    #expect(ids(receipts.readers(asOf: at(60))) == ["user-b", "user-a"])
    #expect(ids(receipts.readers(asOf: at(120))) == ["user-b"])
    #expect(receipts.readers(asOf: at(240)).isEmpty)
  }

  /// Read times do not cross the organization boundary: a guest viewer is told nothing, payload or live.
  @Test func aGuestViewerSeesNobodyAsRead() throws {
    let receipts = try receipts([member("user-a", at(0)), member("user-b", nil)], live: ["user-b": at(10)], access: .guest)
    #expect(receipts.readers.isEmpty)
    #expect(receipts.nonReaders.map(\.id) == ["user-a", "user-b"])
    #expect(receipts.readers(asOf: .distantPast).isEmpty)
  }

  @Test func noRoomReportsNothing() {
    let receipts = RoomReadReceipts(room: nil, currentUserId: viewer, liveReads: ["user-a": at(0)])
    #expect(receipts.readers.isEmpty && receipts.nonReaders.isEmpty)
  }

  /// Only the newest message shows faces; scrollback stays quiet.
  @Test func seenByRidesTheNewestMessageOnly() throws {
    let receipts = try receipts([member("user-a", at(60)), member("user-b", at(30)), member("user-c", at(-60)), member("user-d", nil)])
    let seen = try #require(receipts.seenBy(messageId: newest, createdAt: at(0), newestMessageId: newest))
    #expect(ids(seen.readers) == ["user-a", "user-b"])
    #expect(seen.summary == "Seen by 2 people")
    #expect(receipts.seenBy(messageId: "message-older", createdAt: at(-120), newestMessageId: newest) == nil)
    #expect(receipts.seenBy(messageId: newest, createdAt: at(0), newestMessageId: nil) == nil)
  }

  @Test func seenByIsNilWhenNobodyHasReadThatFar() throws {
    #expect(try receipts([member("user-a", at(-60))]).seenBy(messageId: newest, createdAt: at(0), newestMessageId: newest) == nil)
    #expect(try receipts([member("user-a", nil)]).seenBy(messageId: newest, createdAt: at(0), newestMessageId: newest) == nil)
  }

  /// A group Direct is `kind: direct`; nothing on the way to the faces reads the kind.
  @Test func aGroupDirectShowsFacesAsAChannelDoes() throws {
    let receipts = try RoomReadReceipts(
      room: room([member("user-a", at(60)), member("user-b", at(30))], kind: .direct), currentUserId: viewer, liveReads: [:]
    )
    #expect(try ids(#require(receipts.seenBy(messageId: newest, createdAt: at(0), newestMessageId: newest)).readers) == ["user-a", "user-b"])
  }

  @Test func capsTheFacesAtThreeAndCountsTheRest() throws {
    let five = try receipts((1 ... 5).map { member("user-\($0)", at(Double(100 - $0))) })
    let seen = try #require(five.seenBy(messageId: newest, createdAt: at(0), newestMessageId: newest))
    #expect(ids(seen.faces) == ["user-1", "user-2", "user-3"])
    #expect(seen.overflowCount == 2)
    #expect(seen.summary == "Seen by 5 people")
    let one = try #require(try receipts([member("user-a", at(1))]).seenBy(messageId: newest, createdAt: at(0), newestMessageId: newest))
    #expect(one.overflowCount == 0)
    #expect(one.summary == "Seen by 1 person")
  }

  @Test func namesAMemberByNameElseEmail() {
    #expect(SeenBy.name(of: member("Ada", nil)) == "Ada")
    #expect(SeenBy.name(of: .init(id: "u", name: "", email: "u@example.com", presence: .offline)) == "u@example.com")
  }

  /// Everyone who has not read this far: lagging readers first, then the never-read, so the list runs from
  /// nearly caught up to never here.
  @Test func pendingListsLaggingReadersBeforeTheNeverRead() throws {
    let receipts = try receipts([member("user-read", at(60)), member("user-never", nil), member("user-lagging", at(-180))])
    let seen = try #require(receipts.seenBy(messageId: newest, createdAt: at(0), newestMessageId: newest))
    #expect(ids(seen.readers) == ["user-read"])
    #expect(seen.pending.map(\.id) == ["user-lagging", "user-never"])
  }

  @Test func pendingIsEmptyWhenEveryoneHasRead() {
    let here = RoomReader(participant: member("here", at(60)), lastReadAt: at(60))
    #expect(seenByPending(readers: [here], allReaders: [here], nonReaders: []).isEmpty)
    let lagging = RoomReader(participant: member("lagging", at(-60)), lastReadAt: at(-60))
    #expect(seenByPending(readers: [here], allReaders: [here, lagging], nonReaders: [member("never", nil)]).map(\.id) == ["lagging", "never"])
  }
}

/// Row 31b1: the live half of web's `useRoomReadReceipts` — the open room's marks, never rewound.
@MainActor struct RoomReadMarksTests {
  private func marks() -> RoomReadMarks {
    let marks = RoomReadMarks()
    marks.open(roomId: roomId)
    return marks
  }

  @Test func aLaterEventReplacesAnEarlierOne() {
    let marks = marks()
    marks.apply(.init(roomId: roomId, userId: "user-a", lastReadAt: at(0)))
    marks.apply(.init(roomId: roomId, userId: "user-a", lastReadAt: at(60)))
    #expect(marks.marks == ["user-a": at(60)])
  }

  /// Events arriving out of order cannot un-read a room.
  @Test func neverRewindsAMark() {
    let marks = marks()
    marks.apply(.init(roomId: roomId, userId: "user-a", lastReadAt: at(60)))
    marks.apply(.init(roomId: roomId, userId: "user-a", lastReadAt: at(-60)))
    #expect(marks.marks == ["user-a": at(60)])
  }

  @Test func ignoresAnEventForAnotherRoom() {
    let marks = marks()
    marks.apply(.init(roomId: "room-2", userId: "user-a", lastReadAt: at(0)))
    #expect(marks.marks.isEmpty)
    let closed = RoomReadMarks()
    closed.apply(.init(roomId: roomId, userId: "user-a", lastReadAt: at(0)))
    #expect(closed.marks.isEmpty)
  }

  /// A new room starts from its own payload; reopening the same room keeps what it heard.
  @Test func forgetsOneRoomsMarksWhenAnotherOpens() {
    let marks = marks()
    marks.apply(.init(roomId: roomId, userId: "user-a", lastReadAt: at(0)))
    marks.open(roomId: roomId)
    #expect(marks.marks == ["user-a": at(0)])
    marks.open(roomId: "room-2")
    #expect(marks.marks.isEmpty && marks.roomId == "room-2")
    marks.open(roomId: nil)
    #expect(marks.roomId == nil)
  }
}
