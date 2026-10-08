import CoreAPI
import Foundation
import HTTPTypes
@testable import SokosumiChat
import Testing

/// Fixed ids for the results fixtures.
enum ResultFixture {
  static let messageId = "550e8400-e29b-41d4-a716-446655440201"
  static let schedule = "7d1f0c2a-0000-4000-8000-000000000001"
  static let locked = "7d1f0c2a-0000-4000-8000-000000000002"
  static let job = "7d1f0c2a-0000-4000-8000-000000000003"
  static let task = "7d1f0c2a-0000-4000-8000-000000000004"
  static let stray = "7d1f0c2a-0000-4000-8000-000000000005"
  static let web = URL(string: "https://app.example/base/")!

  /// A `task_schedule` card with every generic field Core fills, plus the fields the generator drops (`actor`,
  /// `projectInfo`, `task`, `social`, `decision`), which must not break decoding.
  static let scheduleJSON = """
  {"id":"\(schedule)","state":"available","capturedAt":"2026-10-07T14:05:00.000Z","kind":"task_schedule",\
  "title":"Weekly report","status":"ACTIVE","summary":"Compile the weekly numbers","sourceHref":"/schedules/sched-1",\
  "assignee":"Elena","project":"Launch","destination":null,"scheduledAt":"2026-10-12T07:00:00.000Z",\
  "timezone":"Europe/Berlin","recurrence":"0 9 * * 1","question":null,"outputs":[],"task":null,"social":null,\
  "actor":{"id":"u1","name":"Elena","image":null,"kind":"user","avatarSeed":null},"agent":null,"projectOptions":[],\
  "projectInfo":{"id":"p1","name":"Launch","identifier":"LAU","logo":null},"decision":null}
  """

  static let lockedJSON = #"{"id":"\#(locked)","state":"unavailable"}"#

  static let jobJSON = """
  {"id":"\(job)","state":"available","capturedAt":"2026-10-07T14:06:00.000Z","kind":"job","title":"Market scan",\
  "status":"completed","summary":"Market scan","sourceHref":"/agents/ag%201/jobs/job-1","assignee":"Scout",\
  "outputs":[{"name":"report.pdf","contentType":"application/pdf","sizeBytes":20480,\
  "openHref":"/api/jobs/job-1/files/blob-1/content","previewHref":"/api/jobs/job-1/files/blob-1/content",\
  "downloadHref":"/api/jobs/job-1/files/blob-1/content?download=true"},\
  {"name":"notes","contentType":null,"sizeBytes":null,"openHref":"/api/jobs/job-1/files/blob-2/content","previewHref":null}],\
  "agent":{"name":"Scout","icon":"https://cdn.example/scout.svg"}}
  """

  static let taskJSON = """
  {"id":"\(task)","state":"available","capturedAt":"2026-10-07T14:07:00.000Z","kind":"task","title":"Review the draft",\
  "status":"INPUT_REQUIRED","summary":"","sourceHref":"/tasks/task%201","question":"Which version?",\
  "task":{"id":"task 1","name":"Review the draft"}}
  """

  static let strayJSON = """
  {"id":"\(stray)","state":"available","capturedAt":"2026-10-07T14:08:00.000Z","kind":"file","title":"Other",\
  "status":null,"sourceHref":"/drive/files/f1?scope=me"}
  """

  static func body(_ items: [String]) -> String {
    #"{"data":[\#(items.joined(separator: ","))],"meta":{"timestamp":"\#(testTimestamp)","requestId":"req-1"}}"#
  }

  /// Decodes through the real generated client, as the row reads them.
  static func previews(_ items: [String]) async throws -> [Components.Schemas.ChatResultPreview] {
    let transport = TestTransport([(200, body(items))])
    return try await ChatService().messageResults(client: makeTestClient(transport), roomId: testRoomId, messageId: messageId, organizationSlug: nil)
  }
}

@MainActor struct MessageResultPreviewsTests {
  // MARK: The descriptors

