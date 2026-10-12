import CoreAPI
import Foundation
@testable import SokosumiChat
import Testing

/// Fixed ids and times for the decision card (row 38h2).
enum DecisionFixture {
  static let preview = "7d1f0c2a-0000-4000-8000-000000000008"
  static let decision = "3c4d5e6f-0000-4000-8000-0000000000d1"
  static let turn = "3c4d5e6f-0000-4000-8000-0000000000e1"
  /// 2026-10-08 15:00 UTC.
  static let expires = Date(timeIntervalSince1970: 1_791_471_600)

  /// A `decision` result as Core writes it: the reason as title and summary, the decision re-read for the viewer.
  static func resultJSON(status: String = "PENDING", toolName: String = "hire_agent",
                         proposal: String = #"{"agentId":"agent_123","maxCredits":25,"name":"Launch research"}"#) -> String {
    """
    {"id":"\(preview)","state":"available","capturedAt":"2026-10-08T13:00:00.000Z","kind":"decision",\
    "title":"Hire Scout to research launch risks","status":"\(status)","summary":"Hire Scout to research launch risks",\
    "sourceHref":"/personal-assistant","decision":\(decisionJSON(status: status, toolName: toolName, proposal: proposal))}
    """
  }

  static func decisionJSON(status: String = "PENDING", toolName: String = "hire_agent",
                           proposal: String = #"{"agentId":"agent_123","maxCredits":25,"name":"Launch research"}"#) -> String {
    """
    {"id":"\(decision)","turnId":"\(turn)","toolName":"\(toolName)","proposal":\(proposal),\
    "reason":"Hire Scout to research launch risks","status":"\(status)","expiresAt":"2026-10-08T15:00:00.000Z",\
    "resolvedAt":null,"resultingEntityId":null,"createdAt":"2026-10-08T13:00:00.000Z","updatedAt":"2026-10-08T13:00:00.000Z"}
    """
  }

  /// A proposal as the generated client decodes it.
  static func proposal(_ json: String) throws -> [String: (any Sendable)?] {
    try JSONDecoder().decode(Components.Schemas.ChatResultAvailable.DecisionPayload.ProposalPayload.self, from: Data(json.utf8))
      .additionalProperties.mapValues(\.value)
  }

  static func summary(_ toolName: String, _ json: String) throws -> ProposalSummary {
    try ProposalSummary(toolName: toolName, proposal: proposal(json))
  }

  static func error(_ message: String) -> String {
    #"{"error":"No","message":"\#(message)","meta":{"timestamp":"\#(testTimestamp)","requestId":"req-1","path":"/x","method":"POST"}}"#
  }
}

@MainActor struct SokoBotDecisionTests {
  // MARK: The proposal summary (web proposal-summary.test.ts)

