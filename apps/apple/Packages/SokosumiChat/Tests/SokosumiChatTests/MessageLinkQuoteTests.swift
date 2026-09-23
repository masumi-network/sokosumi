import CoreAPI
import Foundation
@testable import SokosumiChat
import Testing

struct MessageLinkQuoteTests {
  private let base = URL(string: "https://app.sokosumi.com")!

  private func guest(_ id: String) throws -> Components.Schemas.ChatRoomUserParticipant {
    try .init(id: id, name: id, email: "\(id)@example.com", image: nil, presence: .online,
              access: .init(value1: .guest, value2: .init(unvalidatedValue: "guest")))
  }

  private func room(_ id: String, members: [String], guests: [Components.Schemas.ChatRoomUserParticipant] = [], organizationId: String? = "org",
                    discoverability: Components.Schemas.ChatRoom.DiscoverabilityPayload? = ._private) -> Components.Schemas.ChatRoom {
    Components.Schemas.ChatRoom(id: id, organizationId: organizationId, name: id, kind: .channel, isSelfDirect: false,
                                discoverability: discoverability, createdByUserId: "me",
                                createdAt: Date(), updatedAt: Date(), unreadCount: 0, unreadMentionCount: 0,
                                markedUnread: false, myAccess: .member,
                                userMembers: members.map { .init(id: $0, name: $0, email: "\($0)@example.com", image: nil, presence: .online) }
                                  + guests,
                                coworkerMembers: [], sokoBotMembers: [])
  }

  private func message(in roomId: String) -> Components.Schemas.ChatRoomMessage {
    var message = chatRoomMessage(from: .init(clientTurnId: "turn", roomId: roomId, content: "Keep this",
                                              sender: .init(id: "ada", name: "Ada", email: "ada@example.com", presence: .online)))
    message.id = "550e8400-e29b-41d4-a716-446655440123"
    return message
  }

  @Test func acceptsOnlyAWholeMessageLinkOnTheWebOrigin() {
    let link = pastedMessageLink("  https://app.sokosumi.com/chat/rooms/source?message=m1  ", webBaseURL: base)
    #expect(link?.roomId == "source")
    #expect(link?.messageId == "m1")
    #expect(pastedMessageLink("look https://app.sokosumi.com/chat/rooms/source?message=m1", webBaseURL: base) == nil)
    #expect(pastedMessageLink("https://evil.example.com/chat/rooms/source?message=m1", webBaseURL: base) == nil)
    #expect(pastedMessageLink("https://app.sokosumi.com/chat/rooms/source", webBaseURL: base) == nil)
    #expect(pastedMessageLink("", webBaseURL: base) == nil)
  }

  @Test func quotesOnlyIntoRoomsEveryReaderCanFollow() {
    #expect(canQuoteIntoRoom(targetMemberUserIds: ["me"], sourceReaderUserIds: ["me", "peer"]))
    #expect(canQuoteIntoRoom(targetMemberUserIds: ["me", "peer"], sourceReaderUserIds: ["me", "peer"]))
    #expect(!canQuoteIntoRoom(targetMemberUserIds: ["me", "outsider"], sourceReaderUserIds: ["me", "peer"]))
  }

  @Test func sameRoomLinkQuotesWithoutASourceRoom() async throws {
    let target = room("target", members: ["me"])
    let quote = try await #require(messageLinkQuote(.init(roomId: "target", messageId: "m1"), targetRoom: target, rooms: [target],
                                                    allowCrossRoom: true, loadMessage: { roomId, _ in message(in: roomId) }))
    #expect(quote.roomId == nil)
    #expect(quote.authorName == "Ada")
  }

  @Test func crossRoomLinkCarriesItsSourceRoomWhenEveryReaderIsAMember() async throws {
    let target = room("target", members: ["me"])
    let source = room("source", members: ["me", "peer"])
    let quote = try await #require(messageLinkQuote(.init(roomId: "source", messageId: "m1"), targetRoom: target, rooms: [target, source],
                                                    allowCrossRoom: true, loadMessage: { roomId, _ in message(in: roomId) }))
    #expect(quote.roomId == "source")
  }

  @Test func staysPlainWhenTheQuoteWouldReachSomeoneWhoCannotFollowIt() async {
    let target = room("target", members: ["me", "outsider"])
    let source = room("source", members: ["me", "peer"])
    let quote = await messageLinkQuote(.init(roomId: "source", messageId: "m1"), targetRoom: target, rooms: [target, source],
                                       allowCrossRoom: true, loadMessage: { roomId, _ in message(in: roomId) })
    #expect(quote == nil)
  }

  @Test(arguments: [Components.Schemas.ChatRoom.DiscoverabilityPayload._public, .external])
  func quotesFromAChannelEveryOrganizationMemberCanJoin(_ discoverability: Components.Schemas.ChatRoom.DiscoverabilityPayload) async {
    let target = room("target", members: ["me", "outsider"])
    let source = room("source", members: ["me"], discoverability: discoverability)
    let quote = await messageLinkQuote(.init(roomId: "source", messageId: "m1"), targetRoom: target, rooms: [target, source],
                                       allowCrossRoom: true, loadMessage: { roomId, _ in message(in: roomId) })
    #expect(quote?.roomId == "source")
  }

  @Test func staysPlainWhenAReaderCannotJoinThePublicSourceChannel() async throws {
    let source = room("source", members: ["me"], discoverability: ._public)
    for target in try [room("target", members: ["me"], guests: [guest("guest")]), room("target", members: ["me", "peer"], organizationId: "other")] {
      #expect(await messageLinkQuote(.init(roomId: "source", messageId: "m1"), targetRoom: target, rooms: [target, source],
                                     allowCrossRoom: true, loadMessage: { roomId, _ in message(in: roomId) }) == nil)
    }
  }

  @Test func staysPlainForAnUnlistedSourceRoomOrASameRoomOnlySendPath() async {
    let target = room("target", members: ["me"])
    let source = room("source", members: ["me"])
    #expect(await messageLinkQuote(.init(roomId: "source", messageId: "m1"), targetRoom: target, rooms: [target],
                                   allowCrossRoom: true, loadMessage: { roomId, _ in message(in: roomId) }) == nil)
    #expect(await messageLinkQuote(.init(roomId: "source", messageId: "m1"), targetRoom: target, rooms: [target, source],
                                   allowCrossRoom: false, loadMessage: { roomId, _ in message(in: roomId) }) == nil)
  }

  @Test func staysPlainWhenTheSenderCannotReadOrQuoteTheMessage() async {
    let target = room("target", members: ["me"])
    #expect(await messageLinkQuote(.init(roomId: "target", messageId: "m1"), targetRoom: target, rooms: [target],
                                   allowCrossRoom: true, loadMessage: { _, _ in nil }) == nil)
    #expect(await messageLinkQuote(.init(roomId: "target", messageId: "m1"), targetRoom: target, rooms: [target],
                                   allowCrossRoom: true, loadMessage: { roomId, _ in
                                     var deleted = message(in: roomId)
                                     deleted.deletedAt = Date()
                                     return deleted
                                   }) == nil)
  }
}
