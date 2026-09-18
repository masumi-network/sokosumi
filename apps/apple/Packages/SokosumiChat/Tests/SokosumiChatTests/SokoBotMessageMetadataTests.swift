import CoreAPI
import Foundation
import OpenAPIRuntime
import SokosumiChat
import Testing

private let sokoBotSender = #"{"type":"sokoBot","sokoBot":{"id":"bot_1","name":"Soko","caption":"Me's personal assistant","image":null,"avatarSeed":"orb:user_2","presence":"online"}}"#
private let coworkerSender = #"{"type":"coworker","coworker":{"id":"cow_1","name":"Elena","slug":"elena","caption":null,"image":null,"presence":"online"}}"#
private let webBaseURL = URL(string: "https://app.example.com") ?? URL(fileURLWithPath: "/")

private func botRow(id: String = "bot", content: String = "Done.", sender: String = sokoBotSender, metadata: String?, deletedAt: String? = nil) -> String {
  testMessageJSON(id: id, content: content, sender: sender, deletedAt: deletedAt, metadata: metadata)
}

private func decode(_ row: String) async throws -> Components.Schemas.ChatRoomMessage {
  try #require(try await fetchTestMessages([row]).first)
}

struct SokoBotTurnMetadataTests {
  @Test func readsTheTurnApprovalsAndTasks() async throws {
    let metadata = #"{"soko_bot":{"turn_id":"turn_1","pending_decision_ids":["dec_1","dec_2",7,null],"task_ids":["task_1"],"source":"SCHEDULE"},"reasoning":[]}"#
    let turn = try await SokoBotTurnMetadata(message: decode(botRow(metadata: metadata)))
    #expect(turn == .init(turnId: "turn_1", pendingDecisionIds: ["dec_1", "dec_2"], taskIds: ["task_1"], source: "SCHEDULE"))
    #expect(turn?.pendingDecisionCount == 2)
    // Only the turn id is required; the arrays default to empty (web `readSokoBotMetadata`).
    let bare = try await SokoBotTurnMetadata(message: decode(botRow(metadata: #"{"soko_bot":{"turn_id":"turn_2"}}"#)))
    #expect(bare == .init(turnId: "turn_2", pendingDecisionIds: [], taskIds: [], source: nil))
    // The sender does not matter: the footer follows the metadata alone.
    #expect(try await SokoBotTurnMetadata(message: decode(botRow(sender: coworkerSender, metadata: #"{"soko_bot":{"turn_id":"turn_3"}}"#)))?.turnId == "turn_3")
  }

  @Test(arguments: [
    #"{"soko_bot":{"pending_decision_ids":["dec_1"]}}"#,
    #"{"soko_bot":{"turn_id":42}}"#,
    #"{"soko_bot":"turn_1"}"#,
    #"{"soko_bot":null}"#,
    #"{"soko_bot_chain":{"depth":1,"max_depth":3,"room_messages_this_hour":1,"room_messages_per_hour":20}}"#,
    #"{}"#
  ])
  func rejectsRecordsWithoutAStringTurnId(metadata: String) async throws {
    #expect(try await SokoBotTurnMetadata(message: decode(botRow(metadata: metadata))) == nil)
    #expect(try await SokoBotTurnMetadata(message: decode(botRow(metadata: nil))) == nil)
  }

  @Test func linksOpenTheAssistantPageAndTasksOnWeb() throws {
    let record = try OpenAPIValueContainer(unvalidatedValue: ["turn_id": "turn 1/a"])
    let turn = try #require(SokoBotTurnMetadata(metadata: ["soko_bot": record]))
    let slashed = try #require(URL(string: "https://app.example.com/"))
    let prefixed = try #require(URL(string: "https://app.example.com/base/"))
    #expect(turn.assistantURL(webBaseURL: webBaseURL)?.absoluteString == "https://app.example.com/personal-assistant?turn=turn%201/a")
    #expect(turn.assistantURL(webBaseURL: slashed)?.absoluteString == "https://app.example.com/personal-assistant?turn=turn%201/a")
    #expect(turn.assistantURL(webBaseURL: prefixed)?.absoluteString == "https://app.example.com/base/personal-assistant?turn=turn%201/a")
    #expect(SokoBotTurnMetadata.taskURL(taskId: "task_1", webBaseURL: webBaseURL)?.absoluteString == "https://app.example.com/tasks/task_1")
    // `encodeURIComponent` on web: a slash or space cannot escape the task segment.
    #expect(SokoBotTurnMetadata.taskURL(taskId: "a/b c", webBaseURL: slashed)?.absoluteString == "https://app.example.com/tasks/a%2Fb%20c")
  }
}

struct SokoBotChainMetadataTests {
  @Test func readsAllFourCountersAndFlagsTheLastHop() async throws {
    let chain = try await SokoBotChainMetadata(message: decode(botRow(metadata: #"{"soko_bot_chain":{"depth":2,"max_depth":3,"room_messages_this_hour":5,"room_messages_per_hour":20}}"#)))
    #expect(chain == .init(depth: 2, maxDepth: 3, roomMessagesThisHour: 5, roomMessagesPerHour: 20))
    #expect(chain?.isLastHop == false)
    #expect(chain?.label == "2/3")
    #expect(chain?.summary == "Assistant-to-assistant reply 2 of 3. A person writing here resets the count.\n5 of 20 assistant messages in this room this hour.")
    let last = try await SokoBotChainMetadata(message: decode(botRow(metadata: #"{"soko_bot_chain":{"depth":3.0,"max_depth":3,"room_messages_this_hour":20,"room_messages_per_hour":20}}"#)))
    #expect(last?.isLastHop == true)
    #expect(last?.summary.hasSuffix("This is the last hop — it will not wake anyone else.") == true)
  }

  @Test(arguments: [
    #"{"soko_bot_chain":{"depth":"2","max_depth":3,"room_messages_this_hour":5,"room_messages_per_hour":20}}"#,
    #"{"soko_bot_chain":{"depth":2,"max_depth":3,"room_messages_this_hour":5}}"#,
    #"{"soko_bot_chain":{"depth":2,"max_depth":null,"room_messages_this_hour":5,"room_messages_per_hour":20}}"#,
    #"{"soko_bot_chain":[]}"#,
    #"{"soko_bot":{"turn_id":"turn_1"}}"#
  ])
  func requiresNumbersForEveryCounter(metadata: String) async throws {
    #expect(try await SokoBotChainMetadata(message: decode(botRow(metadata: metadata))) == nil)
    #expect(SokoBotChainMetadata(metadata: nil) == nil)
  }
}

struct HiddenSokoBotMentionShellTests {
  private let thinking = #"{"streaming":true,"mention_id":"mention_1","in_reply_to_message_id":"source","soko_bot":{"turn_id":"turn_1"}}"#
  private let failed = #"{"mention_id":"mention_1","mention_failed":true,"in_reply_to_message_id":"source","soko_bot":{"turn_id":"turn_1"}}"#

  @Test func bodilessSokoBotShellsLeaveTheTranscript() async throws {
    #expect(try await isHiddenSokoBotMentionShell(decode(botRow(content: "", metadata: thinking))))
    #expect(try await isHiddenSokoBotMentionShell(decode(botRow(content: "   ", metadata: failed))))
    // Web keeps coworker shells, answered rows, tombstones and everything without shell metadata.
    #expect(try await !isHiddenSokoBotMentionShell(decode(botRow(content: "", sender: coworkerSender, metadata: thinking))))
    #expect(try await !isHiddenSokoBotMentionShell(decode(botRow(content: "Done.", metadata: #"{"mention_id":"mention_1","soko_bot":{"turn_id":"turn_1"}}"#))))
    #expect(try await !isHiddenSokoBotMentionShell(decode(botRow(content: "", metadata: thinking, deletedAt: testTimestamp))))
    #expect(try await !isHiddenSokoBotMentionShell(decode(botRow(content: "", metadata: #"{"mention_id":"","streaming":true}"#))))
    #expect(try await !isHiddenSokoBotMentionShell(decode(botRow(content: "", metadata: #"{"mention_id":"mention_1"}"#))))
    #expect(try await !isHiddenSokoBotMentionShell(decode(botRow(content: "", metadata: nil))))
    #expect(try await !isHiddenSokoBotMentionShell(decode(botRow(content: "", sender: testUserSender(name: "Me", email: "me@example.com"), metadata: thinking))))
  }

  @Test func displayedTranscriptDropsTheShellUntilTheAnswerArrives() async throws {
    let rows = try await fetchTestMessages([
      testMessageJSON(id: "source", content: "plan my week", sender: testUserSender(name: "Me", email: "me@example.com")),
      botRow(id: "shell", content: "", metadata: thinking),
      botRow(id: "failed", content: "", metadata: failed),
      botRow(id: "answer", content: "Here is the plan.", metadata: #"{"mention_id":"mention_2","soko_bot":{"turn_id":"turn_2","task_ids":["task_1"]}}"#)
    ])
    let displayed = displayedTranscript(messages: rows, shells: [])
    #expect(displayed.map(\.id) == ["source", "answer"])
    var answered = rows[1]
    answered.content = "Done."
    #expect(displayedTranscript(messages: [rows[0], answered], shells: []).map(\.id) == ["source", "shell"])
  }
}

@MainActor struct SokoBotFeedbackServiceTests {
  private func stored(_ useful: Bool) -> String {
    #"{"data":{"useful":\#(useful)},"meta":{"timestamp":"\#(testTimestamp)","requestId":"req-1"}}"#
  }

  @Test(arguments: [true, false])
  func feedbackPostsTheTurnRatingWithoutWorkspaceScope(useful: Bool) async throws {
    let transport = TestTransport([(200, stored(useful))])
    let result = try await ChatService().sendSokoBotTurnFeedback(client: makeTestClient(transport), turnId: "550e8400-e29b-41d4-a716-446655440001", useful: useful)
    #expect(result == useful)
    #expect(transport.requests[0].request.method == .post)
    #expect(transport.requests[0].request.path?.hasSuffix("/soko-bots/me/turns/550e8400-e29b-41d4-a716-446655440001/feedback") == true)
    #expect(testOrgSlugHeader(transport.requests[0].request) == nil)
    #expect(testRequestJSON(transport.bodies[0]) as? [String: Bool] == ["useful": useful])
  }

  @Test(arguments: [401, 404, 500])
  func feedbackReportsCoreRejections(status: Int) async throws {
    let body = #"{"error":"Not Found","message":"Turn not found","meta":{"timestamp":"\#(testTimestamp)","requestId":"req-1","path":"/soko-bots/me/turns/x/feedback","method":"POST"}}"#
    let transport = TestTransport([(status, body)])
    let error = await #expect(throws: ChatServiceError.self) {
      try await ChatService().sendSokoBotTurnFeedback(client: makeTestClient(transport), turnId: "550e8400-e29b-41d4-a716-446655440001", useful: true)
    }
    switch error {
    case .unauthorized:
      #expect(status == 401)
    case let .unprocessable(statusCode, message):
      #expect(statusCode == status)
      #expect(message == "Turn not found")
    default:
      Issue.record("unexpected error \(String(describing: error))")
    }
  }
}