  @Test func aHireShowsItsAgentCeilingAndInputAndKeepsTheRest() throws {
    let summary = try DecisionFixture.summary("hire_agent", """
    {"agentId":"agent_123","maxCredits":25,"name":"Launch research",\
    "inputData":{"brief":"Research launch risks","depth":2},"inputSchema":{"type":"object"}}
    """)
    #expect(summary.acceptable)
    #expect(summary.fields == [
      .init(key: .agentId, value: "agent_123", mono: true),
      .init(key: .maxCredits, value: "25", mono: false),
      .init(key: .name, value: "Launch research", mono: false),
      .init(key: .inputData, value: "brief: Research launch risks · depth: 2", mono: false)
    ])
    // Nothing the typed fields leave out is hidden.
    #expect(summary.raw == "inputSchema: type: object")
  }

  @Test func credentialLookingKeysAreMaskedAndSizesCapped() throws {
    let summary = try DecisionFixture.summary("send_report", """
    {"apiKey":"sk-live-123","nested":{"Authorization":"Bearer x","password":"p","ok":"fine"},"card":{"number":"4111"},\
    "payment_token":"tok","list":[1,2,3,4,5,6,7],"long":"\(String(repeating: "x", count: 500))"}
    """)
    #expect(summary.fields.isEmpty)
    let raw = try #require(summary.raw)
    // Web's test looks for `tok"`: the key `payment_token` itself contains "tok".
    for secret in ["sk-live-123", "Bearer x", "4111", ": tok"] {
      #expect(!raw.contains(secret), "\(raw)")
    }
    // Keys read in code-point order: the generated client keeps no JSON key order.
    #expect(raw == "apiKey: ••• · card: ••• · list: 1, 2, 3, 4, 5, … · long: \(String(repeating: "x", count: 159))… · "
      + "nested: Authorization: ••• · ok: fine · password: ••• · payment_token: •••")
    // Web's caps: five items plus "…", 160 characters.
    guard case let .array(items) = RedactedValue([1, 2, 3, 4, 5, 6, 7] as [(any Sendable)?]) else {
      Issue.record("not an array")
      return
    }
    #expect(items.count == 6 && items.last == .string("…"))
    #expect(RedactedValue(String(repeating: "x", count: 500)).formatted.count == 160)
  }

  @Test func depthAndBreadthStopAtWebsCaps() throws {
    #expect(try DecisionFixture.summary("x", #"{"a":{"b":{"c":{"d":1}}}}"#).raw == "a: b: c: …")
    // A value is kept at any depth; only objects and arrays stop.
    #expect(try DecisionFixture.summary("x", #"{"a":{"b":{"c":1}}}"#).raw == "a: b: c: 1")
    let thirteen = (1 ... 13).map { String(format: #""k%02d":%d"#, $0, $0) }.joined(separator: ",")
    let expected = (1 ... 12).map { String(format: "k%02d: %d", $0, $0) }.joined(separator: " · ") + " · …: …"
    #expect(try DecisionFixture.summary("x", "{\(thirteen)}").raw == expected)
  }

  @Test func valuesReadAsWebWritesThem() throws {
    let summary = try DecisionFixture.summary("create_task", """
    {"name":"Draft","coworkerId":null,"projectId":null,"budget":2.5,"count":3,"flags":[true,null],"ready":false}
    """)
    // A null field is skipped but still counts as typed, so it is not repeated in the rest.
    #expect(summary.fields == [.init(key: .name, value: "Draft", mono: false)])
    #expect(summary.raw == "budget: 2.5 · count: 3 · flags: true, — · ready: false")
    #expect(try DecisionFixture.summary("create_task", "{}") == ProposalSummary(toolName: "create_task", proposal: [:]))
    #expect(try DecisionFixture.summary("create_task", "{}").raw == nil)
  }

  @Test(arguments: [
    (#"{"agentId":"a","maxCredits":5}"#, true),
    (#"{"agentId":"a","maxCredits":2.5}"#, true),
    (#"{"agentId":"","maxCredits":5}"#, false),
    (#"{"agentId":"  ","maxCredits":5}"#, false),
    (#"{"agentId":"a","maxCredits":0}"#, false),
    (#"{"agentId":"a","maxCredits":-1}"#, false),
    (#"{"agentId":"a","maxCredits":"5"}"#, false),
    (#"{"agentId":"a"}"#, false),
    (#"{"agentId":7,"maxCredits":5}"#, false)
  ])
  func aHireNeedsAnAgentAndAPositiveCeiling(proposal: String, acceptable: Bool) throws {
    #expect(try DecisionFixture.summary("hire_agent", proposal).acceptable == acceptable)
    // Every other tool stays acceptable whatever its shape.
    #expect(try DecisionFixture.summary("create_task", proposal).acceptable)
  }

  @Test func taskAndJobInputTargetsReadInWebsOrder() throws {
    let task = try DecisionFixture.summary("assign_task", #"{"status":"READY","coworkerId":"cw_1","taskId":"task_1"}"#)
    #expect(task.fields.map(\.key) == [.taskId, .coworkerId, .status])
    #expect(task.fields.map(\.mono) == [true, true, false])
    let input = try DecisionFixture.summary("provide_job_input", #"{"jobId":"job_1","eventId":"evt_1","inputData":{"secretAnswer":"42","answer":"yes"}}"#)
    #expect(input.fields.first { $0.key == .inputData }?.value == "answer: yes · secretAnswer: •••")
    #expect(input.raw == nil)
  }

  // MARK: The tool label (web useToolLabel)

  @Test func toolLabelsFollowWeb() {
    #expect(SokoBotTool.allCases.map(\.rawValue) == [
      "refresh_context", "find_coworkers", "create_task", "update_task", "assign_task", "get_task_status", "list_tasks",
      "find_agents", "get_agent_input_schema", "hire_agent", "get_job_status", "provide_job_input", "request_user_decision",
      "read_memory", "update_memory", "scratch_read", "scratch_write", "scratch_list", "read_file", "generate_image",
      "get_image", "preview_result"
    ])
    #expect(SokoBotToolLabel(toolName: "hire_agent") == .known(.hireAgent))
    #expect(SokoBotToolLabel(toolName: "send_slack_message") == .named("send slack message"))
    #expect(SokoBotToolLabel(toolName: "") == .working)
    // `t.has("default")` is true on web, so a tool named "default" reads "Working" too.
    #expect(SokoBotToolLabel(toolName: "default") == .working)
  }

  // MARK: The card

  @Test func aDecisionResultCarriesItsDecision() async throws {
    let previews = try await ResultFixture.previews([
      DecisionFixture.resultJSON(),
      DecisionFixture.resultJSON(status: "EXPIRED", toolName: "hire_agent", proposal: #"{"agentId":"agent_123"}"#)
        .replacingOccurrences(of: DecisionFixture.preview, with: ResultFixture.stray),
      ResultFixture.scheduleJSON
    ])
    let items = MessageResultPreviews.items(previews, descriptorIds: [DecisionFixture.preview, ResultFixture.stray, ResultFixture.schedule],
                                            webBaseURL: ResultFixture.web)
    let cards = items.compactMap { item -> ResultPreviewCard? in
      if case let .available(card) = item {
        card
      } else {
        nil
      }
    }
    #expect(cards.count == 3)
    let pending = try #require(cards[0].decision)
    #expect(pending.id == DecisionFixture.decision)
    #expect(pending.tool == .known(.hireAgent))
    #expect(pending.reason == "Hire Scout to research launch risks")
    #expect(pending.status == .pending && pending.isPending)
    #expect(pending.expiresAt == DecisionFixture.expires)
    #expect(pending.canAccept)
    #expect(pending.proposal.fields.map(\.key) == [.agentId, .maxCredits, .name])
    let expired = try #require(cards[1].decision)
    #expect(expired.status == .expired && !expired.isPending)
    #expect(!expired.canAccept)
    #expect(cards[2].decision == nil)
  }

  // MARK: Resolving

  @Test(arguments: [(SokoBotDecision.Resolution.accept, "ACCEPTED"), (.reject, "REJECTED")])
  func resolvingPostsTheResolution(resolution: SokoBotDecision.Resolution, settled: String) async throws {
    let body = #"{"data":\#(DecisionFixture.decisionJSON(status: settled)),"meta":{"timestamp":"\#(testTimestamp)","requestId":"req-1"}}"#
    let transport = TestTransport([(200, body)])
    let status = try await ChatService().resolveSokoBotDecision(client: makeTestClient(transport), decisionId: DecisionFixture.decision,
                                                                resolution: resolution)
    #expect(status == SokoBotDecision.Status(rawValue: settled))
    #expect(transport.requests.map(\.operationID) == ["resolveMySokoBotDecision"])
    let request = try #require(transport.requests.first?.request)
    #expect(request.method == .post)
    #expect(request.path?.hasSuffix("/soko-bots/me/decisions/\(DecisionFixture.decision)") == true)
    // Decisions belong to their owner, not to a workspace.
    #expect(testOrgSlugHeader(request) == nil)
    #expect(testRequestJSON(transport.bodies[0]) as NSDictionary == ["resolution": resolution.rawValue])
  }

  @Test(arguments: [
    (401, ChatServiceError.unauthorized("Session expired")),
    (403, .unprocessable(statusCode: 403, message: "Session expired")),
    (409, .unprocessable(statusCode: 409, message: "Session expired")),
    (422, .unprocessable(statusCode: 422, message: "Session expired")),
    (503, .unprocessable(statusCode: 503, message: "Session expired"))
  ])
  func aRefusedResolutionCarriesCoresMessage(status: Int, error: ChatServiceError) async throws {
    let transport = TestTransport([(status, DecisionFixture.error("Session expired"))])
    await #expect(throws: error) {
      try await ChatService().resolveSokoBotDecision(client: makeTestClient(transport), decisionId: DecisionFixture.decision, resolution: .accept)
    }
  }
}
