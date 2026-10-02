import CoreAPI
import Foundation
import SokosumiChat
import Testing

struct RoomRosterTests {
  private func room() -> Components.Schemas.ChatRoom {
    .init(id: "room", name: "Team", kind: .channel, isSelfDirect: false, isGroupDirect: false, isReadOnly: false, createdByUserId: "me", createdAt: .distantPast, updatedAt: .distantPast, unreadCount: 0, unreadMentionCount: 0, markedUnread: false, myAccess: .init(value1: .member, value2: "member"), userMembers: [], formerUserMembers: [], coworkerMembers: [], sokoBotMembers: [])
  }

  @Test func ordersEachKindAndUsesRosterSubtitles() {
    var value = room()
    value.userMembers = [
      .init(id: "z", name: "Zoe", email: "z@example.com", presence: .online),
      .init(id: "a", name: "", email: "alice@example.com", presence: .afk)
    ]
    value.coworkerMembers = [.init(id: "cow", name: "Aaron", slug: "helper", caption: "Profile caption", presence: .online)]
    value.sokoBotMembers = [.init(id: "bot", name: "Assistant", caption: "My assistant", ownerUserId: "me", presence: .offline)]
    let members = RoomRoster.members(in: value)
    #expect(members.map(\.id) == [.human("a"), .human("z"), .coworker("cow"), .sokoBot("bot")])
    #expect(members.map(\.subtitle) == ["alice@example.com", "z@example.com", "@helper", "My assistant"])
    #expect(members[2].profile.detail == "Profile caption")
    #expect(members[0].profile.presence == "afk")
  }

  /// SOK-1258: an External channel's Guests leave the host list for their own Guests section.
  @Test func guestsListSeparatelyFromHostMembers() {
    var value = room()
    value.userMembers = [
      .init(id: "zed", name: "Zed", email: "zed@partner.example", presence: .offline, access: .guest),
      .init(id: "host", name: "Host", email: "host@example.com", presence: .online, access: .member),
      .init(id: "amy", name: "Amy", email: "amy@partner.example", presence: .online, access: .guest),
      .init(id: "legacy", name: "Legacy", email: "legacy@example.com", presence: .online)
    ]
    #expect(RoomRoster.members(in: value).map(\.id) == [.human("host"), .human("legacy")])
    #expect(RoomRoster.guests(in: value).map(\.id) == [.human("amy"), .human("zed")])
    #expect(RoomRoster.guests(in: value).map(\.subtitle) == ["amy@partner.example", "zed@partner.example"])
    value.userMembers.removeAll { $0.access == .guest }
    #expect(RoomRoster.guests(in: value).isEmpty)
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
