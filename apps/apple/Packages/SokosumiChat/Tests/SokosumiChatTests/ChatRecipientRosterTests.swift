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
  private(set) var requests: [HTTPRequest] = []
  private(set) var patchBodies: [Data] = []

  init(_ replies: [String: (Int, String)]) {
    self.replies = replies
  }

  func recoverMembers(_ body: String) {
    replies["get/organizations/{id}/members"] = (200, body)
  }

  func send(_ request: HTTPRequest, body: HTTPBody?, baseURL _: URL, operationID: String) async throws -> (HTTPResponse, HTTPBody?) {
    requests.append(request)
    if request.method == .patch, let body {
      try await patchBodies.append(Data(Array(collecting: body, upTo: 1_000_000)))
    }
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

private func editableRoomFixture() throws -> Components.Schemas.ChatRoom {
  try Components.Schemas.ChatRoom(
    id: "channel", organizationId: "org", name: "Team", slug: "team", kind: .channel, isSelfDirect: false, isGroupDirect: false,
    discoverability: ._private, createdByUserId: "me", createdAt: Date(timeIntervalSince1970: 1_767_225_600), updatedAt: Date(timeIntervalSince1970: 1_767_225_600),
    unreadCount: 0, unreadMentionCount: 0, markedUnread: false, myAccess: .member,
    userMembers: [.init(id: "me", name: "Me", email: "me@example.com", presence: .online),
                  .init(id: "peer", name: "Peer", email: "peer@example.com", presence: .offline),
                  .init(id: "guest", name: "Guest", email: "guest@example.com", presence: .offline,
                        access: .init(value1: .guest, value2: .init(unvalidatedValue: "guest")))],
    coworkerMembers: [.init(id: "ai", name: "Helper", slug: "helper", presence: .online)], sokoBotMembers: []
  )
}

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

  @MainActor
  @Test(arguments: ["member", "owner"])
  func failedMemberPageSaveAndRecoveredSelectionUseEncodedPatch(role: String) async throws {
    let room = try editableRoomFixture()
    let encoder = JSONEncoder()
    encoder.dateEncodingStrategy = .custom { date, encoder in
      let formatter = ISO8601DateFormatter()
      formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
      var container = encoder.singleValueContainer()
      try container.encode(formatter.string(from: date))
    }
    let encodedRoom = try #require(String(data: encoder.encode(room), encoding: .utf8))
    let response = rosterEnvelope(encodedRoom)
    let membership = #"{"id":"member-me","userId":"me","organizationId":"org","role":"\#(role)","seatAssignedAt":null,"createdAt":"\#(rosterTimestamp)"}"#
    let transport = RosterTransport([
      "get/coworkers": (200, rosterEnvelope("[\(coworkerFixture(id: "ai"))]")),
      "get/organizations/{id}/members": (500, #"{"error":"Internal Server Error","message":"Unavailable","meta":{"timestamp":"2026-01-01T00:00:00.000Z","requestId":"test","path":"/organizations/org/members","method":"GET"}}"#),
      "getMySokoBot": (200, rosterEnvelope(#"{"sokoBot":\#(assistantFixture)}"#)),
      "get/users/{id}/organizations/{organizationId}/member": (200, rosterEnvelope(membership)),
      "patch/chats/rooms/{id}": (200, response)
    ])
    let client = try Client.connecting(to: #require(URL(string: "https://example.com")), transport: transport)
    let model = ChannelEditing(room: room)
    await model.load { try await ChatService().channelRoster(client: client, organizationId: "org", organizationSlug: "team") }
    #expect(model.membersLoadFailed && model.canSave)
    model.draft.recipients.remove(.coworker("ai"))
    model.draft.recipients.insert(.sokoBot("bot"))
    let submit: (ChannelEditDraft, ChannelEditPermissions) async throws -> Bool = { draft, permissions in
      _ = try await ChatService().updateRoom(client: client, roomId: room.id,
                                             request: draft.updateRequest(permissions: permissions, currentUserId: "me", currentRoom: room), organizationSlug: "team")
      return true
    }
    #expect(await model.save(using: submit))
    #expect(model.errorMessage == nil)
    let failedData = try #require(await transport.patchBodies.first)
    let failedBody = try #require(JSONSerialization.jsonObject(with: failedData) as? [String: Any])
    #expect(failedBody["memberUserIds"] as? [String] == ["me", "peer"])
    #expect((failedBody["coworkerIds"] as? [String])?.isEmpty == true)
    #expect(failedBody["sokoBotIds"] as? [String] == ["bot"])
    #expect((failedBody["name"] != nil) == (role == "owner"))
    await transport.recoverMembers(rosterEnvelope("[" + [memberFixture(id: "me", name: "Me"), memberFixture(id: "peer", name: "Peer"),
                                                         memberFixture(id: "new", name: "New")].joined(separator: ",") + "]"))
    await model.load { try await ChatService().channelRoster(client: client, organizationId: "org", organizationSlug: "team") }
    #expect(!model.membersLoadFailed)
    #expect(model.draft.recipients == [.human("me"), .human("peer"), .sokoBot("bot")])
    model.draft.recipients.remove(.human("peer"))
    model.draft.recipients.insert(.human("new"))
    #expect(await model.save(using: submit))
    #expect(model.errorMessage == nil)
    let recoveredData = try #require(await transport.patchBodies.last)
    let recoveredBody = try #require(JSONSerialization.jsonObject(with: recoveredData) as? [String: Any])
    #expect(recoveredBody["memberUserIds"] as? [String] == ["me", "new"])
    #expect(recoveredBody["sokoBotIds"] as? [String] == ["bot"])
  }

  @MainActor
  @Test(arguments: ["get/coworkers", "get/users/{id}/organizations/{organizationId}/member"])
  func channelRosterDependencyFailureStillBlocksSave(operation: String) async throws {
    let membership = #"{"id":"member-me","userId":"me","organizationId":"org","role":"owner","seatAssignedAt":null,"createdAt":"\#(rosterTimestamp)"}"#
    var replies: [String: (Int, String)] = [
      "get/coworkers": (200, rosterEnvelope("[]")),
      "get/organizations/{id}/members": (200, rosterEnvelope("[]")),
      "getMySokoBot": (503, "{}"),
      "get/users/{id}/organizations/{organizationId}/member": (200, rosterEnvelope(membership))
    ]
    replies[operation] = (500, #"{"error":"Internal Server Error","message":"Unavailable","meta":{"timestamp":"2026-01-01T00:00:00.000Z","requestId":"test","path":"/organizations/org/members","method":"GET"}}"#)
    let transport = RosterTransport(replies)
    let client = try Client.connecting(to: #require(URL(string: "https://example.com")), transport: transport)
    let room = Components.Schemas.ChatRoom(id: "channel", organizationId: "org", name: "Team", kind: .channel,
                                           isSelfDirect: false, isGroupDirect: false, createdByUserId: "me", createdAt: .distantPast, updatedAt: .distantPast,
                                           unreadCount: 0, unreadMentionCount: 0, markedUnread: false, myAccess: .member,
                                           userMembers: [], coworkerMembers: [], sokoBotMembers: [])
    let model = ChannelEditing(room: room)
    await model.load { try await ChatService().channelRoster(client: client, organizationId: "org", organizationSlug: "team") }
    #expect(model.roster == nil)
    #expect(model.errorMessage != nil)
    #expect(!model.canSave)
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
