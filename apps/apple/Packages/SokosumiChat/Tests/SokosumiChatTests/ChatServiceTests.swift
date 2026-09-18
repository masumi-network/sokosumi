import CoreAPI
import Foundation
import HTTPTypes
import OpenAPIRuntime
import SokosumiChat
import Testing

private let timestamp = "2026-01-01T00:00:00.000Z"

private func accessBody(gate: String) -> String {
  """
  {"data":{"gate":"\(gate)","hasPersonalWorkspace":true,"hasOrganizationMembership":false,"hasPendingOrganizationInvites":false},"meta":{"timestamp":"\(timestamp)","requestId":"req-1"}}
  """
}

private func roomJSON(
  id: String,
  name: String,
  kind: String,
  unreadCount: Int,
  unreadMentionCount: Int
) -> String {
  """
  {"id":"\(id)","organizationId":null,"organizationName":null,"name":"\(name)","slug":null,"kind":"\(kind)","isSelfDirect":false,"directKey":null,"topic":null,"discoverability":null,"createdByUserId":"user_1","createdAt":"\(timestamp)","updatedAt":"\(timestamp)","unreadCount":\(unreadCount),"unreadMentionCount":\(unreadMentionCount),"starredAt":null,"pinnedMessageCount":0,"mutedAt":null,"markedUnread":false,"myAccess":"member","peerInActiveOrganization":false,"userMembers":[],"coworkerMembers":[],"sokoBotMembers":[]}
  """
}

private func roomsPageBody(rooms: [String], nextCursor: String?) -> String {
  let cursorJSON = nextCursor.map { "\"\($0)\"" } ?? "null"
  return """
  {"data":[\(rooms.joined(separator: ","))],"meta":{"timestamp":"\(timestamp)","requestId":"req-1","pagination":{"cursor":null,"limit":100,"total":\(rooms.count),"nextCursor":\(cursorJSON)}}}
  """
}

private final class ScriptedTransport: ClientTransport, @unchecked Sendable {
  struct Recorded {
    var operationID: String
    var request: HTTPRequest
  }

  private(set) var requests: [Recorded] = []
  private(set) var bodies: [Data] = []
  private var responses: [(Int, String)]

  init(_ responses: [(Int, String)]) {
    self.responses = responses
  }

  func send(
    _ request: HTTPRequest,
    body: HTTPBody?,
    baseURL _: URL,
    operationID: String
  ) async throws -> (HTTPResponse, HTTPBody?) {
    requests.append(.init(operationID: operationID, request: request))
    if let body, let bytes = try? await Array(collecting: body, upTo: 1_000_000) {
      bodies.append(Data(bytes))
    }
    guard !responses.isEmpty else {
      Issue.record("unexpected request \(operationID): no stubbed response left")
      return (HTTPResponse(status: .internalServerError), HTTPBody("{}"))
    }
    let next = responses.removeFirst()
    return (HTTPResponse(status: HTTPResponse.Status(code: next.0)), HTTPBody(next.1))
  }
}

private func orgSlugHeader(_ request: HTTPRequest) -> String? {
  guard let name = HTTPField.Name("X-Organization-Slug") else { return nil }
  return request.headerFields[name]
}

private func requestQuery(_ request: HTTPRequest) -> String {
  guard let path = request.path, let qIndex = path.firstIndex(of: "?") else { return "" }
  return String(path[path.index(after: qIndex)...])
}

