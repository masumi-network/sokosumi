import CoreAPI
@testable import SokosumiChat
import Testing

struct ChatParticipantProfileTests {
  @Test func humanFallsBackToEmailAndPreservesRecipient() throws {
    let user = Components.Schemas.ChatRoomUserParticipant(id: "peer", name: "", email: "peer@example.com", image: nil, presence: .afk)
    let profile = try #require(ChatParticipantProfile(sender: .case1(.init(_type: .user, user: user))))
    #expect(profile.name == user.email)
    #expect(profile.detail == user.email)
    #expect(profile.presence == "afk")
    #expect(profile.recipient == .human("peer"))
  }

  @Test func coworkerFallsBackToSlugWhenCaptionBlank() throws {
    let coworker = Components.Schemas.ChatRoomCoworkerParticipant(id: "cow", name: "Helper", slug: "helper", caption: "  ", image: nil, presence: .online)
    let profile = try #require(ChatParticipantProfile(sender: .case2(.init(_type: .coworker, coworker: coworker))))
    #expect(profile.detail == "@helper")
    #expect(profile.recipient == .coworker("cow"))
    #expect(ChatParticipantProfile(sender: .case4(.init(_type: .unknown))) == nil)
  }
}
