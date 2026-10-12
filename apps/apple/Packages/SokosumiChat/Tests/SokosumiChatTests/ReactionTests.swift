import CoreAPI
import Foundation
import SokosumiChat
import Testing

@MainActor struct ReactionTests {
  @Test(arguments: [false, true])
  func addUsesScopedEndpointWithEmojiInPath(organization: Bool) async throws {
    let transport = TestTransport([(200, testCreatedMessageBody(id: "message", content: "Hello", clientMessageId: "turn"))])
    let response = try await ChatService().addReaction(client: makeTestClient(transport), roomId: testRoomId,
                                                       messageId: "message", emoji: "👍",
                                                       organizationSlug: organization ? "team" : nil)
    #expect(response.id == "message")
    #expect(transport.requests[0].request.method == .put)
    #expect(transport.requests[0].request.path?.hasSuffix("/messages/message/reactions/%F0%9F%91%8D") == true)
    #expect(testOrgSlugHeader(transport.requests[0].request) == (organization ? "team" : nil))
  }

  @Test(arguments: ["❤️", "👨‍👩‍👧"])
  func removeUsesDeleteWithEncodedEmoji(emoji: String) async throws {
    let transport = TestTransport([(200, testCreatedMessageBody(id: "message", content: "Hello", clientMessageId: "turn"))])
    _ = try await ChatService().removeReaction(client: makeTestClient(transport), roomId: testRoomId,
                                               messageId: "message", emoji: emoji, organizationSlug: nil)
    let encoded = try #require(emoji.addingPercentEncoding(withAllowedCharacters: .alphanumerics))
    #expect(transport.requests[0].request.method == .delete)
    #expect(transport.requests[0].request.path?.hasSuffix("/messages/message/reactions/\(encoded)") == true)
  }

  @Test(arguments: [400, 401, 403, 404, 422, 500], [true, false])
  func reactionRequestsReportFailure(status: Int, add: Bool) async throws {
    let transport = TestTransport([(status, "{\"message\":\"Reaction denied\"}")])
    let service = ChatService()
    let sendReaction = add ? service.addReaction : service.removeReaction
    await #expect(throws: (any Error).self) {
      try await sendReaction(makeTestClient(transport), testRoomId, "message", "👍", nil)
    }
  }

  /// Row 41: the chip's tooltip follows web's `formatWhoReactedLabel` ("Reactions.whoReacted" / "Reactions.andMore").
  @Test func whoReactedFollowsWebsWording() {
    typealias Reaction = Components.Schemas.ChatRoomMessageReaction
    let ada = Components.Schemas.ChatRoomMessageReactor(id: "user-1", name: "Ada")
    let bob = Components.Schemas.ChatRoomMessageReactor(id: "user-2", name: "Bob")
    #expect(Reaction(emoji: "👍", count: 2, reactedByCurrentUser: false, reactors: [ada, bob]).whoReacted == "Ada, Bob")
    #expect(Reaction(emoji: "👍", count: 5, reactedByCurrentUser: false, reactors: [ada, bob]).whoReacted == "Ada, Bob, and 3 more")
    // No name known: web says "and {count} more", and nothing at all when nobody is left to count.
    #expect(Reaction(emoji: "👍", count: 3, reactedByCurrentUser: false, reactors: []).whoReacted == "and 3 more")
    #expect(Reaction(emoji: "👍", count: 0, reactedByCurrentUser: false, reactors: []).whoReacted == nil)
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
                                              createdAt: Date(),
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
    #expect(defaults.dictionary(forKey: "sokosumi.reactionEmojiUseCounts.v1") as? [String: Int] == ["🎉": 2, "👍": 1])
    #expect(defaults.object(forKey: "chat.reactionEmojiUseCounts") == nil)
  }

  @Test func usageHistoryMigratesLegacyUserDefaultsKey() throws {
    let suite = "reaction-history-legacy-\(UUID().uuidString)"
    let defaults = try #require(UserDefaults(suiteName: suite))
    defer { defaults.removePersistentDomain(forName: suite) }
    defaults.set(["😂": 3, "👍": 1], forKey: "chat.reactionEmojiUseCounts")
    let history = ReactionEmojiHistory(defaults: defaults)
    #expect(history.frequent.map(\.emoji) == ["😂", "👍"])
    #expect(defaults.dictionary(forKey: "sokosumi.reactionEmojiUseCounts.v1") as? [String: Int] == ["😂": 3, "👍": 1])
    #expect(defaults.object(forKey: "chat.reactionEmojiUseCounts") == nil)
    history.record("❤️")
    // Equal-count ties break by catalog name (thumbs-up before heart).
    #expect(ReactionEmojiHistory(defaults: defaults).frequent.map(\.emoji) == ["😂", "👍", "❤️"])
    #expect(defaults.object(forKey: "chat.reactionEmojiUseCounts") == nil)
  }
}
