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
  {"id":"\(id)","organizationId":null,"organizationName":null,"name":"\(name)","slug":null,"kind":"\(kind)","directKey":null,"topic":null,"discoverability":null,"createdByUserId":"user_1","createdAt":"\(timestamp)","updatedAt":"\(timestamp)","unreadCount":\(unreadCount),"unreadMentionCount":\(unreadMentionCount),"starredAt":null,"pinnedMessageCount":0,"mutedAt":null,"markedUnread":false,"myAccess":"member","peerInActiveOrganization":false,"userMembers":[],"coworkerMembers":[],"sokoBotMembers":[]}
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

  @Test func blockedGateDoesNotLoadRooms() async throws {
    let transport = ScriptedTransport([(200, accessBody(gate: "identity-onboarding"))])
    do {
      _ = try await ChatService().loadRoomsIfReady(client: makeClient(transport), organizationSlug: nil)
      Issue.record("expected blocked error")
    } catch let error as ChatServiceError {
      #expect(error == .blocked(.identityOnboarding))
    }
    #expect(transport.requests.count == 1)
    #expect(transport.requests[0].operationID == "get/users/{id}/workspace-access")
  }

  @Test func pendingInvitesGateDoesNotLoadRooms() async throws {
    let transport = ScriptedTransport([(200, accessBody(gate: "pending-invites"))])
    do {
      _ = try await ChatService().loadRoomsIfReady(client: makeClient(transport), organizationSlug: "acme")
      Issue.record("expected blocked error")
    } catch let error as ChatServiceError {
      #expect(error == .blocked(.pendingInvites))
    }
    #expect(transport.requests.count == 1)
  }

  @Test func readyGateLoadsRooms() async throws {
    let transport = ScriptedTransport([
      (200, accessBody(gate: "ready")),
      (200, roomsPageBody(rooms: [roomJSON(id: "550e8400-e29b-41d4-a716-446655440002", name: "chat", kind: "direct", unreadCount: 5, unreadMentionCount: 0)], nextCursor: nil))
    ])
    let rooms = try await ChatService().loadRoomsIfReady(client: makeClient(transport), organizationSlug: nil)
    #expect(rooms.count == 1)
    #expect(rooms[0].unreadCount == 5)
    #expect(transport.requests.map(\.operationID) == ["get/users/{id}/workspace-access", "get/chats/rooms"])
    #expect(orgSlugHeader(transport.requests[1].request) == nil)
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
