import CoreAPI
import Foundation
import SokosumiChat
import Testing

private let coworkerSender = #"{"type":"coworker","coworker":{"id":"cow_1","name":"Elena","slug":"elena","caption":null,"image":null,"presence":"online"}}"#
private let sokoBotSender = #"{"type":"sokoBot","sokoBot":{"id":"bot_1","name":"Soko","slug":"soko","image":null,"presence":"online"}}"#

private func shellRow(content: String = "", sender: String = coworkerSender, metadata: String?, deletedAt: String? = nil) -> String {
  testMessageJSON(id: "shell", content: content, sender: sender, deletedAt: deletedAt, metadata: metadata)
}

private func decode(_ row: String) async throws -> Components.Schemas.ChatRoomMessage {
  try #require(try await fetchTestMessages([row]).first)
}

struct CoworkerMentionShellTests {
  @Test func thinkingShellNeedsStreamingMentionIdEmptyBodyAndCoworkerSender() async throws {
    let live = #"{"streaming":true,"mention_id":"mention_1","in_reply_to_message_id":"source","thought_timing_ms":{"start":1700000000000}}"#
    #expect(try await CoworkerMentionShell(message: decode(shellRow(metadata: live))) == .thinking(startedAt: Date(timeIntervalSince1970: 1_700_000_000)))
    #expect(try await CoworkerMentionShell(message: decode(shellRow(metadata: #"{"streaming":true,"mention_id":"mention_1"}"#))) == .thinking(startedAt: nil))
    #expect(try await CoworkerMentionShell(message: decode(shellRow(metadata: #"{"streaming":true,"mention_id":"mention_1","thought_timing_ms":{"start":"0"}}"#))) == .thinking(startedAt: nil))
    // Answer filled, no mention id, not streaming, deleted, human or Soko Bot sender: ordinary rows.
    #expect(try await CoworkerMentionShell(message: decode(shellRow(content: "Done", metadata: live))) == nil)
    #expect(try await CoworkerMentionShell(message: decode(shellRow(metadata: #"{"streaming":true,"mention_id":""}"#))) == nil)
    #expect(try await CoworkerMentionShell(message: decode(shellRow(metadata: #"{"mention_id":"mention_1","reasoning":[]}"#))) == nil)
    #expect(try await CoworkerMentionShell(message: decode(shellRow(metadata: live, deletedAt: testTimestamp))) == nil)
    #expect(try await CoworkerMentionShell(message: decode(shellRow(sender: testUserSender(name: "Me", email: "me@example.com"), metadata: live))) == nil)
    #expect(try await CoworkerMentionShell(message: decode(shellRow(sender: sokoBotSender, metadata: live))) == nil)
    #expect(try await CoworkerMentionShell(message: decode(shellRow(metadata: nil))) == nil)
  }

