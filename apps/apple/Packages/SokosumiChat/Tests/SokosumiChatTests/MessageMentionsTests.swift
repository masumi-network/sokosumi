import CoreAPI
import Foundation
@testable import SokosumiChat
import Testing

struct MessageMentionsTests {
  @Test func resolvesCurrentNamesAllAndLegacyButKeepsUnknownAndCode() throws {
    let user = Components.Schemas.ChatRoomUserParticipant(id: "peer", name: "Anna Smith", email: "anna@example.com", image: nil, presence: .online)
    let room = Components.Schemas.ChatRoom(id: "room", name: "Room", kind: .direct, createdByUserId: "peer", createdAt: Date(), updatedAt: Date(),
                                           unreadCount: 0, unreadMentionCount: 0, markedUnread: false, myAccess: .member,
                                           userMembers: [user], coworkerMembers: [], sokoBotMembers: [])
    let document = MessageMarkdown("😀 @peer:old @anna-smith @all:all @missing:ghost `@peer:old`", mentions: MessageMentions(room: room))
    let text = try #require(document.blocks.first?.text)
    #expect(String(text.characters) == "😀 @Anna Smith @Anna Smith @all @missing:ghost @peer:old")
    let links = text.runs.compactMap(\.link)
    #expect(links.count == 2)
    let target = try #require(links.first)
    #expect(ChatParticipantProfile.resolving(target, in: room)?.recipient == .human("peer"))
    var departed = room
    departed.userMembers = []
    #expect(ChatParticipantProfile.resolving(target, in: departed) == nil)
    #expect(links.allSatisfy { $0.scheme == "sokosumi-participant" })
    #expect(text.runs.filter { $0[MessageMentionAttribute.self] == true }.count == 3)
  }
}