private func makeClient(_ transport: ScriptedTransport) throws -> Client {
  try Client.connecting(to: #require(URL(string: "https://core.example/v1")), transport: transport)
}

struct ChatServiceTests {
  @Test func discoverableChannelsWalkPagesAndUseOrganizationSearch() async throws {
    func channel(_ id: String) -> String {
      "{\"id\":\"\(id)\",\"name\":\"Team\",\"slug\":\"team\",\"topic\":null,\"discoverability\":\"public\",\"memberCount\":3,\"createdByUserId\":\"me\",\"createdAt\":\"\(timestamp)\",\"updatedAt\":\"\(timestamp)\"}"
    }
    let transport = ScriptedTransport([
      (200, roomsPageBody(rooms: [channel("one")], nextCursor: "next")),
      (200, roomsPageBody(rooms: [channel("two")], nextCursor: nil))
    ])
    let result = try await ChatService().discoverableChannels(client: makeClient(transport), query: "  team  ", organizationSlug: "org")
    #expect(result.map(\.id) == ["one", "two"])
    #expect(transport.requests.allSatisfy { orgSlugHeader($0.request) == "org" })
    #expect(transport.requests.allSatisfy { requestQuery($0.request).contains("q=team") && requestQuery($0.request).contains("limit=100") })
    #expect(requestQuery(transport.requests[1].request).contains("cursor=next"))
  }

  @Test func joinChannelUsesSelfMembershipEndpointAndPreservesFailure() async throws {
    let room = roomJSON(id: "channel", name: "Team", kind: "channel", unreadCount: 0, unreadMentionCount: 0)
    let response = "{\"data\":\(room),\"meta\":{\"timestamp\":\"\(timestamp)\",\"requestId\":\"req\"}}"
    let error = "{\"error\":\"Not Found\",\"message\":\"Room not found\",\"meta\":{\"timestamp\":\"\(timestamp)\",\"requestId\":\"req\",\"path\":\"/chats/rooms/channel/members/me\",\"method\":\"POST\"}}"
    let transport = ScriptedTransport([(200, response), (404, error)])
    let client = try makeClient(transport)
    #expect(try await ChatService().joinChannel(client: client, roomId: "channel", organizationSlug: "org").id == "channel")
    #expect(transport.requests[0].request.path == "/chats/rooms/channel/members/me")
    #expect(orgSlugHeader(transport.requests[0].request) == "org")
    await #expect(throws: ChatServiceError.unprocessable(statusCode: 404, message: "Room not found")) {
      try await ChatService().joinChannel(client: client, roomId: "channel", organizationSlug: "org")
    }
  }

  @Test func channelCreationUsesMixedParticipantsAndMapsSlugConflict() async throws {
    let room = roomJSON(id: "channel", name: "Team", kind: "channel", unreadCount: 0, unreadMentionCount: 0)
    let response = "{\"data\":\(room),\"meta\":{\"timestamp\":\"\(timestamp)\",\"requestId\":\"request\"}}"
    let conflict = "{\"error\":\"Conflict\",\"message\":\"Taken\",\"kind\":\"channel_slug_taken\",\"meta\":{\"timestamp\":\"\(timestamp)\",\"requestId\":\"request\",\"path\":\"/chats/rooms\",\"method\":\"POST\"}}"
    let transport = ScriptedTransport([(201, response), (409, conflict)])
    let client = try makeClient(transport)
    var draft = ChannelDraft()
    draft.setSlug("team-")
    draft.setTopic(" topic ")
    draft.addAllMembers = false
    draft.visibility = .private
    draft.recipients = [.human("peer"), .coworker("agent")]
    let roster = ChatRecipientRoster(targets: [.init(id: .human("peer"), name: "Peer"), .init(id: .coworker("agent"), name: "Agent")])
    let result = try await ChatService().createChannel(client: client, draft: draft, roster: roster, currentUserId: "me", organizationSlug: "team")
    #expect(result.id == "channel")
    let body = try #require(JSONSerialization.jsonObject(with: transport.bodies[0]) as? [String: Any])
    #expect(body["memberUserIds"] as? [String] == ["me", "peer"])
    #expect(body["coworkerIds"] as? [String] == ["agent"])
    #expect(body["slug"] as? String == "team")
    #expect(body["topic"] as? String == "topic")
    #expect(body["discoverability"] as? String == "private")
    #expect(try orgSlugHeader(#require(transport.requests.first).request) == "team")
    await #expect(throws: ChannelCreationError.slugTaken) {
      try await ChatService().createChannel(client: client, draft: draft, roster: roster, currentUserId: "me", organizationSlug: "team")
    }
  }

  @Test(arguments: [false, true]) func channelUpdateSendsSettingsOnlyForManagers(managesSettings: Bool) async throws {
    let room = roomJSON(id: "channel", name: "Team", kind: "channel", unreadCount: 0, unreadMentionCount: 0)
    let response = "{\"data\":\(room),\"meta\":{\"timestamp\":\"\(timestamp)\",\"requestId\":\"request\"}}"
    let forbidden = "{\"error\":\"Forbidden\",\"message\":\"Guests cannot update channel settings or roster.\",\"meta\":{\"timestamp\":\"\(timestamp)\",\"requestId\":\"request\",\"path\":\"/chats/rooms/channel\",\"method\":\"PATCH\"}}"
    let transport = ScriptedTransport([(200, response), (403, forbidden)])
    let client = try makeClient(transport)
    var draft = ChannelEditDraft(room: .init(
      id: "channel", organizationId: "org", name: "Team", slug: "team", kind: .channel, isSelfDirect: false, topic: nil, discoverability: ._private,
      createdByUserId: "me", createdAt: .distantPast, updatedAt: .distantPast, unreadCount: 0, unreadMentionCount: 0,
      markedUnread: false, myAccess: .member, userMembers: [], coworkerMembers: [], sokoBotMembers: []
    ))
    draft.setName(" Renamed ")
    draft.setTopic("  ")
    draft.visibility = .external
    draft.recipients = [.human("peer"), .coworker("agent"), .sokoBot("bot")]
    let permissions = ChannelEditPermissions(canEditMembers: true, canManageSettings: managesSettings)
    let update = draft.updateRequest(permissions: permissions, currentUserId: "me")
    let result = try await ChatService().updateChannel(client: client, roomId: "channel", request: update, organizationSlug: "team")
    #expect(result.id == "channel")
    let request = try #require(transport.requests.first).request
    #expect(request.method == .patch)
    #expect(request.path == "/chats/rooms/channel")
    #expect(orgSlugHeader(request) == "team")
    let body = try #require(JSONSerialization.jsonObject(with: transport.bodies[0]) as? [String: Any])
    #expect(body["memberUserIds"] as? [String] == ["me", "peer"])
    #expect(body["coworkerIds"] as? [String] == ["agent"])
    #expect(body["sokoBotIds"] as? [String] == ["bot"])
    #expect(body["name"] as? String == (managesSettings ? "Renamed" : nil))
    #expect(body["topic"] as? String == (managesSettings ? "" : nil))
    #expect(body["discoverability"] as? String == (managesSettings ? "external" : nil))
    #expect(body["slug"] == nil)
    await #expect(throws: ChatServiceError.unprocessable(statusCode: 403, message: "Guests cannot update channel settings or roster.")) {
      try await ChatService().updateChannel(client: client, roomId: "channel", request: update, organizationSlug: "team")
    }
  }

  @Test func channelLifecycleUsesCoreRoutesAndSurfacesCoreMessages() async throws {
    func error(_ status: String, _ message: String) -> String {
      "{\"error\":\"\(status)\",\"message\":\"\(message)\",\"meta\":{\"timestamp\":\"\(timestamp)\",\"requestId\":\"req\",\"path\":\"/chats/rooms/channel\",\"method\":\"POST\"}}"
    }
    let room = roomJSON(id: "channel", name: "Team", kind: "channel", unreadCount: 0, unreadMentionCount: 0)
    let transport = ScriptedTransport([
      (200, "{\"data\":{\"id\":\"channel\",\"remainingUserMemberCount\":2},\"meta\":{\"timestamp\":\"\(timestamp)\",\"requestId\":\"req\"}}"),
      (400, error("Bad Request", "You are the last member of this room. Ask an organization owner or admin to archive it.")),
      (200, "{\"data\":{\"id\":\"channel\",\"archivedAt\":\"\(timestamp)\"},\"meta\":{\"timestamp\":\"\(timestamp)\",\"requestId\":\"req\"}}"),
      (403, error("Forbidden", "Only an organization owner or admin can archive this room.")),
      (200, "{\"data\":\(room),\"meta\":{\"timestamp\":\"\(timestamp)\",\"requestId\":\"req\"}}"),
      (400, error("Bad Request", "Room is not archived.")),
      (204, ""),
      (403, error("Forbidden", "Only an organization owner or admin can permanently delete this room."))
    ])
    let client = try makeClient(transport)
    let service = ChatService()
    try await service.leaveChannel(client: client, roomId: "channel", organizationSlug: nil)
    await #expect(throws: ChatServiceError.unprocessable(statusCode: 400, message: "You are the last member of this room. Ask an organization owner or admin to archive it.")) {
      try await service.leaveChannel(client: client, roomId: "channel", organizationSlug: "team")
    }
    try await service.archiveChannel(client: client, roomId: "channel", organizationSlug: "team")
    await #expect(throws: ChatServiceError.unprocessable(statusCode: 403, message: "Only an organization owner or admin can archive this room.")) {
      try await service.archiveChannel(client: client, roomId: "channel", organizationSlug: "team")
    }
    #expect(try await service.restoreChannel(client: client, roomId: "channel", organizationSlug: "team").id == "channel")
    await #expect(throws: ChatServiceError.unprocessable(statusCode: 400, message: "Room is not archived.")) {
      try await service.restoreChannel(client: client, roomId: "channel", organizationSlug: "team")
    }
    try await service.deleteChannel(client: client, roomId: "channel", organizationSlug: "team")
    await #expect(throws: ChatServiceError.unprocessable(statusCode: 403, message: "Only an organization owner or admin can permanently delete this room.")) {
      try await service.deleteChannel(client: client, roomId: "channel", organizationSlug: "team")
    }
    let routes = transport.requests.map { "\($0.request.method.rawValue) \($0.request.path ?? "")" }
    #expect(routes == [
      "DELETE /chats/rooms/channel/members/me", "DELETE /chats/rooms/channel/members/me",
      "POST /chats/rooms/channel/archive", "POST /chats/rooms/channel/archive",
      "POST /chats/rooms/channel/restore", "POST /chats/rooms/channel/restore",
      "DELETE /chats/rooms/channel", "DELETE /chats/rooms/channel"
    ])
    // Personal-workspace leave (guest/matched rooms) omits the organization header.
    #expect(transport.requests.map { orgSlugHeader($0.request) } == [nil, "team", "team", "team", "team", "team", "team", "team"])
  }

  @Test(arguments: ["member", "admin", "owner"])
  func archivedChannelsListArchivedChannelsWithDeleteRole(role: String) async throws {
    let member = "{\"data\":{\"id\":\"member-me\",\"userId\":\"me\",\"organizationId\":\"org\",\"role\":\"\(role)\",\"seatAssignedAt\":null,\"createdAt\":\"\(timestamp)\"},\"meta\":{\"timestamp\":\"\(timestamp)\",\"requestId\":\"req\"}}"
    let transport = ScriptedTransport([
      (200, member),
      (200, roomsPageBody(rooms: [roomJSON(id: "old", name: "Old", kind: "channel", unreadCount: 0, unreadMentionCount: 0)], nextCursor: nil))
    ])
    let list = try await ChatService().archivedChannels(client: makeClient(transport), organizationId: "org", organizationSlug: "team")
    #expect(list.rooms.map(\.id) == ["old"])
    #expect(list.canDelete == (role != "member"))
    #expect(transport.requests[0].request.path == "/users/me/organizations/org/member")
    let query = requestQuery(transport.requests[1].request)
    #expect(query.contains("status=archived") && query.contains("kind=channel"))
    #expect(orgSlugHeader(transport.requests[1].request) == "team")
  }

  @Test func channelAvailabilityUsesOrganizationAndQuery() async throws {
    let response = "{\"data\":{\"status\":\"free\"},\"meta\":{\"timestamp\":\"\(timestamp)\",\"requestId\":\"request\"}}"
    let transport = ScriptedTransport([(200, response)])
    #expect(try await ChatService().channelSlugIsAvailable(client: makeClient(transport), slug: "team-soko", organizationSlug: "team"))
    let request = try #require(transport.requests.first).request
    #expect(request.path?.contains("slug=team-soko") == true)
    #expect(orgSlugHeader(request) == "team")
  }

  @Test func participantDirectPreservesOrganizationAndPermissionFailure() async throws {
    let response = """
    {"error":"Forbidden","message":"No shared channel","meta":{"timestamp":"\(timestamp)","requestId":"request","path":"/v1/chats/rooms","method":"POST"}}
    """
    let transport = ScriptedTransport([(403, response)])
    var selection = DirectConversationSelection(hasOrganization: true)
    selection.add(.human("peer"))
    do {
      _ = try await ChatService().openDirect(client: makeClient(transport), selection: selection, organizationSlug: "team")
      Issue.record("Expected permission failure")
    } catch let ChatServiceError.unprocessable(statusCode, message) {
      #expect(statusCode == 403)
      #expect(message == "No shared channel")
    }
    #expect(try orgSlugHeader(#require(transport.requests.first).request) == "team")
  }

  @Test func participantDirectUsesCorrectRecipientAndAcceptsCreatedOrExisting() async throws {
    let room = roomJSON(id: "direct", name: "Peer", kind: "direct", unreadCount: 0, unreadMentionCount: 0)
    let response = "{\"data\":\(room),\"meta\":{\"timestamp\":\"\(timestamp)\",\"requestId\":\"request\"}}"
    let transport = ScriptedTransport([(201, response), (200, response), (201, response)])
    let client = try makeClient(transport)
    for recipient in [DirectRecipient.human("human"), .coworker("coworker"), .sokoBot("01960001-0001-7001-8001-000000000099")] {
      var selection = DirectConversationSelection(hasOrganization: false)
      selection.add(recipient)
      let result = try await ChatService().openDirect(client: client, selection: selection, organizationSlug: nil)
      #expect(result.id == "direct")
    }
    for (index, field) in ["memberUserIds", "coworkerIds", "sokoBotIds"].enumerated() {
      let body = try #require(JSONSerialization.jsonObject(with: transport.bodies[index]) as? [String: Any])
      #expect(body["kind"] as? String == "direct")
      #expect((body[field] as? [String])?.count == 1)
      #expect(body.count == 2)
      #expect(transport.requests[index].request.method == .post)
      #expect(orgSlugHeader(transport.requests[index].request) == nil)
    }
  }

  @Test func groupDirectUsesExistingCreateRoute() async throws {
    let room = roomJSON(id: "group", name: "Team", kind: "direct", unreadCount: 0, unreadMentionCount: 0)
    let response = "{\"data\":\(room),\"meta\":{\"timestamp\":\"\(timestamp)\",\"requestId\":\"request\"}}"
    let transport = ScriptedTransport([(200, response)])
    var selection = DirectConversationSelection(hasOrganization: true)
    selection.add(.human("alice"))
    selection.add(.human("bob"))
    let result = try await ChatService().openDirect(client: makeClient(transport), selection: selection, organizationSlug: "team")
    #expect(result.id == "group")
    let body = try #require(JSONSerialization.jsonObject(with: transport.bodies[0]) as? [String: Any])
    #expect(body["memberUserIds"] as? [String] == ["alice", "bob"])
    #expect(try orgSlugHeader(#require(transport.requests.first).request) == "team")
    do {
      _ = try await ChatService().openDirect(client: makeClient(transport), selection: selection, organizationSlug: nil)
      Issue.record("Expected personal group rejection")
    } catch ChatServiceError.unexpectedResponse {}
    #expect(transport.requests.count == 1)
  }

  @Test func personalRoomsOmitOrgHeader() async throws {
    let transport = ScriptedTransport([
      (200, roomsPageBody(rooms: [roomJSON(id: "550e8400-e29b-41d4-a716-446655440000", name: "general", kind: "channel", unreadCount: 2, unreadMentionCount: 1)], nextCursor: nil))
    ])
    let rooms = try await ChatService().listRooms(client: makeClient(transport), organizationSlug: nil)
    #expect(rooms.count == 1)
    #expect(rooms[0].name == "general")
    #expect(rooms[0].unreadCount == 2)
    #expect(rooms[0].unreadMentionCount == 1)
    #expect(transport.requests.count == 1)
    #expect(transport.requests[0].operationID == "get/chats/rooms")
    #expect(orgSlugHeader(transport.requests[0].request) == nil)
  }

  @Test func organizationRoomsSendSlugHeader() async throws {
    let transport = ScriptedTransport([
      (200, roomsPageBody(rooms: [roomJSON(id: "550e8400-e29b-41d4-a716-446655440001", name: "launch", kind: "channel", unreadCount: 0, unreadMentionCount: 0)], nextCursor: nil))
    ])
    let rooms = try await ChatService().listRooms(client: makeClient(transport), organizationSlug: "acme")
    #expect(rooms.count == 1)
    #expect(orgSlugHeader(transport.requests[0].request) == "acme")
  }

  @Test func repeatedCursorDoesNotAppendDuplicatePage() async throws {
    let room = roomJSON(id: "550e8400-e29b-41d4-a716-446655440010", name: "one", kind: "channel", unreadCount: 0, unreadMentionCount: 0)
    let transport = ScriptedTransport([
      (200, roomsPageBody(rooms: [room], nextCursor: "same")),
      (200, roomsPageBody(rooms: [room], nextCursor: "same"))
    ])
    let rooms = try await ChatService().listRooms(client: makeClient(transport), organizationSlug: nil)
    #expect(rooms.count == 1)
    #expect(transport.requests.count == 2)
  }

  @Test func roomListPaginationWalksNextCursor() async throws {
    let transport = ScriptedTransport([
      (200, roomsPageBody(rooms: [roomJSON(id: "550e8400-e29b-41d4-a716-446655440010", name: "one", kind: "channel", unreadCount: 1, unreadMentionCount: 0)], nextCursor: "cursor-2")),
      (200, roomsPageBody(rooms: [roomJSON(id: "550e8400-e29b-41d4-a716-446655440011", name: "two", kind: "direct", unreadCount: 0, unreadMentionCount: 3)], nextCursor: nil))
    ])
    let rooms = try await ChatService().listRooms(client: makeClient(transport), organizationSlug: "acme")
    #expect(rooms.map(\.name) == ["one", "two"])
    #expect(rooms[1].unreadMentionCount == 3)
    #expect(transport.requests.count == 2)
    #expect(transport.requests.allSatisfy { orgSlugHeader($0.request) == "acme" })
    #expect(requestQuery(transport.requests[0].request).contains("cursor=") == false)
    #expect(requestQuery(transport.requests[1].request).contains("cursor=cursor-2"))
  }

  @Test func fetchOrganizationsReturnsList() async throws {
    let transport = ScriptedTransport([
      (200, """
      {"data":[{"id":"org_1","createdAt":"\(timestamp)","name":"Acme","slug":"acme","role":"member"}],"meta":{"timestamp":"\(timestamp)","requestId":"req-1"}}
      """)
    ])
    let orgs = try await ChatService().fetchOrganizations(client: makeClient(transport))
    #expect(orgs.count == 1)
    #expect(orgs[0].slug == "acme")
    #expect(transport.requests[0].operationID == "get/users/{id}/organizations")
  }

  @Test func personalPreferredOrganizationSendsExplicitNull() async throws {
    // Core requires the key: `{}` is a 422 (defaultValidationHook), so the
    // personal switch must encode `{"organizationId":null}` explicitly.
    // Wired with the app's real middleware stack.
    let transport = ScriptedTransport([
      (200, """
      {"data":{"organizationId":null},"meta":{"timestamp":"\(timestamp)","requestId":"req-1"}}
      """)
    ])
    let client = try Client.connecting(
      to: #require(URL(string: "https://core.example/v1")),
      transport: transport,
      middlewares: [ExplicitNullPreferredOrganizationMiddleware()]
    )
    try await ChatService().setPreferredOrganization(client: client, organizationId: nil)
    #expect(transport.requests.map(\.operationID) == ["put/users/{id}/preferred-organization"])
    let body = try #require(transport.bodies.first)
    let json = try #require(JSONSerialization.jsonObject(with: body) as? [String: Any])
    #expect(json.keys.contains("organizationId"))
    #expect(json["organizationId"] is NSNull)
    // URLSession uploadTask uses this header: a stale length vs the rewritten
    // body is a protocol error and surfaces as NSURLError -1005.
    #expect(transport.requests[0].request.headerFields[.contentLength] == "\(body.count)")
  }

  @Test func organizationPreferredOrganizationKeepsId() async throws {
    // The rewrite must only fire for empty bodies: a real org id passes
    // through with its value intact.
    let transport = ScriptedTransport([
      (200, """
      {"data":{"organizationId":"org_1"},"meta":{"timestamp":"\(timestamp)","requestId":"req-1"}}
      """)
    ])
    let client = try Client.connecting(
      to: #require(URL(string: "https://core.example/v1")),
      transport: transport,
      middlewares: [ExplicitNullPreferredOrganizationMiddleware()]
    )
    try await ChatService().setPreferredOrganization(client: client, organizationId: "org_1")
    let body = try #require(transport.bodies.first)
    let json = try #require(JSONSerialization.jsonObject(with: body) as? [String: Any])
    #expect(json["organizationId"] as? String == "org_1")
  }

  @Test func documented500SurfacesFriendlyMessage() async throws {
    let transport = ScriptedTransport([(500, """
    {"error":"Internal Server Error","message":"boom","meta":{"timestamp":"\(timestamp)","requestId":"req-1","path":"/v1/users/me/preferred-organization","method":"PUT"}}
    """)])
    do {
      try await ChatService().setPreferredOrganization(client: makeClient(transport), organizationId: "org_1")
      Issue.record("expected an error")
    } catch let error as ChatServiceError {
      let message = String(describing: error)
      #expect(message.contains("500"))
      #expect(message.contains("boom"))
      #expect(!message.contains("headerFields"))
    }
  }

  @Test func undocumented422SurfacesFriendlyMessage() async throws {
    // User symptom (SOK-973 follow-up): a 422 dumped raw response headers
    // into the window. It must surface as a short message instead.
    let transport = ScriptedTransport([(422, """
    {"error":"Unprocessable Entity","message":"organizationId: Required","meta":{"timestamp":"\(timestamp)","requestId":"req-1","path":"/v1/users/me/preferred-organization","method":"PUT"}}
    """)])
    do {
      try await ChatService().setPreferredOrganization(client: makeClient(transport), organizationId: nil)
      Issue.record("expected an error")
    } catch let error as ChatServiceError {
      let message = String(describing: error)
      #expect(message.contains("422"))
      #expect(!message.contains("headerFields"))
    }
  }

  @Test(arguments: [400, 403, 404, 422, 429, 500])
  func threadSummaryPreservesErrorStatusAndMessage(status: Int) async throws {
    let transport = ScriptedTransport([(status, """
    {"error":"Request failed","message":"Thread unavailable","meta":{"timestamp":"\(timestamp)","requestId":"req-1","path":"/threads/parent","method":"GET"}}
    """)])
    do {
      _ = try await ChatService().getThread(client: makeClient(transport), roomId: "room", parentMessageId: "parent", organizationSlug: nil)
      Issue.record("expected an error")
    } catch let error as ChatServiceError {
      #expect(error == .unprocessable(statusCode: status, message: "Thread unavailable"))
    }
  }

  @Test func initialLoadPerformsNoWrites() async throws {
    // Launch must not PUT: re-asserting a default preference on every launch
    // yanks cross-client state and turns every flaky upload into a dead
    // window (production -1005 on PUT). Only access + organizations are read.
    let transport = ScriptedTransport([
      (200, accessBody(gate: "ready")),
      (200, """
      {"data":[{"id":"org_1","createdAt":"\(timestamp)","name":"Acme","slug":"acme","role":"member"}],"meta":{"timestamp":"\(timestamp)","requestId":"req-1"}}
      """),
      (200, """
      {"data":{"id":"user_1","createdAt":"\(timestamp)","updatedAt":"\(timestamp)","name":"Me","email":"me@example.com","emailVerified":true,"role":"user"},"meta":{"timestamp":"\(timestamp)","requestId":"req-1"}}
      """),
      (200, #"{"data":{"organizationId":null},"meta":{"timestamp":"2026-01-01T00:00:00.000Z","requestId":"req-1"}}"#)
    ])
    let state = try await ChatService().loadInitialState(client: makeClient(transport))
    #expect(Set(transport.requests.map(\.operationID)) == ["get/users/{id}/workspace-access", "get/users/{id}/organizations", "get/users/{id}", "get/users/{id}/preferred-organization"])
    #expect(state.defaultSelection == .personal)
    #expect(state.organizations.map(\.slug) == ["acme"])
    #expect(state.currentUserId == "user_1")
    #expect(state.currentUser.name == "Me")
    #expect(state.currentUser.email == "me@example.com")
  }

  @Test func initialLoadDefaultsToFirstOrgWithoutPersonal() async throws {
    let transport = ScriptedTransport([
      (200, """
      {"data":{"gate":"ready","hasPersonalWorkspace":false,"hasOrganizationMembership":true,"hasPendingOrganizationInvites":false},"meta":{"timestamp":"\(timestamp)","requestId":"req-1"}}
      """),
      (200, """
      {"data":[{"id":"org_1","createdAt":"\(timestamp)","name":"Acme","slug":"acme","role":"member"}],"meta":{"timestamp":"\(timestamp)","requestId":"req-1"}}
      """),
      (200, """
      {"data":{"id":"user_1","createdAt":"\(timestamp)","updatedAt":"\(timestamp)","name":"Me","email":"me@example.com","emailVerified":true,"role":"user"},"meta":{"timestamp":"\(timestamp)","requestId":"req-1"}}
      """),
      (200, #"{"data":{"organizationId":"org_1"},"meta":{"timestamp":"2026-01-01T00:00:00.000Z","requestId":"req-1"}}"#)
    ])
    let state = try await ChatService().loadInitialState(client: makeClient(transport))
    #expect(state.defaultSelection == .organization(id: "org_1", slug: "acme"))
  }

  @Test func switchWorkspacePersistsThenListsWithSlug() async throws {
    // Explicit user switches are the only writes: PUT, then rooms reloaded
    // under the new slug.
    let transport = ScriptedTransport([
      (200, """
      {"data":{"organizationId":"org_1"},"meta":{"timestamp":"\(timestamp)","requestId":"req-1"}}
      """),
      (200, roomsPageBody(rooms: [roomJSON(id: "550e8400-e29b-41d4-a716-446655440020", name: "launch", kind: "channel", unreadCount: 1, unreadMentionCount: 0)], nextCursor: nil))
    ])
    let rooms = try await ChatService().switchWorkspace(
      client: makeClient(transport),
      selection: .organization(id: "org_1", slug: "acme")
    )
    #expect(transport.requests.map(\.operationID) == ["put/users/{id}/preferred-organization", "get/chats/rooms"])
    #expect(orgSlugHeader(transport.requests[1].request) == "acme")
    #expect(rooms.map(\.name) == ["launch"])
  }

  @Test func switchWorkspaceRestoresPreviousPreferenceWhenRoomsFail() async throws {
    let transport = ScriptedTransport([
      (200, """
      {"data":{"organizationId":"org_1"},"meta":{"timestamp":"\(timestamp)","requestId":"req-1"}}
      """),
      (500, """
      {"error":"Internal Server Error","message":"boom","meta":{"timestamp":"\(timestamp)","requestId":"req-1","path":"/v1/chats/rooms","method":"GET"}}
      """),
      (200, """
      {"data":{"organizationId":null},"meta":{"timestamp":"\(timestamp)","requestId":"req-1"}}
      """)
    ])
    let client = try Client.connecting(
      to: #require(URL(string: "https://core.example/v1")),
      transport: transport,
      middlewares: [ExplicitNullPreferredOrganizationMiddleware()]
    )
    do {
      _ = try await ChatService().switchWorkspace(
        client: client,
        selection: .organization(id: "org_1", slug: "acme"),
        previous: .personal
      )
      Issue.record("expected rooms failure")
    } catch let error as ChatServiceError {
      let message = String(describing: error)
      #expect(message.contains("500"))
      #expect(message.contains("boom"))
    }
    #expect(transport.requests.map(\.operationID) == [
      "put/users/{id}/preferred-organization",
      "get/chats/rooms",
      "put/users/{id}/preferred-organization"
    ])
    let rollback = try #require(transport.bodies.last)
    let json = try #require(JSONSerialization.jsonObject(with: rollback) as? [String: Any])
    #expect(json["organizationId"] is NSNull)
  }

  @Test func switchToPersonalSendsExplicitNull() async throws {
    let transport = ScriptedTransport([
      (200, """
      {"data":{"organizationId":null},"meta":{"timestamp":"\(timestamp)","requestId":"req-1"}}
      """),
      (200, roomsPageBody(rooms: [], nextCursor: nil))
    ])
    let client = try Client.connecting(
      to: #require(URL(string: "https://core.example/v1")),
      transport: transport,
      middlewares: [ExplicitNullPreferredOrganizationMiddleware()]
    )
    _ = try await ChatService().switchWorkspace(client: client, selection: .personal)
    let putBody = try #require(transport.bodies.first)
    let json = try #require(JSONSerialization.jsonObject(with: putBody) as? [String: Any])
    #expect(json["organizationId"] is NSNull)
    #expect(orgSlugHeader(transport.requests[1].request) == nil)
  }

  @Test func friendlyMessageShortensTransportErrors() {
    // User symptom: a -1005 filled the window with an NSError dump.
    #expect(friendlyMessage(for: URLError(.networkConnectionLost)) == "The network connection was lost.")
    let wrapped = NSError(
      domain: "Client", code: 0,
      userInfo: [NSUnderlyingErrorKey: URLError(.notConnectedToInternet)]
    )
    #expect(friendlyMessage(for: wrapped) == "No network connection. Check your connection and try again.")
    let raw = NSError(domain: NSURLErrorDomain as String, code: NSURLErrorNetworkConnectionLost)
    #expect(friendlyMessage(for: raw) == "The network connection was lost.")
    struct Mystery: Error {}
    let generic = friendlyMessage(for: Mystery())
    #expect(!generic.contains("NSUnderlying"))
    #expect(generic.count < 120)
    #expect(
      friendlyMessage(for: ChatServiceError.unprocessable(statusCode: 500, message: "boom"))
        == "Core rejected the request (500): boom"
    )
    #expect(
      friendlyMessage(for: ChatServiceError.unexpectedResponse("Workspace access changed. Try again."))
        == "Workspace access changed. Try again."
    )
  }

  @Test func serverWorkspaceRestoresWhenStillPresent() async throws {
    let transport = ScriptedTransport([
      (200, accessBody(gate: "ready")),
      (200, """
      {"data":[{"id":"org_1","createdAt":"\(timestamp)","name":"Acme","slug":"acme","role":"member"},{"id":"org_2","createdAt":"\(timestamp)","name":"Other","slug":"other","role":"member"}],"meta":{"timestamp":"\(timestamp)","requestId":"req-1"}}
      """),
      (200, """
      {"data":{"id":"user_1","createdAt":"\(timestamp)","updatedAt":"\(timestamp)","name":"Me","email":"me@example.com","emailVerified":true,"role":"user"},"meta":{"timestamp":"\(timestamp)","requestId":"req-1"}}
      """),
      (200, #"{"data":{"organizationId":"org_2"},"meta":{"timestamp":"2026-01-01T00:00:00.000Z","requestId":"req-1"}}"#)
    ])
    let state = try await ChatService().loadInitialState(client: makeClient(transport))
    #expect(state.defaultSelection == .organization(id: "org_2", slug: "other"))
  }

  @Test func serverPersonalSelectionRestores() async throws {
    let transport = ScriptedTransport([
      (200, accessBody(gate: "ready")),
      (200, """
      {"data":[{"id":"org_1","createdAt":"\(timestamp)","name":"Acme","slug":"acme","role":"member"}],"meta":{"timestamp":"\(timestamp)","requestId":"req-1"}}
      """),
      (200, """
      {"data":{"id":"user_1","createdAt":"\(timestamp)","updatedAt":"\(timestamp)","name":"Me","email":"me@example.com","emailVerified":true,"role":"user"},"meta":{"timestamp":"\(timestamp)","requestId":"req-1"}}
      """),
      (200, #"{"data":{"organizationId":null},"meta":{"timestamp":"2026-01-01T00:00:00.000Z","requestId":"req-1"}}"#)
    ])
    let state = try await ChatService().loadInitialState(client: makeClient(transport))
    #expect(state.defaultSelection == .personal)
  }

  @Test func setPreferredOrganizationSucceeds() async throws {
    let transport = ScriptedTransport([
      (200, """
      {"data":{"organizationId":"org_1"},"meta":{"timestamp":"\(timestamp)","requestId":"req-1"}}
      """),
      (200, """
      {"data":{"organizationId":null},"meta":{"timestamp":"\(timestamp)","requestId":"req-1"}}
      """)
    ])
    let service = ChatService()
    await #expect(throws: Never.self) {
      try await service.setPreferredOrganization(client: makeClient(transport), organizationId: "org_1")
    }
    await #expect(throws: Never.self) {
      try await service.setPreferredOrganization(client: makeClient(transport), organizationId: nil)
    }
    #expect(transport.requests.map(\.operationID) == ["put/users/{id}/preferred-organization", "put/users/{id}/preferred-organization"])
  }
}