  @Test func failedShellWinsOverStreamingAndReadsItsTarget() async throws {
    let failed = #"{"mention_id":"mention_1","mention_failed":true,"in_reply_to_message_id":"source","streaming":true}"#
    let shell = try await CoworkerMentionShell(message: decode(shellRow(metadata: failed)))
    #expect(shell == .failed(mentionId: "mention_1", sourceMessageId: "source"))
    #expect(shell?.isThinking == false)
    #expect(shell?.startedAt == nil)
    let orphan = try await CoworkerMentionShell(message: decode(shellRow(metadata: #"{"mention_id":"mention_1","mention_failed":true,"in_reply_to_message_id":""}"#)))
    #expect(orphan == .failed(mentionId: "mention_1", sourceMessageId: nil))
    #expect(try await CoworkerMentionShell(message: decode(shellRow(metadata: #"{"mention_failed":true}"#))) == nil)
  }

  @Test func retryingDropsTheFailureAndStartsTheClock() async throws {
    let shell = try await decode(shellRow(metadata: #"{"mention_id":"mention_1","mention_failed":true,"in_reply_to_message_id":"source"}"#))
    let startedAt = Date(timeIntervalSince1970: 1_700_000_123.456)
    let retrying = CoworkerMentionShell.retrying(shell, startedAt: startedAt)
    #expect(CoworkerMentionShell(message: retrying) == .thinking(startedAt: Date(timeIntervalSince1970: 1_700_000_123.456)))
    let metadata = retrying.metadata?.additionalProperties
    #expect(metadata?["mention_failed"] == nil)
    #expect(metadata?["mention_id"]?.value as? String == "mention_1")
    #expect(metadata?["in_reply_to_message_id"]?.value as? String == "source")
    #expect(retrying.id == shell.id)
    #expect(retrying.content.isEmpty)
  }

  @Test func retryIsMentionerOnlyWithTheSourceLoaded() async throws {
    let shell = try await decode(shellRow(metadata: #"{"mention_id":"mention_1","mention_failed":true,"in_reply_to_message_id":"source"}"#))
    let mine = try await decode(testMessageJSON(id: "source", content: "@Elena hi", sender: testUserSender(name: "Me", email: "me@example.com")))
    let theirs = try await decode(testMessageJSON(id: "source", content: "@Elena hi", sender: #"{"type":"user","user":{"id":"user_9","name":"Ada","email":"ada@example.com","presence":"offline"}}"#))
    #expect(CoworkerMentionShell.canRetry(shell, currentUserId: "user_2", sources: [mine]))
    #expect(!CoworkerMentionShell.canRetry(shell, currentUserId: "user_2", sources: [theirs]))
    #expect(!CoworkerMentionShell.canRetry(shell, currentUserId: "user_2", sources: []))
    #expect(!CoworkerMentionShell.canRetry(shell, currentUserId: "", sources: [mine]))
    let thinking = try await decode(shellRow(metadata: #"{"streaming":true,"mention_id":"mention_1","in_reply_to_message_id":"source"}"#))
    #expect(!CoworkerMentionShell.canRetry(thinking, currentUserId: "user_2", sources: [mine]))
    let orphan = try await decode(shellRow(metadata: #"{"mention_id":"mention_1","mention_failed":true}"#))
    #expect(!CoworkerMentionShell.canRetry(orphan, currentUserId: "user_2", sources: [mine]))
  }

  @Test func thinkingShellHasNoActionsButFailedKeepsQuoteAndReactions() async throws {
    let thinking = try await decode(shellRow(metadata: #"{"streaming":true,"mention_id":"mention_1"}"#))
    #expect(!canQuoteMessage(thinking))
    #expect(!canReactToMessage(thinking))
    let failed = try await decode(shellRow(metadata: #"{"mention_id":"mention_1","mention_failed":true,"in_reply_to_message_id":"source"}"#))
    #expect(canQuoteMessage(failed))
    #expect(canReactToMessage(failed))
    let answered = try await decode(shellRow(content: "Done", metadata: #"{"mention_id":"mention_1","reasoning":[]}"#))
    #expect(canQuoteMessage(answered))
    #expect(canReactToMessage(answered))
  }

  @Test(arguments: [#"{"start":"1700000000500"}"#, #"{"start":1700000000500}"#])
  func thoughtStartAcceptsNumbersAndNumericStrings(timing: String) async throws {
    let row = try await decode(shellRow(metadata: "{\"thought_timing_ms\":\(timing)}"))
    #expect(CoworkerThought.startedAt(metadata: row.metadata?.additionalProperties) == Date(timeIntervalSince1970: 1_700_000_000.5))
  }

  @Test(arguments: [#"{"start":0}"#, #"{"start":-5}"#, #"{"start":"soon"}"#, #"{"end":1000}"#])
  func thoughtStartRejectsInvalidValues(timing: String) async throws {
    let row = try await decode(shellRow(metadata: "{\"thought_timing_ms\":\(timing)}"))
    #expect(CoworkerThought.startedAt(metadata: row.metadata?.additionalProperties) == nil)
    #expect(CoworkerThought.startedAt(metadata: nil) == nil)
  }
}

@MainActor struct MentionRetryServiceTests {
  @Test(arguments: [false, true])
  func retryPostsToTheMentionPathWithWorkspaceScope(organization: Bool) async throws {
    let source = testMessageJSON(id: "source", content: "@Elena hi", sender: testUserSender(name: "Me", email: "me@example.com"))
      .replacingOccurrences(of: "\"mentions\":[]", with: #""mentions":[{"id":"mention_1","coworkerId":"cow_1","sokoBotId":null,"status":"pending","responseMessageId":"shell"}]"#)
    let transport = TestTransport([(200, #"{"data":\#(source),"meta":{"timestamp":"\#(testTimestamp)","requestId":"req-1"}}"#)])
    let message = try await ChatService().retryMention(client: makeTestClient(transport), roomId: testRoomId, messageId: "source",
                                                       mentionId: "mention_1", organizationSlug: organization ? "team" : nil)
    #expect(message.id == "source")
    #expect(message.mentions.first?.status == .pending)
    #expect(transport.requests[0].request.method == .post)
    #expect(transport.requests[0].request.path?.hasSuffix("/chats/rooms/\(testRoomId)/messages/source/mentions/mention_1/retry") == true)
    #expect(testOrgSlugHeader(transport.requests[0].request) == (organization ? "team" : nil))
    #expect(transport.bodies[0].isEmpty)
  }

  @Test(arguments: [400, 401, 403, 404, 409, 500, 422])
  func retryReportsCoreRejections(status: Int) async throws {
    let body = #"{"error":"Conflict","message":"Mention is not failed","meta":{"timestamp":"\#(testTimestamp)","requestId":"req-1","path":"/chats/rooms/x/messages/source/mentions/mention_1/retry","method":"POST"}}"#
    let transport = TestTransport([(status, body)])
    let error = await #expect(throws: ChatServiceError.self) {
      try await ChatService().retryMention(client: makeTestClient(transport), roomId: testRoomId, messageId: "source", mentionId: "mention_1", organizationSlug: nil)
    }
    switch error {
    case .unauthorized:
      #expect(status == 401)
    case let .unprocessable(statusCode, message):
      #expect(statusCode == status)
      #expect(message == "Mention is not failed")
    default:
      Issue.record("unexpected error \(String(describing: error))")
    }
  }
}
