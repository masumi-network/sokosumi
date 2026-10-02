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
  var replies: [String: (Int, String)]
  let roleFailure: (any Error)?
  private(set) var requests: [HTTPRequest] = []
  private(set) var bodies: [Data] = []

  init(_ replies: [String: (Int, String)], roleFailure: (any Error)? = nil) {
    self.replies = replies
    self.roleFailure = roleFailure
  }

  func recoverMembers(_ body: String) {
    replies["get/organizations/{id}/members"] = (200, body)
  }

  func recoverRole(_ body: String) {
    replies["get/users/{id}/organizations/{organizationId}/member"] = (200, body)
  }

  func send(_ request: HTTPRequest, body: HTTPBody?, baseURL _: URL, operationID: String) async throws -> (HTTPResponse, HTTPBody?) {
    requests.append(request)
    if operationID == "get/users/{id}/organizations/{organizationId}/member", let roleFailure {
      throw roleFailure
    }
    if let body {
      try await bodies.append(Data(Array(collecting: body, upTo: 1_000_000)))
    }
    let reply = replies[operationID] ?? (500, #"{"error":"Internal Server Error","message":"Unavailable","meta":{"timestamp":"2026-01-01T00:00:00.000Z","requestId":"test","path":"/organizations/org/members","method":"GET"}}"#)
    // Status 0 stands for no response at all.
    if reply.0 == 0 {
      throw URLError(.notConnectedToInternet)
    }
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

private func editableRoomFixture() -> Components.Schemas.ChatRoom {
  Components.Schemas.ChatRoom(
    id: "channel", organizationId: "org", name: "Team", slug: "team", kind: .channel, isSelfDirect: false, isGroupDirect: false,
    discoverability: ._private, createdByUserId: "me", createdAt: Date(timeIntervalSince1970: 1_767_225_600), updatedAt: Date(timeIntervalSince1970: 1_767_225_600),
    unreadCount: 0, unreadMentionCount: 0, markedUnread: false, myAccess: .init(value1: .member, value2: "member"),
    userMembers: [.init(id: "me", name: "Me", email: "me@example.com", presence: .online),
                  .init(id: "peer", name: "Peer", email: "peer@example.com", presence: .offline),
                  .init(id: "guest", name: "Guest", email: "guest@example.com", presence: .offline,
                        access: .guest)],
    coworkerMembers: [.init(id: "ai", name: "Helper", slug: "helper", presence: .online)], sokoBotMembers: []
  )
}

private func roomEnvelope(_ room: Components.Schemas.ChatRoom) throws -> String {
  let encoder = JSONEncoder()
  encoder.dateEncodingStrategy = .custom { date, encoder in
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    var container = encoder.singleValueContainer()
    try container.encode(formatter.string(from: date))
  }
  return try rosterEnvelope(#require(String(data: encoder.encode(room), encoding: .utf8)))
}

func errorEnvelope(_ error: String, message: String) -> String {
  #"{"error":"\#(error)","message":"\#(message)","meta":{"timestamp":"\#(rosterTimestamp)","requestId":"test","path":"/users/me/organizations/org/member","method":"GET"}}"#
}

/// Every way the caller's own membership read can fail short of a 401 (web catches all of them). Shared with the archived-list tests.
let roleReadFailures: [(Int, String)] = [
  (403, errorEnvelope("Forbidden", message: "Forbidden")),
  (500, errorEnvelope("Internal Server Error", message: "Unavailable")),
  (503, #"{"message":"Try again"}"#),
  (0, "")
]

struct ChatRecipientRosterTests {
  @Test(arguments: ["member", "admin", "owner"])
  func channelRosterIncludesCreatorAndRole(role: String) async throws {
    let member = #"{"id":"member-me","userId":"me","organizationId":"org","role":"\#(role)","seatAssignedAt":null,"createdAt":"\#(rosterTimestamp)"}"#
    let transport = RosterTransport([
      "get/coworkers": (200, rosterEnvelope("[]")),
      "get/organizations/{id}/members": (200, rosterEnvelope("[\(memberFixture(id: "me", name: "Me"))]")),
      "getMySokoBot": (503, "{}"),
      "get/users/{id}/organizations/{organizationId}/member": (200, rosterEnvelope(member))
    ])
    let client = try Client.connecting(to: #require(URL(string: "https://example.com")), transport: transport)
    let roster = try await ChatService().channelRoster(client: client, organizationId: "org", organizationSlug: "team")
    #expect(roster.recipients.targets.map(\.id) == [.human("me")])
    #expect(roster.isOwnerOrAdmin == (role != "member"))
  }

  /// The Add picker on a failed member page (web `participant-checkboxes.tsx`): People is missing, the assistant still
  /// adds through `POST .../members`, and a recovered page lists only people outside the Channel.
  @MainActor
  @Test func failedMemberPageStillAddsAgentsAndRecoveredPageListsNonMembers() async throws {
    let room = editableRoomFixture()
    let membership = #"{"id":"member-me","userId":"me","organizationId":"org","role":"member","seatAssignedAt":null,"createdAt":"\#(rosterTimestamp)"}"#
    let transport = try RosterTransport([
      "get/coworkers": (200, rosterEnvelope("[\(coworkerFixture(id: "ai"))]")),
      "get/organizations/{id}/members": (500, #"{"error":"Internal Server Error","message":"Unavailable","meta":{"timestamp":"2026-01-01T00:00:00.000Z","requestId":"test","path":"/organizations/org/members","method":"GET"}}"#),
      "getMySokoBot": (200, rosterEnvelope(#"{"sokoBot":\#(assistantFixture)}"#)),
      "get/users/{id}/organizations/{organizationId}/member": (200, rosterEnvelope(membership)),
      "post/chats/rooms/{id}/members": (200, roomEnvelope(room))
    ])
    let client = try Client.connecting(to: #require(URL(string: "https://example.com")), transport: transport)
    let model = ChannelMemberAddition(room: room)
    await model.load { try await ChatService().channelRoster(client: client, organizationId: "org", organizationSlug: "team").recipients }
    #expect(model.membersLoadFailed)
    #expect(model.sections.map(\.id) == [.assistant], "The Helper Coworker is already in the Channel")
    model.selection = [.sokoBot("bot")]
    #expect(await model.add { recipients in
      _ = try await ChatService().addChannelMembers(client: client, roomId: room.id, recipients: recipients, organizationSlug: "team")
      return true
    })
    let data = try #require(await transport.bodies.first)
    let body = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
    #expect(Set(body.keys) == ["sokoBotIds"])
    #expect(body["sokoBotIds"] as? [String] == ["bot"])
    await transport.recoverMembers(rosterEnvelope("[" + [memberFixture(id: "me", name: "Me"), memberFixture(id: "peer", name: "Peer"),
                                                         memberFixture(id: "new", name: "New")].joined(separator: ",") + "]"))
    await model.load { try await ChatService().channelRoster(client: client, organizationId: "org", organizationSlug: "team").recipients }
    #expect(!model.membersLoadFailed)
    #expect(model.sections.first { $0.id == .people }?.targets.map(\.id) == [.human("new")])
  }

  @MainActor
  @Test func coworkerFailureStillBlocksAdd() async throws {
    let transport = RosterTransport([
      "get/coworkers": (500, #"{"error":"Internal Server Error","message":"Unavailable","meta":{"timestamp":"2026-01-01T00:00:00.000Z","requestId":"test","path":"/coworkers","method":"GET"}}"#),
      "get/organizations/{id}/members": (200, rosterEnvelope("[]")),
      "getMySokoBot": (503, "{}")
    ])
    let client = try Client.connecting(to: #require(URL(string: "https://example.com")), transport: transport)
    let model = ChannelMemberAddition(room: editableRoomFixture())
    await model.load { try await ChatService().chatRecipients(client: client, organizationId: "org", organizationSlug: "team") }
    #expect(model.roster == nil)
    #expect(model.errorMessage != nil)
    model.selection = [.human("new")]
    #expect(!model.canAdd)
  }

  /// Web's create dialog loads the role inside the same `Promise.all` as the roster and shows its member notice when
  /// either fails, so creating stays blocked; only the edit sheet falls back.
  @MainActor
  @Test(arguments: roleReadFailures)
  func roleReadFailureBlocksCreate(status: Int, body: String) async throws {
    let transport = RosterTransport([
      "get/coworkers": (200, rosterEnvelope("[]")),
      "get/organizations/{id}/members": (200, rosterEnvelope("[\(memberFixture(id: "me", name: "Me"))]")),
      "getMySokoBot": (503, "{}"),
      "get/users/{id}/organizations/{organizationId}/member": (status, body)
    ])
    let client = try Client.connecting(to: #require(URL(string: "https://example.com")), transport: transport)
    let model = ChannelCreation()
    model.draft.setSlug("team")
    await model.checkSlug { _ in true }
    await model.load { try await ChatService().channelRoster(client: client, organizationId: "org", organizationSlug: "team") }
    #expect(model.participantsUnavailable)
    #expect(model.errorMessage == nil)
    #expect(!model.canAdvance)
    model.advance()
    #expect(model.step == .details)
    let membership = #"{"id":"member-me","userId":"me","organizationId":"org","role":"admin","seatAssignedAt":null,"createdAt":"\#(rosterTimestamp)"}"#
    await transport.recoverRole(rosterEnvelope(membership))
    await model.load { try await ChatService().channelRoster(client: client, organizationId: "org", organizationSlug: "team") }
    #expect(!model.participantsUnavailable && model.canAdvance)
    model.advance()
    #expect(model.step == .participants)
    await model.load { .init(recipients: .init(targets: []), isOwnerOrAdmin: true, roleLoadFailed: true) }
    #expect(model.roster?.isOwnerOrAdmin == false)
    #expect(await model.create { _, _ in
      Issue.record("A failed role reload must block direct creation")
      return true
    } == false)
  }

  /// A 401 is the session ending, not a missing role: it still fails the roster so the coordinator signs out.
  @Test func roleReadUnauthorizedStillThrows() async throws {
    let transport = RosterTransport([
      "get/coworkers": (200, rosterEnvelope("[]")),
      "get/organizations/{id}/members": (200, rosterEnvelope("[]")),
      "getMySokoBot": (503, "{}"),
      "get/users/{id}/organizations/{organizationId}/member": (401, errorEnvelope("Unauthorized", message: "Session expired"))
    ])
    let client = try Client.connecting(to: #require(URL(string: "https://example.com")), transport: transport)
    await #expect(throws: ChatServiceError.unauthorized("Session expired")) {
      _ = try await ChatService().channelRoster(client: client, organizationId: "org", organizationSlug: "team")
    }
  }

  @Test(arguments: ["{}", "", "not JSON"])
  func roleReadMalformedUnauthorizedStillThrows(body: String) async throws {
    let transport = RosterTransport([
      "get/coworkers": (200, rosterEnvelope("[]")),
      "get/organizations/{id}/members": (200, rosterEnvelope("[]")),
      "getMySokoBot": (503, "{}"),
      "get/users/{id}/organizations/{organizationId}/member": (401, body)
    ])
    let client = try Client.connecting(to: #require(URL(string: "https://example.com")), transport: transport)
    await #expect(throws: ChatServiceError.unauthorized("Sign in required.")) {
      _ = try await ChatService().channelRoster(client: client, organizationId: "org", organizationSlug: "team")
    }
  }

  /// The generated client wraps transport errors even when the caller's task was not cancelled.
  @Test(arguments: [false, true])
  func roleReadTransportCancellationStillThrows(urlCancellation: Bool) async throws {
    let failure: any Error = urlCancellation ? URLError(.cancelled) : CancellationError()
    let transport = RosterTransport([
      "get/coworkers": (200, rosterEnvelope("[]")),
      "get/organizations/{id}/members": (200, rosterEnvelope("[]")),
      "getMySokoBot": (503, "{}")
    ], roleFailure: failure)
    let client = try Client.connecting(to: #require(URL(string: "https://example.com")), transport: transport)
    #expect(!Task.isCancelled)
    await #expect(throws: CancellationError.self) {
      _ = try await ChatService().channelRoster(client: client, organizationId: "org", organizationSlug: "team")
    }
  }

  @Test func roleReadCancelledTaskStillThrows() async throws {
    let transport = RosterTransport([
      "get/coworkers": (200, rosterEnvelope("[]")),
      "get/organizations/{id}/members": (200, rosterEnvelope("[]")),
      "getMySokoBot": (503, "{}"),
      "get/users/{id}/organizations/{organizationId}/member": (0, "")
    ])
    let client = try Client.connecting(to: #require(URL(string: "https://example.com")), transport: transport)
    let task = Task {
      withUnsafeCurrentTask { $0?.cancel() }
      return try await ChatService().channelRoster(client: client, organizationId: "org", organizationSlug: "team")
    }
    await #expect(throws: CancellationError.self) { try await task.value }
  }

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
    #expect(roster.sections(query: "  HELPER-SLUG ").flatMap(\.targets).map(\.id) == [.coworker("usable")])
    #expect(roster.sections(query: "@example.com").flatMap(\.targets).map(\.id) == [.human("peer")])
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