@Test func driveListingWalksPagesWithWorkspaceAndFolder() async throws {
  let transport = ScriptedTransport([
    (200, drivePageBody(items: ["{\"type\":\"folder\",\"name\":\"Reports\",\"path\":\"Reports\"}"], nextCursor: "next")),
    (200, drivePageBody(items: ["""
    {"type":"file","name":"report.pdf","fileUrl":"https://blob.example/report.pdf","pathname":"drive/organizations/org_1/Projects/report.pdf","size":1024,"uploadedAt":"2026-09-11T10:00:00.000Z"}
    """], nextCursor: nil))
  ])
  let client = try makeClient(transport)
  let items = try await ChatService().driveItems(client: client, organizationId: "org_1", folder: "Projects", query: "Report")
  #expect(items.count == 2)
  guard case let .file(file) = items[1] else { Issue.record("Expected Drive file")
    return
  }
  #expect(file.value1.name == "report.pdf")
  #expect(transport.requests.count == 2)
  for request in transport.requests {
    let query = requestQuery(request.request)
    #expect(query.contains("scope=org"))
    #expect(query.contains("organizationId=org_1"))
    #expect(query.contains("folder=Projects"))
    #expect(query.contains("q=Report"))
  }
  #expect(requestQuery(transport.requests[1].request).contains("cursor=next"))
}

