import CoreAPI
import Foundation
import SokosumiChat
import Testing

private let viewer = "me"
private let origin = Date(timeIntervalSince1970: 1_800_000_000)

private func at(_ minutes: Double) -> Date {
  origin.addingTimeInterval(minutes * 60)
}

private func human(
  _ id: String, _ name: String, read: Date? = nil, access: Components.Schemas.ChatRoomAccess? = nil
) -> Components.Schemas.ChatRoomUserParticipant {
  .init(id: id, name: name, email: "\(id)@example.com", presence: .offline, access: access, lastReadAt: read)
}

private func ids(_ members: [RoomRosterMember]) -> [DirectRecipient] {
  members.map(\.id)
}

struct RoomRosterTests {
  private func room(
    _ members: [Components.Schemas.ChatRoomUserParticipant] = [], access: Components.Schemas.ChatRoomAccess = .member
  ) -> Components.Schemas.ChatRoom {
    .init(id: "room", name: "Team", kind: .channel, isSelfDirect: false, isGroupDirect: false, isReadOnly: false, createdByUserId: "me", createdAt: .distantPast, updatedAt: .distantPast, unreadCount: 0, unreadMentionCount: 0, markedUnread: false, myAccess: .init(value1: access, value2: .init(stringLiteral: access.rawValue)), userMembers: members, formerUserMembers: [], coworkerMembers: [], sokoBotMembers: [])
  }

  /// The inspector's groups as `RoomDetailsView` reads them: the room's own receipts with `live` marks on top.
  private func groups(_ room: Components.Schemas.ChatRoom, live: [String: Date] = [:]) -> RoomRosterGroups {
    RoomRoster.groups(in: room, currentUserId: viewer,
                      receipts: RoomReadReceipts(room: room, currentUserId: viewer, liveReads: live))
  }

  @Test func ordersEachKindAndUsesRosterSubtitles() {
    var value = room([
      .init(id: "z", name: "Zoe", email: "z@example.com", presence: .online),
      .init(id: "a", name: "", email: "alice@example.com", presence: .afk)
    ])
    value.coworkerMembers = [
      .init(id: "cow", name: "Aaron", slug: "helper", caption: "Profile caption", presence: .online),
      .init(id: "cow0", name: "", slug: "", caption: nil, presence: .online)
    ]
    value.sokoBotMembers = [.init(id: "bot", name: "Assistant", caption: "My assistant", ownerUserId: "me", presence: .offline)]
    let roster = groups(value)
    // Nobody has read the room, so both people sit under "Not read yet", by name (the email until they have one).
    #expect(roster.people.isEmpty)
    #expect(ids(roster.neverRead) == [.human("a"), .human("z")])
    #expect(roster.neverRead.map(\.subtitle) == ["alice@example.com", "z@example.com"])
    #expect(roster.neverRead.first?.profile.presence == "afk")
    #expect(ids(roster.agents) == [.coworker("cow0"), .coworker("cow"), .sokoBot("bot")])
    #expect(roster.agents.map(\.subtitle) == [nil, "@helper", "My assistant"])
    #expect(roster.agents.dropFirst().first?.profile.detail == "Profile caption")
  }

  /// Row 31b2, web `groupRosterMembers`: the viewer first whatever their own mark, then everyone with a Room
  /// last-read, most recent first, then the never-read under their own subheading, by name.
  @Test func peopleRunFromTheViewerThroughTheFreshestReaders() {
    let roster = groups(room([
      human("kim", "Kim"), human("bea", "Bea", read: at(5)), human(viewer, "Me", read: at(1)),
      human("al", "Al", read: at(30)), human("cy", "Cy"), human("dee", "Dee", read: at(5))
    ]))
    #expect(ids(roster.people) == [.human(viewer), .human("al"), .human("bea"), .human("dee")])
    #expect(ids(roster.neverRead) == [.human("cy"), .human("kim")])
    // Each reader's row states their read time; the viewer's and the never-read rows say nothing themselves.
    #expect(roster.people.map(\.lastReadAt) == [nil, at(30), at(5), at(5)])
    #expect(roster.neverRead.allSatisfy { $0.lastReadAt == nil })
  }

