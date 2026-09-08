import CoreAPI
import Foundation
import HTTPTypes
import OpenAPIRuntime
@testable import Sokosumi
import SokosumiAuth
import SokosumiChat
import Testing

private let timestamp = "2026-01-01T00:00:00.000Z"

private struct MemoryTokenStore: TokenStore {
  var tokens: OAuthTokens?
  func load() -> OAuthTokens? {
    tokens
  }

  func save(_: OAuthTokens) throws {}
  func clear() -> Bool {
    true
  }
}

/// Counts `load()` calls: proves `AuthState.init` never reads the store
/// under a test runner (the host app must not touch the login Keychain —
/// a fresh ad-hoc signature pops a system prompt on every test launch).
private final class LoadCountingStore: TokenStore, @unchecked Sendable {
  var tokens: OAuthTokens?
  private(set) var loadCalls = 0
  func load() -> OAuthTokens? {
    loadCalls += 1
    return tokens
  }

  func save(_: OAuthTokens) throws {}
  func clear() -> Bool {
    true
  }
}

private final class ScriptedTransport: ClientTransport, @unchecked Sendable {
  private(set) var operationIDs: [String] = []
  private var responses: [(Int, String)]

  init(_ responses: [(Int, String)]) {
    self.responses = responses
  }

  func send(
    _: HTTPRequest,
    body _: HTTPBody?,
    baseURL _: URL,
    operationID: String
  ) async throws -> (HTTPResponse, HTTPBody?) {
    operationIDs.append(operationID)
    let next = responses.removeFirst()
    return (HTTPResponse(status: HTTPResponse.Status(code: next.0)), HTTPBody(next.1))
  }
}

private func accessBody(gate: String, personal: Bool = true) -> String {
  """
  {"data":{"gate":"\(gate)","hasPersonalWorkspace":\(personal),"hasOrganizationMembership":true,"hasPendingOrganizationInvites":false},"meta":{"timestamp":"\(timestamp)","requestId":"req-1"}}
  """
}

private let orgsBody = """
{"data":[{"id":"org_1","createdAt":"\(timestamp)","name":"Acme","slug":"acme","role":"member"}],"meta":{"timestamp":"\(timestamp)","requestId":"req-1"}}
"""

private let userBody = """
{"data":{"id":"user_1","createdAt":"\(timestamp)","updatedAt":"\(timestamp)","name":"Me","email":"me@example.com","emailVerified":true,"role":"user"},"meta":{"timestamp":"\(timestamp)","requestId":"req-1"}}
"""

private func roomsBody(names: [String]) -> String {
  let rooms = names.enumerated().map { index, name in
    """
    {"id":"550e8400-e29b-41d4-a716-44665544000\(index)","organizationId":null,"organizationName":null,"name":"\(name)","slug":null,"kind":"channel","directKey":null,"topic":null,"discoverability":null,"createdByUserId":"user_1","createdAt":"\(timestamp)","updatedAt":"\(timestamp)","unreadCount":0,"unreadMentionCount":0,"starredAt":null,"pinnedMessageCount":0,"mutedAt":null,"markedUnread":false,"myAccess":"member","peerInActiveOrganization":false,"userMembers":[],"coworkerMembers":[],"sokoBotMembers":[]}
    """
  }.joined(separator: ",")
  return """
  {"data":[\(rooms)],"meta":{"timestamp":"\(timestamp)","requestId":"req-1","pagination":{"cursor":null,"limit":100,"total":\(names.count),"nextCursor":null}}}
  """
}

