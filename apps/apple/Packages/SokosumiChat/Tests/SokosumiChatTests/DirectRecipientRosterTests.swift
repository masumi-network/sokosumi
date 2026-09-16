import CoreAPI
import Foundation
import HTTPTypes
import OpenAPIRuntime
import SokosumiChat
import Testing

private let rosterTimestamp = "2026-01-01T00:00:00.000Z"
private func rosterEnvelope(_ data: String) -> String {
  """
  {"data":\(data),"meta":{"timestamp":"\(rosterTimestamp)","requestId":"test","path":"/organizations/org/members","method":"GET"}}
  """
}

private actor RosterTransport: ClientTransport {
  let replies: [String: (Int, String)]
  private(set) var requests: [HTTPRequest] = []

  init(_ replies: [String: (Int, String)]) {
    self.replies = replies
  }

  func send(_ request: HTTPRequest, body _: HTTPBody?, baseURL _: URL, operationID: String) async throws -> (HTTPResponse, HTTPBody?) {
    requests.append(request)
    let reply = replies[operationID] ?? (500, #"{"error":"Internal Server Error","message":"Unavailable","meta":{"timestamp":"2026-01-01T00:00:00.000Z","requestId":"test","path":"/organizations/org/members","method":"GET"}}"#)
    return (.init(status: .init(code: reply.0)), HTTPBody(reply.1))
  }
}

private func coworkerFixture(id: String, endpoint: String = "https://example.com", archived: Bool = false, capabilities: String = #"["chat"]"#) -> String {
  """
  {"id":"\(id)","name":"Helper","slug":"helper-slug","caption":"Specialist","image":null,"createdAt":"\(rosterTimestamp)","updatedAt":"\(rosterTimestamp)","archivedAt":\(archived ? "\"" + rosterTimestamp + "\"" : "null"),"isWhitelisted":false,"priority":0,"baseURL":"\(endpoint)","capabilities":\(capabilities),"vendor":{"id":"vendor","createdAt":"\(rosterTimestamp)","updatedAt":"\(rosterTimestamp)","name":"Vendor","slug":"vendor","logos":{"light":null,"dark":null}}}
  """
}

private let assistantFixture = """
{"id":"bot","userId":"me","name":"  ","avatarSeed":null,"personalityTone":null,"personalityDetail":null,"personalityStyle":null,"status":"IDLE","runtimeVersion":null,"lastSandboxStatus":null,"memoryVersion":0,"memoryHash":null,"lastActivityAt":null,"lastTurnAt":null,"lastSucceededAt":null,"lastFailedAt":null,"consecutiveTurnFailures":0,"createdAt":"\(rosterTimestamp)","updatedAt":"\(rosterTimestamp)"}
"""

private func memberFixture(id: String, name: String) -> String {
  """
  {"id":"member-\(id)","organizationId":"org","role":"member","seatAssignedAt":null,"createdAt":"\(rosterTimestamp)","lastSeenAt":null,"user":{"id":"\(id)","name":"\(name)","email":"\(id)@example.com","image":null}}
  """
}

struct DirectRecipientRosterTests {
  @Test func rosterMatchesWebFilteringAndWorkspace() async throws {
    let transport = RosterTransport([
      "get/coworkers": (200, rosterEnvelope("[" + [
        coworkerFixture(id: "usable"),
        coworkerFixture(id: "archived", archived: true),
        coworkerFixture(id: "empty-endpoint", endpoint: " "),
        coworkerFixture(id: "tasks", capabilities: #"["tasks"]"#)
      ].joined(separator: ",") + "]")),
      "get/organizations/{id}/members": (200, rosterEnvelope("[" + [memberFixture(id: "me", name: "Me"), memberFixture(id: "peer", name: "")].joined(separator: ",") + "]")),
      "getMySokoBot": (200, rosterEnvelope(#"{"sokoBot":\#(assistantFixture)}"#))
    ])
    let client = try Client.connecting(to: #require(URL(string: "https://example.com")), transport: transport)
    let roster = try await ChatService().directRecipients(client: client, currentUserId: "me", organizationId: "org", organizationSlug: "team")
    #expect(roster.targets.map(\.id) == [.human("peer"), .coworker("usable"), .sokoBot("bot")])
    #expect(roster.targets.first?.name == "peer@example.com")
    #expect(roster.targets.last?.name == "Personal assistant")
    #expect(!roster.membersLoadFailed)
    let requests = await transport.requests
    let header = try #require(HTTPField.Name("X-Organization-Slug"))
    #expect(requests.filter { $0.path?.contains("/organizations/") != true }.allSatisfy { $0.headerFields[header] == "team" })
    #expect(requests.contains { $0.path?.contains("scope=available") == true && $0.path?.contains("capability=chat") == true })
    let selection = DirectConversationSelection(hasOrganization: true)
    #expect(roster.candidates(query: "  HELPER-SLUG ", selection: selection).map(\.id) == [.coworker("usable")])
    #expect(roster.candidates(query: "@example.com", selection: selection).map(\.id) == [.human("peer")])
  }

  @Test func partialMembersFailureKeepsAIAndPersonalSkipsMembers() async throws {
    for organization in [nil, "org"] {
      let transport = RosterTransport([
        "get/coworkers": (200, rosterEnvelope("[\(coworkerFixture(id: "ai"))]")),
        "get/organizations/{id}/members": (500, #"{"error":"Internal Server Error","message":"Unavailable","meta":{"timestamp":"2026-01-01T00:00:00.000Z","requestId":"test","path":"/organizations/org/members","method":"GET"}}"#),
        "getMySokoBot": (503, #"{"message":"Unavailable"}"#)
      ])
      let roster = try await ChatService().directRecipients(
        client: Client.connecting(to: #require(URL(string: "https://example.com")), transport: transport),
        currentUserId: "me", organizationId: organization, organizationSlug: nil
      )
      #expect(roster.targets.map(\.id) == [.coworker("ai")])
      #expect(roster.membersLoadFailed == (organization != nil))
      let requests = await transport.requests
      #expect(requests.count == (organization == nil ? 2 : 3))
      #expect(requests.allSatisfy { $0.headerFields[HTTPField.Name("X-Organization-Slug")!] == nil })
    }
  }

  @Test func coworkersFailureIsNotAnEmptyRoster() async throws {
    let transport = RosterTransport(["get/coworkers": (503, #"{"message":"Try again"}"#)])
    do {
      _ = try await ChatService().directRecipients(
        client: Client.connecting(to: #require(URL(string: "https://example.com")), transport: transport),
        currentUserId: "me", organizationId: nil, organizationSlug: nil
      )
      Issue.record("Expected failure")
    } catch {
      #expect(error is ChatServiceError)
    }
  }
}