  /// A live `chat_room_read` moves a member up the list and out of "Not read yet", as on web.
  @Test func aLiveMarkReordersThePeople() {
    let value = room([human(viewer, "Me"), human("al", "Al", read: at(30)), human("bea", "Bea")])
    #expect(ids(groups(value).people) == [.human(viewer), .human("al")])
    let live = groups(value, live: ["bea": at(40)])
    #expect(ids(live.people) == [.human(viewer), .human("bea"), .human("al")])
    #expect(live.people.dropFirst().first?.lastReadAt == at(40))
    #expect(live.neverRead.isEmpty)
  }

  /// SOK-1258: an External channel's Guests leave the host list for their own section, by name; a guest member
  /// keeps their read time but never sits under "Not read yet".
  @Test func guestsListSeparatelyFromHostMembers() {
    var value = room([
      human("zed", "Zed", read: at(3), access: .guest), human("host", "Host", read: at(1), access: .member),
      human("amy", "Amy", access: .guest), human(viewer, "Me"), human("legacy", "Legacy")
    ])
    var roster = groups(value)
    #expect(ids(roster.people) == [.human(viewer), .human("host")])
    #expect(ids(roster.neverRead) == [.human("legacy")])
    #expect(ids(roster.guests) == [.human("amy"), .human("zed")])
    #expect(roster.guests.map(\.subtitle) == ["amy@example.com", "zed@example.com"])
    #expect(roster.guests.map(\.lastReadAt) == [nil, at(3)])
    value.userMembers.removeAll { $0.access == .guest }
    roster = groups(value)
    #expect(roster.guests.isEmpty)
  }

  /// A guest viewer first among the Guests, and told nothing about anyone's reading: the host members keep plain
  /// name order with no "Not read yet" and no times.
  @Test func aGuestViewerGetsThePlainList() {
    let roster = groups(room([
      human("zed", "Zed", access: .guest), human("kim", "Kim", read: at(9)), human(viewer, "Me", access: .guest),
      human("al", "Al", read: at(1)), human("bea", "Bea")
    ], access: .guest))
    #expect(ids(roster.people) == [.human("al"), .human("bea"), .human("kim")])
    #expect(roster.neverRead.isEmpty)
    #expect(ids(roster.guests) == [.human(viewer), .human("zed")])
    #expect((roster.people + roster.guests).allSatisfy { $0.lastReadAt == nil })
  }

  /// Headings with counts appear only once two kinds are on the roster; People counts every host member, read or not.
  @Test func headingsNameTheKindsOnceTwoArePresent() {
    var value = room([human(viewer, "Me"), human("al", "Al", read: at(1)), human("bea", "Bea")])
    var roster = groups(value)
    #expect(!roster.showsHeadings && roster.peopleCount == 3 && !roster.isEmpty)
    value.coworkerMembers = [.init(id: "cow", name: "Helper", slug: "helper", presence: .online)]
    roster = groups(value)
    #expect(roster.showsHeadings && roster.peopleCount == 3 && roster.agents.count == 1)
    value.coworkerMembers = []
    value.userMembers.append(human("amy", "Amy", access: .guest))
    #expect(groups(value).showsHeadings)
    #expect(groups(room()).isEmpty && !groups(room()).showsHeadings && groups(room()).peopleCount == 0)
  }

  @Test func rosterVisibilityMatchesWeb() {
    var value = room()
    #expect(RoomRoster.isAvailable(in: value))
    value.kind = .direct
    #expect(!RoomRoster.isAvailable(in: value))
    value.userMembers = (1 ... 2).map { .init(id: String($0), name: "User", email: "user@example.com", presence: .offline) }
    #expect(!RoomRoster.isAvailable(in: value))
    value.coworkerMembers = [.init(id: "cow", name: "Helper", slug: "helper", presence: .online)]
    #expect(RoomRoster.isAvailable(in: value))
  }
}