@Test func driveListingRejectsRepeatedCursor() async throws {
  let page = drivePageBody(items: [], nextCursor: "same")
  let transport = ScriptedTransport([(200, page), (200, page)])
  let client = try makeClient(transport)
  await #expect(throws: ChatServiceError.self) {
    try await ChatService().driveItems(client: client, organizationId: nil, folder: "", query: "")
  }
  #expect(requestQuery(transport.requests[0].request).contains("scope=me"))
  #expect(!requestQuery(transport.requests[0].request).contains("organizationId"))
}

@Test @MainActor func drivePickerCanRecoverAfterFailure() async {
  let picker = DrivePicker()
  await picker.load { throw ChatServiceError.unprocessable(statusCode: 503, message: "Unavailable") }
  #expect(picker.errorMessage == "Unavailable")
  #expect(!picker.loading)
  await picker.load { [] }
  #expect(picker.errorMessage == nil)
  #expect(!picker.loading)
}

private func drivePageBody(items: [String], nextCursor: String?) -> String {
  let cursorJSON = nextCursor.map { "\"\($0)\"" } ?? "null"
  return """
  {"data":[\(items.joined(separator: ","))],"meta":{"timestamp":"\(timestamp)","requestId":"req-1","pagination":{"cursor":null,"limit":100,"nextCursor":\(cursorJSON)}}}
  """
}

