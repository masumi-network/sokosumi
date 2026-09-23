import CoreAPI
import Foundation
import SokosumiChat
import Testing

struct RoomRosterTests {
  private func room() -> Components.Schemas.ChatRoom {
    .init(id: "room", name: "Team", kind: .channel, isSelfDirect: false, isGroupDirect: false, createdByUserId: "me", createdAt: .distantPast, updatedAt: .distantPast, unreadCount: 0, unreadMentionCount: 0, markedUnread: false, myAccess: .member, userMembers: [], coworkerMembers: [], sokoBotMembers: [])
  }

  @Test func ordersEachKindAndUsesRosterSubtitles() {
    var value = room()
    value.userMembers = [
      .init(id: "z", name: "Zoe", email: "z@example.com", presence: .online),
      .init(id: "a", name: "", email: "alice@example.com", presence: .afk)
    ]
    value.coworkerMembers = [.init(id: "cow", name: "Aaron", slug: "helper", caption: "Profile caption", presence: .online)]
    value.sokoBotMembers = [.init(id: "bot", name: "Assistant", caption: "My assistant", presence: .offline)]
    let members = RoomRoster.members(in: value)
    #expect(members.map(\.id) == [.human("a"), .human("z"), .coworker("cow"), .sokoBot("bot")])
    #expect(members.map(\.subtitle) == ["alice@example.com", "z@example.com", "@helper", "My assistant"])
    #expect(members[2].profile.detail == "Profile caption")
    #expect(members[0].profile.presence == "afk")
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