/// One fixture bundle per test; a struct would churn every call site.
private func ephemeralState(
  _ responses: [(Int, String)]
) throws -> (WorkspaceState, AuthState, ScriptedTransport, UserDefaults) { // swiftlint:disable:this large_tuple
  let transport = ScriptedTransport(responses)
  let client = try Client.connecting(to: #require(URL(string: "https://core.example/v1")), transport: transport)
  let suite = "sokosumi-workspace-state-tests.\(UUID().uuidString)"
  let defaults = UserDefaults(suiteName: suite)!
  defaults.removePersistentDomain(forName: suite)
  let state = WorkspaceState(savedSelection: SavedWorkspaceSelection(defaults: defaults))
  state.clientResolver = { client }
  return (state, AuthState(store: MemoryTokenStore()), transport, defaults)
}

struct WorkspaceStateTests {
  @Test func authInitSkipsTokenStoreRestoreUnderTestRunner() {
    let store = LoadCountingStore()
    store.tokens = OAuthTokens(accessToken: "stored", refreshToken: nil, expiresAt: Date(), scope: nil)
    _ = AuthState(store: store)
    #expect(store.loadCalls == 0)
  }

  @Test func reloadReadySelectsPersonalDefaultAndLoadsRooms() async throws {
    let (state, auth, transport, _) = try ephemeralState([
      (200, accessBody(gate: "ready")),
      (200, orgsBody),
      (200, userBody),
      (200, roomsBody(names: ["general"]))
    ])
    await state.reload(auth: auth)
    #expect(state.phase == .ready)
    #expect(state.selectionId == "personal")
    #expect(state.currentUserName == "Me")
    #expect(state.rooms.map(\.name) == ["general"])
    #expect(!transport.operationIDs.contains(where: { $0.hasPrefix("put/") }))
  }

  @Test func reloadBlockedGateLoadsNoRooms() async throws {
    let (state, auth, transport, _) = try ephemeralState([(200, accessBody(gate: "identity-onboarding", personal: false))])
    await state.reload(auth: auth)
    #expect(state.phase == .blocked(gate: .identityOnboarding))
    #expect(state.rooms.isEmpty)
    #expect(transport.operationIDs == ["get/users/{id}/workspace-access"])
  }

  @Test func switchSuccessCommitsSelectionAndRooms() async throws {
    let (state, auth, transport, _) = try ephemeralState([
      (200, accessBody(gate: "ready")),
      (200, orgsBody),
      (200, userBody),
      (200, roomsBody(names: ["general"])),
      (200, """
      {"data":{"organizationId":"org_1"},"meta":{"timestamp":"\(timestamp)","requestId":"req-1"}}
      """),
      (200, roomsBody(names: ["launch"]))
    ])
    await state.reload(auth: auth)
    let org = try #require(state.options.first { $0.id == "org_1" })
    await state.switchRooms(auth: auth, option: org)
    #expect(state.selectionId == "org_1")
    #expect(state.rooms.map(\.name) == ["launch"])
    #expect(transport.operationIDs.suffix(2) == ["put/users/{id}/preferred-organization", "get/chats/rooms"])
  }

  @Test func switchFailureKeepsOldSelectionAndRooms() async throws {
    let (state, auth, _, _) = try ephemeralState([
      (200, accessBody(gate: "ready")),
      (200, orgsBody),
      (200, userBody),
      (200, roomsBody(names: ["general"])),
      (500, """
      {"error":"Internal Server Error","message":"boom","meta":{"timestamp":"\(timestamp)","requestId":"req-1","path":"/v1/users/me/preferred-organization","method":"PUT"}}
      """)
    ])
    await state.reload(auth: auth)
    let org = try #require(state.options.first { $0.id == "org_1" })
    await state.switchRooms(auth: auth, option: org)
    #expect(state.selectionId == "personal")
    #expect(state.rooms.map(\.name) == ["general"])
    #expect(state.phase == .ready)
    #expect(state.switchError != nil)
  }

  @Test func selectWhileLoadingIgnoresSecondSwitch() async throws {
    let (state, auth, transport, _) = try ephemeralState([
      (200, accessBody(gate: "ready")),
      (200, orgsBody),
      (200, userBody),
      (200, roomsBody(names: ["general"])),
      (200, """
      {"data":{"organizationId":"org_1"},"meta":{"timestamp":"\(timestamp)","requestId":"req-1"}}
      """),
      (200, roomsBody(names: ["launch"]))
    ])
    await state.reload(auth: auth)
    let org = try #require(state.options.first { $0.id == "org_1" })
    let personal = try #require(state.options.first { $0.id == "personal" })
    state.select(org, auth: auth)
    state.select(personal, auth: auth)
    for _ in 0 ..< 1000 where state.roomsLoading {
      await Task.yield()
    }
    #expect(state.selectionId == "org_1")
    #expect(state.rooms.map(\.name) == ["launch"])
    #expect(transport.operationIDs.filter { $0.hasPrefix("put/") }.count == 1)
  }

  @Test func resetClearsEverything() async throws {
    let (state, auth, _, defaults) = try ephemeralState([
      (200, accessBody(gate: "ready")),
      (200, orgsBody),
      (200, userBody),
      (200, roomsBody(names: ["general"])),
      (200, """
      {"data":{"organizationId":"org_1"},"meta":{"timestamp":"\(timestamp)","requestId":"req-1"}}
      """),
      (200, roomsBody(names: ["launch"]))
    ])
    await state.reload(auth: auth)
    let org = try #require(state.options.first { $0.id == "org_1" })
    await state.switchRooms(auth: auth, option: org)
    #expect(SavedWorkspaceSelection(defaults: defaults).load() == "org_1")
    #expect(state.phase == .ready)
    state.reset()
    #expect(state.phase == .idle)
    #expect(state.selectionId == nil)
    #expect(state.rooms.isEmpty)
    #expect(state.currentUserName.isEmpty)
    #expect(state.switchError == nil)
    #expect(SavedWorkspaceSelection(defaults: defaults).load() == nil)
  }

  @Test func switchRoomsListFailureRestoresPreviousPreference() async throws {
    let (state, auth, transport, _) = try ephemeralState([
      (200, accessBody(gate: "ready")),
      (200, orgsBody),
      (200, userBody),
      (200, roomsBody(names: ["general"])),
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
    await state.reload(auth: auth)
    let org = try #require(state.options.first { $0.id == "org_1" })
    await state.switchRooms(auth: auth, option: org)
    #expect(state.selectionId == "personal")
    #expect(state.rooms.map(\.name) == ["general"])
    #expect(state.phase == .ready)
    #expect(transport.operationIDs.suffix(3) == [
      "put/users/{id}/preferred-organization",
      "get/chats/rooms",
      "put/users/{id}/preferred-organization"
    ])
  }

  @Test func openRoomReplacesListUnreadWithReadDTO() async throws {
    let roomID = "550e8400-e29b-41d4-a716-446655440030"
    let (state, auth, transport, _) = try ephemeralState([
      (200, accessBody(gate: "ready")),
      (200, orgsBody),
      (200, userBody),
      (200, unreadRoomsBody(id: roomID, unread: 3)),
      (200, transcriptPageBody(messages: [transcriptMessage(
        id: "550e8400-e29b-41d4-a716-446655440031",
        content: "hello"
      )], nextCursor: nil)),
      (200, roomReadBody(id: roomID, unread: 0))
    ])
    await state.reload(auth: auth)
    let room = try #require(state.rooms.first)
    #expect(room.unreadCount == 3)
    state.openRoom(room, auth: auth)
    for _ in 0 ..< 1000 where state.transcriptLoading {
      await Task.yield()
    }
    #expect(state.transcriptRoomId == roomID)
    #expect(state.transcriptMessages.map(\.content) == ["hello"])
    #expect(state.transcriptError == nil)
    // Sidebar unread follows the POST-read DTO, not a local zero.
    #expect(state.rooms.first?.unreadCount == 0)
    #expect(transport.operationIDs.suffix(2) == [
      "get/chats/rooms/{id}/messages",
      "post/chats/rooms/{id}/read"
    ])
  }

  @Test func failedTranscriptKeepsListUnread() async throws {
    let roomID = "550e8400-e29b-41d4-a716-446655440032"
    let (state, auth, transport, _) = try ephemeralState([
      (200, accessBody(gate: "ready")),
      (200, orgsBody),
      (200, userBody),
      (200, unreadRoomsBody(id: roomID, unread: 3)),
      (500, """
      {"error":"Internal Server Error","message":"boom","meta":{"timestamp":"\(timestamp)","requestId":"req-1","path":"/v1/chats/rooms/\(roomID)/messages","method":"GET"}}
      """)
    ])
    await state.reload(auth: auth)
    let room = try #require(state.rooms.first)
    state.openRoom(room, auth: auth)
    for _ in 0 ..< 1000 where state.transcriptLoading {
      await Task.yield()
    }
    #expect(state.transcriptMessages.isEmpty)
    #expect(state.transcriptError != nil)
    #expect(state.rooms.first?.unreadCount == 3)
    #expect(!transport.operationIDs.contains("post/chats/rooms/{id}/read"))
  }
}