@Test @MainActor func drivePickerIgnoresOlderRequestCompletion() async {
  let picker = DrivePicker()
  var pending: CheckedContinuation<[Components.Schemas.DriveItem], Never>?
  let first = Task {
    await picker.load {
      await withCheckedContinuation { pending = $0 }
    }
  }
  while pending == nil {
    await Task.yield()
  }
  await picker.load { throw ChatServiceError.unprocessable(statusCode: 503, message: "Latest failure") }
  pending?.resume(returning: [])
  await first.value
  #expect(picker.errorMessage == "Latest failure")
  #expect(!picker.loading)
}

@Test @MainActor func drivePickerShowsUnexpectedResponseAndTransportCopy() async {
  let picker = DrivePicker()
  await picker.load { throw ChatServiceError.unexpectedResponse("This folder has too many files. Refine your search.") }
  #expect(picker.errorMessage == "This folder has too many files. Refine your search.")
  await picker.load { throw URLError(.timedOut) }
  #expect(picker.errorMessage == "The request timed out. Please try again.")
}

@Test @MainActor func drivePickerIgnoresCancellation() async throws {
  let picker = DrivePicker()
  let folder = try JSONDecoder().decode(
    Components.Schemas.DriveItem.self,
    from: Data(#"{"type":"folder","name":"Reports","path":"Reports"}"#.utf8)
  )
  await picker.load { [folder] }
  await picker.load { throw CancellationError() }
  #expect(picker.errorMessage == nil)
  #expect(picker.items == [folder])
  #expect(!picker.loading)
}

extension ChatServiceTests {
  @Test func invitationOperationsUseCoreRoutesAndSurfaceCoreMessages() async throws {
    func envelope(_ data: String) -> String {
      "{\"data\":\(data),\"meta\":{\"timestamp\":\"\(timestamp)\",\"requestId\":\"req\"}}"
    }
    func error(_ status: String, _ message: String) -> String {
      "{\"error\":\"\(status)\",\"message\":\"\(message)\",\"meta\":{\"timestamp\":\"\(timestamp)\",\"requestId\":\"req\",\"path\":\"/chats/invitations\",\"method\":\"POST\"}}"
    }
    func invitation(_ status: String) -> String {
      "{\"id\":\"inv\",\"roomId\":\"room\",\"roomName\":\"Partners\",\"organizationId\":\"org\",\"organizationName\":\"Acme\",\"email\":\"me@example.com\",\"status\":\"\(status)\",\"inviter\":{\"id\":\"host\",\"name\":\"Hannah\"},\"expiresAt\":\"\(timestamp)\",\"createdAt\":\"\(timestamp)\"}"
    }
    let transport = ScriptedTransport([
      (200, envelope("[\(invitation("pending"))]")),
      (200, envelope(invitation("pending"))),
      (404, error("Not Found", "Invitation not found")),
      (200, envelope(invitation("accepted"))),
      (400, error("Bad Request", "Invitation is no longer pending.")),
      (200, envelope(invitation("declined"))),
      (200, envelope("{\"status\":\"valid\",\"room\":{\"id\":\"room\",\"name\":\"Partners\",\"organizationId\":\"org\",\"organizationName\":\"Acme\"}}")),
      (200, envelope("{\"status\":\"depleted\",\"room\":null}")),
      (200, envelope("{\"status\":\"already_guest\",\"roomId\":\"room\",\"roomName\":\"Partners\"}")),
      (403, error("Forbidden", "Sign in with a user session to join."))
    ])
    let client = try makeClient(transport)
    let service = ChatService()
    #expect(try await service.pendingInvitations(client: client, organizationSlug: nil).map(\.id) == ["inv"])
    #expect(try await service.invitation(client: client, id: "inv", organizationSlug: "team").inviter.name == "Hannah")
    await #expect(throws: ChatServiceError.unprocessable(statusCode: 404, message: "Invitation not found")) {
      try await service.invitation(client: client, id: "inv", organizationSlug: "team")
    }
    #expect(try await service.acceptInvitation(client: client, id: "inv", organizationSlug: "team").status == .accepted)
    await #expect(throws: ChatServiceError.unprocessable(statusCode: 400, message: "Invitation is no longer pending.")) {
      try await service.acceptInvitation(client: client, id: "inv", organizationSlug: "team")
    }
    #expect(try await service.declineInvitation(client: client, id: "inv", organizationSlug: nil).status == .declined)
    let valid = try await service.resolveGuestInviteLink(client: client, token: "tok")
    #expect(valid.status == .valid && valid.room?.name == "Partners")
    let depleted = try await service.resolveGuestInviteLink(client: client, token: "tok")
    #expect(depleted.status == .depleted && depleted.room == nil)
    let joined = try await service.acceptGuestInviteLink(client: client, token: "tok", organizationSlug: "team")
    #expect(joined.status == .alreadyGuest && joined.roomId == "room")
    await #expect(throws: ChatServiceError.unprocessable(statusCode: 403, message: "Sign in with a user session to join.")) {
      try await service.acceptGuestInviteLink(client: client, token: "tok", organizationSlug: nil)
    }
    let routes = transport.requests.map { "\($0.request.method.rawValue) \($0.request.path ?? "")" }
    #expect(routes == [
      "GET /chats/invitations?status=pending", "GET /chats/invitations/inv", "GET /chats/invitations/inv",
      "POST /chats/invitations/inv/accept", "POST /chats/invitations/inv/accept", "POST /chats/invitations/inv/decline",
      "GET /chat-room-invite-links/tok", "GET /chat-room-invite-links/tok",
      "POST /chat-room-invite-links/tok/accept", "POST /chat-room-invite-links/tok/accept"
    ])
    // Personal workspaces omit the organization header; the public link preview never sends it.
    #expect(transport.requests.map { orgSlugHeader($0.request) } == [nil, "team", "team", "team", "team", nil, nil, nil, "team", nil])
  }

  private func guestEnvelope(_ data: String) -> String {
    "{\"data\":\(data),\"meta\":{\"timestamp\":\"\(timestamp)\",\"requestId\":\"req\"}}"
  }

  private func guestError(_ status: String, _ message: String) -> String {
    "{\"error\":\"\(status)\",\"message\":\"\(message)\",\"meta\":{\"timestamp\":\"\(timestamp)\",\"requestId\":\"req\",\"path\":\"/chats/rooms/room/invitations\",\"method\":\"POST\"}}"
  }

  @Test func guestInvitationOperationsUseCoreRoutesAndMessages() async throws {
    let invitation = "{\"id\":\"inv\",\"roomId\":\"room\",\"roomName\":\"Partners\",\"organizationId\":\"org\",\"organizationName\":\"Acme\",\"email\":\"guest@example.com\",\"status\":\"pending\",\"inviter\":{\"id\":\"me\",\"name\":\"Me\"},\"expiresAt\":\"\(timestamp)\",\"createdAt\":\"\(timestamp)\"}"
    let transport = ScriptedTransport([
      (200, guestEnvelope("[\(invitation)]")),
      (201, guestEnvelope(invitation)),
      (409, guestError("Conflict", "A pending invitation already exists for this email in this room.")),
      (204, ""),
      (404, guestError("Not Found", "Invitation not found")),
      (200, guestEnvelope("{\"id\":\"room\",\"remainingUserMemberCount\":2}")),
      (400, guestError("Bad Request", "Only guest members can be removed this way. Host members must leave themselves."))
    ])
    let client = try makeClient(transport)
    let service = ChatService()
    #expect(try await service.roomInvitations(client: client, roomId: "room", organizationSlug: "team").map(\.email) == ["guest@example.com"])
    #expect(try await service.inviteGuest(client: client, roomId: "room", email: "guest@example.com", organizationSlug: "team").id == "inv")
    await #expect(throws: ChatServiceError.unprocessable(statusCode: 409, message: "A pending invitation already exists for this email in this room.")) {
      try await service.inviteGuest(client: client, roomId: "room", email: "guest@example.com", organizationSlug: "team")
    }
    try await service.revokeInvitation(client: client, roomId: "room", invitationId: "inv", organizationSlug: "team")
    await #expect(throws: ChatServiceError.unprocessable(statusCode: 404, message: "Invitation not found")) {
      try await service.revokeInvitation(client: client, roomId: "room", invitationId: "inv", organizationSlug: "team")
    }
    try await service.removeGuest(client: client, roomId: "room", userId: "guest", organizationSlug: "team")
    await #expect(throws: ChatServiceError.unprocessable(statusCode: 400, message: "Only guest members can be removed this way. Host members must leave themselves.")) {
      try await service.removeGuest(client: client, roomId: "room", userId: "me", organizationSlug: "team")
    }
    let routes = transport.requests.map { "\($0.request.method.rawValue) \($0.request.path ?? "")" }
    #expect(routes == [
      "GET /chats/rooms/room/invitations", "POST /chats/rooms/room/invitations", "POST /chats/rooms/room/invitations",
      "DELETE /chats/rooms/room/invitations/inv", "DELETE /chats/rooms/room/invitations/inv",
      "DELETE /chats/rooms/room/members/guest", "DELETE /chats/rooms/room/members/me"
    ])
    #expect(transport.requests.allSatisfy { orgSlugHeader($0.request) == "team" })
    let bodies = try transport.bodies.filter { !$0.isEmpty }.map { try #require(JSONSerialization.jsonObject(with: $0) as? [String: Any]) }
    #expect(bodies.map { $0["email"] as? String } == ["guest@example.com", "guest@example.com"])
  }

  /// The generated body has no `expiresInDays` (Core's `anyOf [integer, null]`), so the app middleware writes the
  /// explicit null or day count and restamps Content-Length.
  @Test func guestInviteLinkOperationsCarryExpiryThroughMiddleware() async throws {
    func link(_ token: String, expiresAt: String, maxUses: String) -> String {
      "{\"token\":\"\(token)\",\"url\":\"https://app.sokosumi.com/chat/join/\(token)\",\"roomId\":\"room\",\"createdAt\":\"\(timestamp)\",\"expiresAt\":\(expiresAt),\"revokedAt\":null,\"maxUses\":\(maxUses),\"useCount\":2}"
    }
    let transport = ScriptedTransport([
      (200, guestEnvelope("[\(link("a", expiresAt: "\"\(timestamp)\"", maxUses: "10"))]")),
      (201, guestEnvelope(link("b", expiresAt: "null", maxUses: "null"))),
      (201, guestEnvelope(link("c", expiresAt: "\"\(timestamp)\"", maxUses: "5"))),
      (429, guestError("Too Many Requests", "You can create at most 10 shareable invite links per hour. Try again later.")),
      (200, guestEnvelope("{\"ok\":true}"))
    ])
    let client = try Client.connecting(to: #require(URL(string: "https://core.example/v1")), transport: transport, middlewares: [GuestInviteLinkExpiryMiddleware()])
    let service = ChatService()
    let listed = try await service.guestInviteLinks(client: client, roomId: "room", organizationSlug: "team")
    #expect(listed.map(\.token) == ["a"] && listed[0].maxUses == 10 && listed[0].expiresAt != nil)
    let never = try await service.createGuestInviteLink(client: client, roomId: "room", options: .init(expiresInDays: nil, maxUses: nil), organizationSlug: "team")
    #expect(never.token == "b" && never.expiresAt == nil && never.maxUses == nil)
    let capped = try await service.createGuestInviteLink(client: client, roomId: "room", options: .init(expiresInDays: 30, maxUses: 5), organizationSlug: "team")
    #expect(capped.token == "c" && capped.maxUses == 5)
    await #expect(throws: ChatServiceError.unprocessable(statusCode: 429, message: "You can create at most 10 shareable invite links per hour. Try again later.")) {
      try await service.createGuestInviteLink(client: client, roomId: "room", options: .init(), organizationSlug: "team")
    }
    try await service.revokeGuestInviteLink(client: client, roomId: "room", token: "a", organizationSlug: "team")
    let routes = transport.requests.map { "\($0.request.method.rawValue) \($0.request.path ?? "")" }
    #expect(routes == [
      "GET /chats/rooms/room/invite-links", "POST /chats/rooms/room/invite-links", "POST /chats/rooms/room/invite-links",
      "POST /chats/rooms/room/invite-links", "DELETE /chats/rooms/room/invite-links/a"
    ])
    #expect(transport.requests.allSatisfy { orgSlugHeader($0.request) == "team" })
    let bodies = try transport.bodies.filter { !$0.isEmpty }.map { try #require(JSONSerialization.jsonObject(with: $0) as? [String: Any]) }
    #expect(bodies.count == 3)
    #expect(bodies[0]["expiresInDays"] is NSNull && bodies[0]["maxUses"] == nil)
    #expect(bodies[1]["expiresInDays"] as? Int == 30 && bodies[1]["maxUses"] as? Int == 5)
    #expect(bodies[2]["expiresInDays"] as? Int == 7 && bodies[2]["maxUses"] == nil)
    let creates = transport.requests.filter { $0.request.method == .post }
    #expect(creates.map { $0.request.headerFields[.contentLength] } == ["{\"expiresInDays\":null}".utf8.count, "{\"expiresInDays\":30,\"maxUses\":5}".utf8.count, "{\"expiresInDays\":7}".utf8.count].map { String($0) })
  }
}
