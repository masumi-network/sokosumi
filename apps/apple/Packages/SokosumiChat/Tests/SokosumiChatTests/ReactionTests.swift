import Foundation
import SokosumiChat
import Testing

@MainActor struct ReactionTests {
  @Test(arguments: [false, true])
  func toggleUsesScopedEndpoint(organization: Bool) async throws {
    let transport = TestTransport([(200, testCreatedMessageBody(id: "message", content: "Hello", clientMessageId: "turn"))])
    let response = try await ChatService().toggleReaction(client: makeTestClient(transport), roomId: testRoomId,
                                                          messageId: "message", emoji: "👍", organizationSlug: organization ? "team" : nil)
    #expect(response.id == "message")
    #expect(transport.requests[0].request.method == .post)
    #expect(transport.requests[0].request.path?.contains("/messages/message/reactions") == true)
    #expect(testOrgSlugHeader(transport.requests[0].request) == (organization ? "team" : nil))
    #expect(testRequestJSON(transport.bodies[0]) as? [String: String] == ["emoji": "👍"])
  }

  @Test(arguments: [400, 401, 403, 404, 500])
  func toggleReportsFailure(status: Int) async throws {
    let transport = TestTransport([(status, "{\"message\":\"Reaction denied\"}")])
    await #expect(throws: (any Error).self) {
      try await ChatService().toggleReaction(client: makeTestClient(transport), roomId: testRoomId,
                                             messageId: "message", emoji: "👍", organizationSlug: nil)
    }
  }

  @Test func catalogSearchPreservesAliasesWithoutDuplicateEmoji() {
    #expect(ReactionEmoji.matching("SMILE").contains { $0.emoji == "😄" })
    #expect(ReactionEmoji.matching("thumbsup").contains { $0.emoji == "👍" })
    #expect(ReactionEmoji.matching("👍").count == 1)
    #expect(ReactionEmoji.matching("no_such_emoji_name").isEmpty)
    #expect(Set(ReactionEmoji.catalog.map(\.id)).count == ReactionEmoji.catalog.count)
    #expect(ReactionEmoji.matching("  ").count == ReactionEmoji.catalog.count)
  }

  @Test func reversedResponsesPreserveOtherEmojiAndDeletedMessages() {
    var message = chatRoomMessage(from: .init(clientTurnId: "reaction", roomId: "room", content: "Current content",
                                              sender: .init(id: "user", name: "User", email: "user@example.com", presence: .online)))
    message.id = "message"
    #expect(canReactToMessage(message))
    var earlier = message
    earlier.reactions = [.init(emoji: "👍", count: 1, reactedByCurrentUser: true, reactors: [])]
    var later = earlier
    later.reactions.append(.init(emoji: "❤️", count: 1, reactedByCurrentUser: true, reactors: []))
    message = applyingReactionResponse(later, emoji: "❤️", to: message)
    message = applyingReactionResponse(earlier, emoji: "👍", to: message)
    #expect(Set(message.reactions.map(\.emoji)) == ["👍", "❤️"])
    earlier.reactions = []
    message = applyingReactionResponse(earlier, emoji: "👍", to: message)
    #expect(message.reactions.map(\.emoji) == ["❤️"])
    message.deletedAt = Date()
    #expect(!canReactToMessage(message))
    let deleted = applyingReactionResponse(later, emoji: "👍", to: message)
    #expect(deleted.reactions.map(\.emoji) == ["❤️"])
    #expect(deleted.deletedAt != nil)
  }

  @Test func quickReactionsUseRankedHistoryAndUniqueDefaults() throws {
    let suite = "quick-reactions-\(UUID().uuidString)"
    let defaults = try #require(UserDefaults(suiteName: suite))
    defer { defaults.removePersistentDomain(forName: suite) }
    let history = ReactionEmojiHistory(defaults: defaults)
    #expect(history.quickReactions.map(\.emoji) == ["👍", "❤️", "😂"])
    history.record("❤️")
    #expect(history.quickReactions.map(\.emoji) == ["❤️", "👍", "😂"])
    history.record("🎉")
    history.record("🎉")
    #expect(history.quickReactions.map(\.emoji) == ["🎉", "❤️", "👍"])
    history.record("👀")
    history.record("👀")
    history.record("👀")
    #expect(ReactionEmojiHistory(defaults: defaults).quickReactions.map(\.emoji) == ["👀", "🎉", "❤️"])
  }

  @Test func categoriesAndUsageHistorySupportGroupedPicker() throws {
    #expect(ReactionEmoji.matching("grinning").first { $0.emoji == "😀" }?.category == .people)
    #expect(ReactionEmoji.matching("pizza").first?.category == .foodAndDrink)
    #expect(ReactionEmoji.catalog.first { $0.category == .people }?.emoji == "😀")
    #expect(Set(ReactionEmoji.catalog.map(\.category)) == Set(ReactionEmoji.Category.allCases))
    let suite = "reaction-history-\(UUID().uuidString)"
    let defaults = try #require(UserDefaults(suiteName: suite))
    defer { defaults.removePersistentDomain(forName: suite) }
    let history = ReactionEmojiHistory(defaults: defaults)
    #expect(history.frequent.isEmpty)
    history.record("👍")
    history.record("🎉")
    history.record("🎉")
    history.record("not an emoji")
    #expect(history.frequent.map(\.emoji) == ["🎉", "👍"])
    #expect(ReactionEmojiHistory(defaults: defaults).frequent.map(\.emoji) == ["🎉", "👍"])
  }
}