private func unreadRoomsBody(id: String, unread: Int) -> String {
  """
  {"data":[{"id":"\(id)","organizationId":null,"organizationName":null,"name":"general","slug":null,"kind":"channel","directKey":null,"topic":null,"discoverability":null,"createdByUserId":"user_1","createdAt":"\(timestamp)","updatedAt":"\(timestamp)","unreadCount":\(unread),"unreadMentionCount":0,"starredAt":null,"pinnedMessageCount":0,"mutedAt":null,"markedUnread":false,"myAccess":"member","peerInActiveOrganization":false,"userMembers":[],"coworkerMembers":[],"sokoBotMembers":[]}],"meta":{"timestamp":"\(timestamp)","requestId":"req-1","pagination":{"cursor":null,"limit":100,"total":1,"nextCursor":null}}}
  """
}

private func transcriptMessage(id: String, content: String) -> String {
  """
  {"id":"\(id)","roomId":"550e8400-e29b-41d4-a716-446655440030","parentMessageId":null,"content":"\(content)","createdAt":"\(timestamp)","deletedAt":null,"editedAt":null,"sender":{"type":"user","user":{"id":"user_2","name":"Ada","email":"ada@example.com","presence":"offline"}},"mentions":[],"reactions":[],"threadReplyCount":0,"threadLastReplyAt":null,"metadata":null,"quote":null,"membership":null,"unfurls":null}
  """
}

private func transcriptPageBody(messages: [String], nextCursor: String?) -> String {
  let cursorJSON = nextCursor.map { "\"\($0)\"" } ?? "null"
  return """
  {"data":[\(messages.joined(separator: ","))],"meta":{"timestamp":"\(timestamp)","requestId":"req-1","pagination":{"cursor":null,"limit":100,"total":\(messages.count),"nextCursor":\(cursorJSON)}}}
  """
}

private func roomReadBody(id: String, unread: Int) -> String {
  let room = """
  {"id":"\(id)","organizationId":null,"organizationName":null,"name":"general","slug":null,"kind":"channel","directKey":null,"topic":null,"discoverability":null,"createdByUserId":"user_1","createdAt":"\(timestamp)","updatedAt":"\(timestamp)","unreadCount":\(unread),"unreadMentionCount":0,"starredAt":null,"pinnedMessageCount":0,"mutedAt":null,"markedUnread":false,"myAccess":"member","peerInActiveOrganization":false,"userMembers":[],"coworkerMembers":[],"sokoBotMembers":[]}
  """
  return """
  {"data":\(room),"meta":{"timestamp":"\(timestamp)","requestId":"req-1"}}
  """
}
