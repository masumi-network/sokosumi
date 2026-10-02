import CoreAPI
import Foundation
import OpenAPIRuntime
@testable import SokosumiChat
import Testing

private let sokoBotSender = #"{"type":"sokoBot","sokoBot":{"id":"bot_1","name":"Soko","caption":"Me's personal assistant","image":null,"avatarSeed":"orb:user_2","ownerUserId":"user_2","presence":"online"}}"#
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

extension SokoBotTurnMetadataTests {
  /// Web `hasSokoBotMessageFooter`: approvals or Tasks, never an empty line for the turn alone.
  @Test func theFooterNeedsApprovalsOrTasks() {
    #expect(!SokoBotTurnMetadata(turnId: "turn_1").hasFooter)
    #expect(!SokoBotTurnMetadata(turnId: "turn_1", source: "SCHEDULE").hasFooter)
    #expect(SokoBotTurnMetadata(turnId: "turn_1", pendingDecisionIds: ["dec_1"]).hasFooter)
    #expect(SokoBotTurnMetadata(turnId: "turn_1", taskIds: ["task_1"]).hasFooter)
  }
}

/// Row 38c: web `sokoBotSourceLabel` (#5536) and where `ChatMessageRow` draws `SokoBotSourceLabel`.
struct SokoBotSourceLabelTests {
  private func label(_ sokoBot: String) async throws -> SokoBotSourceLabel? {
    try await SokoBotSourceLabel(message: decode(botRow(metadata: #"{"soko_bot":\#(sokoBot)}"#)))
  }

  /// Core's delivery writes `source` for turns the bot started itself, and the schedule's name and system key for schedule runs.
  @Test func readsTheScheduleItCameFrom() async throws {
    let turn = try await SokoBotTurnMetadata(message: decode(botRow(metadata: #"{"soko_bot":{"turn_id":"turn_1","source":"SCHEDULE","schedule_name":"Daily stand-up","schedule_key":"standup"}}"#)))
    #expect(turn == .init(turnId: "turn_1", source: "SCHEDULE", scheduleName: "Daily stand-up", scheduleKey: "standup"))
    // A schedule the owner made has no system key; web reads anything but a string as none.
    let custom = try await SokoBotTurnMetadata(message: decode(botRow(metadata: #"{"soko_bot":{"turn_id":"turn_2","source":"SCHEDULE","schedule_name":7,"schedule_key":null}}"#)))
    #expect(custom == .init(turnId: "turn_2", source: "SCHEDULE"))
  }

  @Test func namesWhereAnUnpromptedMessageCameFrom() async throws {
    #expect(try await label(#"{"turn_id":"turn_1","source":"INGEST"}"#) == .inbox)
    #expect(try await label(#"{"turn_id":"turn_1","source":"EVENT"}"#) == .taskUpdate)
    #expect(try await label(#"{"turn_id":"turn_1","source":"SCHEDULE","schedule_name":"Daily stand-up","schedule_key":"standup"}"#) == .standup)
    #expect(try await label(#"{"turn_id":"turn_1","source":"SCHEDULE","schedule_name":"Weekly wrap","schedule_key":"weekly-wrap"}"#) == .weeklyWrap)
    // The system key wins over the name, and names the stand-up even without one.
    #expect(try await label(#"{"turn_id":"turn_1","source":"SCHEDULE","schedule_name":"Morning","schedule_key":"standup"}"#) == .standup)
    #expect(try await label(#"{"turn_id":"turn_1","source":"SCHEDULE","schedule_key":"weekly-wrap"}"#) == .weeklyWrap)
    // Any other schedule, the owner's own or another system one, goes by its name.
    #expect(try await label(#"{"turn_id":"turn_1","source":"SCHEDULE","schedule_name":"Monday check-in","schedule_key":null}"#) == .scheduled(name: "Monday check-in"))
    #expect(try await label(#"{"turn_id":"turn_1","source":"SCHEDULE","schedule_name":"End of day","schedule_key":"end-of-day"}"#) == .scheduled(name: "End of day"))
    #expect(SokoBotSourceLabel(turn: .init(turnId: "turn_1", source: "INGEST")) == .inbox)
  }

  /// Web returns null for a chat reply, an admin retry, an unknown or missing source, and a schedule with no system key and no name.
  @Test(arguments: [
    #"{"turn_id":"turn_1","source":"CHAT"}"#,
    #"{"turn_id":"turn_1","source":"ADMIN_RETRY"}"#,
    #"{"turn_id":"turn_1","source":"ingest"}"#,
    #"{"turn_id":"turn_1","source":7}"#,
    #"{"turn_id":"turn_1"}"#,
    #"{"turn_id":"turn_1","pending_decision_ids":["dec_1"],"task_ids":["task_1"]}"#,
    #"{"turn_id":"turn_1","source":"SCHEDULE"}"#,
    #"{"turn_id":"turn_1","source":"SCHEDULE","schedule_name":"","schedule_key":null}"#,
    #"{"turn_id":"turn_1","source":"SCHEDULE","schedule_key":"meeting-prep"}"#,
    #"{"source":"INGEST"}"#,
    #"{"turn_id":7,"source":"INGEST"}"#
  ])
  func labelsNothingOnRepliesOrUnknownSources(sokoBot: String) async throws {
    #expect(try await label(sokoBot) == nil)
  }

  /// Web draws the line in a settled row's body only: not on a deleted message, and not on a mention shell, thinking or failed.
  /// It does not check the sender, so the metadata alone decides.
  @Test func onlyASettledRowCarriesItsLabel() async throws {
    let inbox = #"{"turn_id":"turn_1","source":"INGEST"}"#
    #expect(try await SokoBotSourceLabel(message: decode(botRow(sender: coworkerSender, metadata: #"{"soko_bot":\#(inbox)}"#))) == .inbox)
    #expect(try await SokoBotSourceLabel(message: decode(botRow(metadata: #"{"soko_bot":\#(inbox)}"#, deletedAt: testTimestamp))) == nil)
    #expect(try await SokoBotSourceLabel(message: decode(botRow(content: "", metadata: #"{"streaming":true,"mention_id":"mention_1","soko_bot":\#(inbox)}"#))) == nil)
    #expect(try await SokoBotSourceLabel(message: decode(botRow(content: "", metadata: #"{"mention_id":"mention_1","mention_failed":true,"soko_bot":\#(inbox)}"#))) == nil)
    #expect(try await SokoBotSourceLabel(message: decode(botRow(metadata: nil))) == nil)
  }
}

struct SokoBotFeedbackTests {
  private let turn = #"{"soko_bot":{"turn_id":"turn_1"}}"#

  /// Web renders the thumbs in the pill of every row whose actions show (`showActions`: not deleted,
  /// not thinking, not a local send) when `soko_bot.turn_id` is a string, whoever sent the row.
  @Test func theThumbsFollowTheTurnOnARowWithActions() async throws {
    #expect(try await SokoBotFeedback.turnId(for: decode(botRow(metadata: turn))) == "turn_1")
    #expect(try await SokoBotFeedback.turnId(for: decode(botRow(content: "Here is the plan.", metadata: #"{"mention_id":"mention_1","reasoning":[],"soko_bot":{"turn_id":"turn_2","task_ids":["task_1"]}}"#))) == "turn_2")
    #expect(try await SokoBotFeedback.turnId(for: decode(botRow(sender: coworkerSender, metadata: turn))) == "turn_1")
    // A failed shell keeps its actions on web's row; the transcript drops it anyway (row 38a).
    #expect(try await SokoBotFeedback.turnId(for: decode(botRow(content: "", metadata: #"{"mention_id":"mention_1","mention_failed":true,"soko_bot":{"turn_id":"turn_3"}}"#))) == "turn_3")
  }

  @Test func rowsWithoutActionsOrATurnCarryNoThumbs() async throws {
    #expect(try await SokoBotFeedback.turnId(for: decode(botRow(metadata: turn, deletedAt: testTimestamp))) == nil)
    #expect(try await SokoBotFeedback.turnId(for: decode(botRow(content: "", metadata: #"{"streaming":true,"mention_id":"mention_1","soko_bot":{"turn_id":"turn_1"}}"#))) == nil)
    #expect(try await SokoBotFeedback.turnId(for: decode(botRow(id: "pending:client_1", metadata: turn))) == nil)
    #expect(try await SokoBotFeedback.turnId(for: decode(botRow(metadata: #"{"soko_bot":{"turn_id":7}}"#))) == nil)
    #expect(try await SokoBotFeedback.turnId(for: decode(botRow(metadata: nil))) == nil)
  }

  /// Web `disabled={isPending || sent !== null}`, `aria-pressed` and the filled icon, and the
  /// chosen thumb's `title` "Thanks, noted.".
  @Test func aRatingLocksBothThumbsAndFillsTheChosenOne() {
    let idle = SokoBotFeedback(turnId: "turn_1")
    #expect(!idle.isLocked)
    #expect(!idle.isChosen(useful: true) && !idle.isChosen(useful: false))
    #expect(idle.help(useful: true) == "Useful" && idle.help(useful: false) == "Not useful")
    #expect(SokoBotFeedback.title(useful: true) == "Useful" && SokoBotFeedback.title(useful: false) == "Not useful")

    let sending = SokoBotFeedback(turnId: "turn_1", isSending: true)
    #expect(sending.isLocked)
    #expect(!sending.isChosen(useful: true) && !sending.isChosen(useful: false))

    let rated = SokoBotFeedback(turnId: "turn_1", rating: false)
    #expect(rated.isLocked)
    #expect(rated.isChosen(useful: false) && !rated.isChosen(useful: true))
    #expect(rated.help(useful: false) == "Thanks, noted.")
    #expect(rated.help(useful: true) == "Useful")
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

struct MentionShellTranscriptVisibilityTests {
  private let thinking = #"{"streaming":true,"mention_id":"mention_1","in_reply_to_message_id":"source","soko_bot":{"turn_id":"turn_1"}}"#
  private let failed = #"{"mention_id":"mention_1","mention_failed":true,"in_reply_to_message_id":"source","soko_bot":{"turn_id":"turn_1"}}"#

  @Test func bodilessSokoBotShellsLeaveTheTranscript() async throws {
    #expect(try await !shouldKeepPersistedMessage(decode(botRow(content: "", metadata: thinking))))
    #expect(try await !shouldKeepPersistedMessage(decode(botRow(content: "   ", metadata: failed))))
    // Web keeps coworker shells and answered rows.
    #expect(try await shouldKeepPersistedMessage(decode(botRow(content: "", sender: coworkerSender, metadata: thinking))))
    #expect(try await shouldKeepPersistedMessage(decode(botRow(content: "Done.", metadata: #"{"mention_id":"mention_1","soko_bot":{"turn_id":"turn_1"}}"#))))
    // Row 19a: the predicate is web's whole `shouldKeepPersistedMessage`, so every other bodiless
    // row leaves too — a tombstone, a bot row without shell metadata, and shell metadata on a human.
    #expect(try await !shouldKeepPersistedMessage(decode(botRow(content: "", metadata: nil, deletedAt: testTimestamp))))
    #expect(try await !shouldKeepPersistedMessage(decode(botRow(content: "", metadata: #"{"mention_id":"","streaming":true}"#))))
    #expect(try await !shouldKeepPersistedMessage(decode(botRow(content: "", metadata: #"{"mention_id":"mention_1"}"#))))
    #expect(try await !shouldKeepPersistedMessage(decode(botRow(content: "", metadata: nil))))
    #expect(try await !shouldKeepPersistedMessage(decode(botRow(content: "", sender: testUserSender(name: "Me", email: "me@example.com"), metadata: thinking))))
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