  @Test func aSettledMessageNamesItsDescriptorsAndADeletedOneNone() async throws {
    let descriptors = #"[{"id":"\#(ResultFixture.schedule)","capturedAt":"2026-10-07T14:05:00.000Z"},{"id":"\#(ResultFixture.job)","capturedAt":"2026-10-07T14:06:00.000Z"}]"#
    let settled = testMessageJSON(id: ResultFixture.messageId, content: "Done.", sender: testUserSender(name: "Soko", email: "s@example.com"))
      .replacingOccurrences(of: #""unfurls":null}"#, with: #""unfurls":null,"resultPreviews":\#(descriptors)}"#)
    let deleted = testMessageJSON(id: "gone", content: "", sender: testUserSender(name: "Soko", email: "s@example.com"), deletedAt: testTimestamp)
      .replacingOccurrences(of: #""unfurls":null}"#, with: #""unfurls":null,"resultPreviews":\#(descriptors)}"#)
    let messages = try await fetchTestMessages([settled, deleted, testMessageJSON(id: "plain", content: "hi", sender: testUserSender(name: "A", email: "a@example.com"))])
    #expect(messages.map(MessageResultPreviews.descriptorIds(of:)) == [[ResultFixture.schedule, ResultFixture.job], [], []])
  }

  // MARK: The read

  @Test func theReadAsksCoreForTheMessagesResultsInItsWorkspace() async throws {
    let transport = TestTransport([(200, ResultFixture.body([ResultFixture.scheduleJSON, ResultFixture.lockedJSON]))])
    let previews = try await ChatService().messageResults(client: makeTestClient(transport), roomId: testRoomId,
                                                          messageId: ResultFixture.messageId, organizationSlug: "acme")
    #expect(previews.count == 2)
    let request = try #require(transport.requests.first)
    #expect(request.operationID == "getChatRoomMessageResults")
    #expect(request.request.method == .get)
    #expect(request.request.path?.hasSuffix("/chats/rooms/\(testRoomId)/messages/\(ResultFixture.messageId)/results") == true)
    #expect(testOrgSlugHeader(request.request) == "acme")
  }

  @Test(arguments: [401, 403, 404, 429])
  func coreRejectionsReachTheRow(status: Int) async throws {
    let body = #"{"error":"No","message":"Results unavailable","meta":{"timestamp":"\#(testTimestamp)","requestId":"req-1","path":"/x","method":"GET"}}"#
    let transport = TestTransport([(status, body)])
    let error = await #expect(throws: ChatServiceError.self) {
      try await ChatService().messageResults(client: makeTestClient(transport), roomId: testRoomId, messageId: ResultFixture.messageId, organizationSlug: nil)
    }
    switch error {
    case .unauthorized: #expect(status == 401)
    case let .unprocessable(statusCode, message):
      #expect(statusCode == status)
      #expect(message == "Results unavailable")
    default: Issue.record("unexpected error \(String(describing: error))")
    }
  }

  // MARK: The cards

  @Test func cardsFollowCoresOrderForThisMessagesDescriptorsOnly() async throws {
    let previews = try await ResultFixture.previews([ResultFixture.strayJSON, ResultFixture.scheduleJSON, ResultFixture.lockedJSON, ResultFixture.jobJSON])
    let items = MessageResultPreviews.items(previews, descriptorIds: [ResultFixture.job, ResultFixture.locked, ResultFixture.schedule],
                                            webBaseURL: ResultFixture.web)
    #expect(items.map(\.id) == [ResultFixture.schedule, ResultFixture.locked, ResultFixture.job])
    #expect(items.dropFirst().first == .unavailable(id: ResultFixture.locked))
  }

  @Test func aScheduleCardCarriesWebsFieldsAndOpensItsSourceOnWeb() async throws {
    let previews = try await ResultFixture.previews([ResultFixture.scheduleJSON])
    guard case let .available(card)? = MessageResultPreviews.items(previews, descriptorIds: [ResultFixture.schedule], webBaseURL: ResultFixture.web).first else {
      Issue.record("no card")
      return
    }
    #expect(card.kind == .taskSchedule)
    #expect(card.title == "Weekly report")
    #expect(card.status == .result("ACTIVE"))
    #expect(card.summary == "Compile the weekly numbers")
    #expect(card.question == nil)
    #expect(card.details == [
      .assignee("Elena"), .project("Launch"),
      .scheduled(Date(timeIntervalSince1970: 1_791_788_400), timeZone: "Europe/Berlin"), .recurrence("0 9 * * 1")
    ])
    #expect(card.outputs.isEmpty)
    #expect(card.capturedAt == Date(timeIntervalSince1970: 1_791_381_900))
    #expect(card.sourceURL == URL(string: "https://app.example/base/schedules/sched-1"))
    #expect(card.agentName == nil && card.taskId == nil)
  }

  @Test func aJobCardNamesItsAgentAndOpensItsOutputsOnWeb() async throws {
    let previews = try await ResultFixture.previews([ResultFixture.jobJSON])
    guard case let .available(card)? = MessageResultPreviews.items(previews, descriptorIds: [ResultFixture.job], webBaseURL: ResultFixture.web).first else {
      Issue.record("no card")
      return
    }
    #expect(card.status == .job("completed"))
    // Web hides a summary that repeats the title.
    #expect(card.summary == nil)
    #expect(card.details == [.assignee("Scout")])
    #expect(card.agentName == "Scout" && card.agentIconURL == "https://cdn.example/scout.svg")
    #expect(card.sourceURL == URL(string: "https://app.example/base/agents/ag%201/jobs/job-1"))
    #expect(card.outputs.map(\.name) == ["report.pdf", "notes"])
    #expect(card.outputs[0].contentType == "application/pdf" && card.outputs[0].sizeBytes == 20480)
    #expect(card.outputs[0].openURL == URL(string: "https://app.example/base/api/jobs/job-1/files/blob-1/content"))
    #expect(card.outputs[0].downloadURL == URL(string: "https://app.example/base/api/jobs/job-1/files/blob-1/content?download=true"))
    #expect(card.outputs[1].contentType == nil && card.outputs[1].sizeBytes == nil && card.outputs[1].downloadURL == nil)
    #expect(Set(card.outputs.map(\.id)).count == 2)
  }

  @Test func aTaskCardKnowsItsTaskAndTheQuestionItWaitsOn() async throws {
    let previews = try await ResultFixture.previews([ResultFixture.taskJSON, ResultFixture.jobJSON, ResultFixture.lockedJSON])
    let items = MessageResultPreviews.items(previews, descriptorIds: [ResultFixture.task, ResultFixture.job, ResultFixture.locked],
                                            webBaseURL: ResultFixture.web)
    guard case let .available(card)? = items.first else {
      Issue.record("no card")
      return
    }
    #expect(card.taskId == "task 1")
    #expect(card.question == "Which version?")
    #expect(card.summary == nil)
    #expect(card.status == .result("INPUT_REQUIRED"))
    #expect(MessageResultPreviews.previewedTaskIds(items) == ["task 1"])
  }

  @Test func statusChipsFollowWebsBadges() {
    func card(kind: ResultPreviewCard.Kind, status: String?) -> ResultPreviewCard {
      ResultPreviewCard(.init(id: "x", state: .available, capturedAt: .init(timeIntervalSince1970: 0), kind: kind, title: "t",
                              status: status, sourceHref: "/x"), webBaseURL: ResultFixture.web)
    }
    #expect(card(kind: .job, status: "payment_pending").status == .job("payment_pending"))
    // A job status web's enum does not know falls back to the generic chip.
    #expect(card(kind: .job, status: "ARCHIVED").status == .result("ARCHIVED"))
    #expect(card(kind: .socialPost, status: "PUBLISHED").status == .result("PUBLISHED"))
    #expect(card(kind: .file, status: nil).status == nil)
    #expect(card(kind: .file, status: "").status == nil)
  }

  // MARK: The footer's Task button

  @Test func theFooterDropsTheTaskACardShows() {
    let turn = SokoBotTurnMetadata(turnId: "turn", pendingDecisionIds: [], taskIds: ["task 1", "task 2"])
    #expect(turn.footerTaskIds(excluding: ["task 1"]) == ["task 2"])
    #expect(turn.footerTaskIds(excluding: []) == ["task 1", "task 2"])
    #expect(turn.footerTaskIds(excluding: ["task 1", "task 2"]).isEmpty)
  }

  // MARK: Web links

  @Test func localHrefsOpenUnderTheWebOrigin() throws {
    let web = ResultFixture.web
    #expect(MessageResultPreviews.webURL(forLocalHref: "/drive/files/f%201?scope=org&organizationId=o1", webBaseURL: web)
      == URL(string: "https://app.example/base/drive/files/f%201?scope=org&organizationId=o1"))
    #expect(try MessageResultPreviews.webURL(forLocalHref: "/tasks/t1", webBaseURL: #require(URL(string: "https://app.example")))
      == URL(string: "https://app.example/tasks/t1"))
    for foreign in ["//evil.example/x", "https://evil.example/x", "tasks/t1", "/\\evil", ""] {
      #expect(MessageResultPreviews.webURL(forLocalHref: foreign, webBaseURL: web) == nil, "\(foreign)")
    }
  }

  // MARK: Time

  @Test func cardTimesUseWebsMonthDayAndClock() {
    let utc = TimeZone(identifier: "UTC") ?? .gmt
    let recorded = Date(timeIntervalSince1970: 1_791_381_900) // 2026-10-07 14:05 UTC
    // The joint between date and time is the platform's ("Oct 7 at 2:05 PM"; web's Intl writes "Oct 7, 2:05 PM").
    let twelve = TimeFormatPreference.twelveHour.monthDayTime(recorded, locale: Locale(identifier: "en_US"), timeZone: utc)
    #expect(twelve.hasPrefix("Oct 7") && twelve.contains("2:05") && twelve.hasSuffix("PM") && !twelve.contains("2026"), "\(twelve)")
    let twentyFour = TimeFormatPreference.twentyFourHour.monthDayTime(recorded, locale: Locale(identifier: "en_US"), timeZone: utc)
    #expect(twentyFour.hasPrefix("Oct 7") && twentyFour.hasSuffix("14:05"), "\(twentyFour)")
    let berlin = TimeZone(identifier: "Europe/Berlin") ?? .gmt
    #expect(TimeFormatPreference.twentyFourHour.monthDayTime(recorded, locale: Locale(identifier: "de_DE"), timeZone: berlin) == "7. Okt., 16:05")
  }
}
