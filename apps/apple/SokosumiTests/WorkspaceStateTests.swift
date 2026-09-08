import CoreAPI
import Foundation
import HTTPTypes
import OpenAPIRuntime
import SokosumiAuth
import SokosumiChat
import Testing

@testable import Sokosumi

private let timestamp = "2026-01-01T00:00:00.000Z"

private struct MemoryTokenStore: TokenStore {
  var tokens: OAuthTokens?
  func load() -> OAuthTokens? { tokens }
  func save(_ tokens: OAuthTokens) throws {}
  func clear() -> Bool { true }
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
  func save(_ tokens: OAuthTokens) throws {}
  func clear() -> Bool { true }
}

private final class ScriptedTransport: ClientTransport, @unchecked Sendable {
  private(set) var operationIDs: [String] = []
  private var responses: [(Int, String)]

  init(_ responses: [(Int, String)]) {
    self.responses = responses
  }

  func send(
    _ request: HTTPRequest,
    body: HTTPBody?,
    baseURL: URL,
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

private func ephemeralState(_ responses: [(Int, String)]) -> (WorkspaceState, AuthState, ScriptedTransport) {
  let transport = ScriptedTransport(responses)
  let client = Client.connecting(to: URL(string: "https://core.example/v1")!, transport: transport)
  let defaults = UserDefaults(suiteName: "sokosumi-workspace-state-tests")!
  defaults.removePersistentDomain(forName: "sokosumi-workspace-state-tests")
  let state = WorkspaceState(savedSelection: SavedWorkspaceSelection(defaults: defaults))
  state.clientResolver = { client }
  return (state, AuthState(store: MemoryTokenStore()), transport)
}

struct WorkspaceStateTests {
  @Test func authInitSkipsTokenStoreRestoreUnderTestRunner() {
    let store = LoadCountingStore()
    store.tokens = OAuthTokens(accessToken: "stored", refreshToken: nil, expiresAt: Date(), scope: nil)
    _ = AuthState(store: store)
    #expect(store.loadCalls == 0)
  }

  @Test func reloadReadySelectsPersonalDefaultAndLoadsRooms() async throws {
    let (state, auth, transport) = ephemeralState([
      (200, accessBody(gate: "ready")),
      (200, orgsBody),
      (200, userBody),
      (200, roomsBody(names: ["general"])),
    ])
    await state.reload(auth: auth)
    #expect(state.phase == .ready)
    #expect(state.selectionId == "personal")
    #expect(state.currentUserName == "Me")
    #expect(state.rooms.map(\.name) == ["general"])
    #expect(!transport.operationIDs.contains(where: { $0.hasPrefix("put/") }))
  }

  @Test func reloadBlockedGateLoadsNoRooms() async throws {
    let (state, auth, transport) = ephemeralState([(200, accessBody(gate: "identity-onboarding", personal: false))])
    await state.reload(auth: auth)
    #expect(state.phase == .blocked(gate: .identityOnboarding))
    #expect(state.rooms.isEmpty)
    #expect(transport.operationIDs == ["get/users/{id}/workspace-access"])
  }

  @Test func switchSuccessCommitsSelectionAndRooms() async throws {
    let (state, auth, transport) = ephemeralState([
      (200, accessBody(gate: "ready")),
      (200, orgsBody),
      (200, userBody),
      (200, roomsBody(names: ["general"])),
      (200, """
      {"data":{"organizationId":"org_1"},"meta":{"timestamp":"\(timestamp)","requestId":"req-1"}}
      """),
      (200, roomsBody(names: ["launch"])),
    ])
    await state.reload(auth: auth)
    let org = try #require(state.options.first { $0.id == "org_1" })
    await state.switchRooms(auth: auth, option: org)
    #expect(state.selectionId == "org_1")
    #expect(state.rooms.map(\.name) == ["launch"])
    #expect(transport.operationIDs.suffix(2) == ["put/users/{id}/preferred-organization", "get/chats/rooms"])
  }

  @Test func switchFailureKeepsOldSelectionAndRooms() async throws {
    let (state, auth, _) = ephemeralState([
      (200, accessBody(gate: "ready")),
      (200, orgsBody),
      (200, userBody),
      (200, roomsBody(names: ["general"])),
      (500, """
      {"error":"Internal Server Error","message":"boom","meta":{"timestamp":"\(timestamp)","requestId":"req-1","path":"/v1/users/me/preferred-organization","method":"PUT"}}
      """),
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
    let (state, auth, transport) = ephemeralState([
      (200, accessBody(gate: "ready")),
      (200, orgsBody),
      (200, userBody),
      (200, roomsBody(names: ["general"])),
      (200, """
      {"data":{"organizationId":"org_1"},"meta":{"timestamp":"\(timestamp)","requestId":"req-1"}}
      """),
      (200, roomsBody(names: ["launch"])),
    ])
    await state.reload(auth: auth)
    let org = try #require(state.options.first { $0.id == "org_1" })
    let personal = try #require(state.options.first { $0.id == "personal" })
    state.select(org, auth: auth)
    state.select(personal, auth: auth)
    for _ in 0..<1_000 where state.roomsLoading {
      await Task.yield()
    }
    #expect(state.selectionId == "org_1")
    #expect(state.rooms.map(\.name) == ["launch"])
    #expect(transport.operationIDs.filter { $0.hasPrefix("put/") }.count == 1)
  }

  @Test func resetClearsEverything() async throws {
    let defaults = UserDefaults(suiteName: "sokosumi-workspace-state-tests")!
    let (state, auth, _) = ephemeralState([
      (200, accessBody(gate: "ready")),
      (200, orgsBody),
      (200, userBody),
      (200, roomsBody(names: ["general"])),
      (200, """
      {"data":{"organizationId":"org_1"},"meta":{"timestamp":"\(timestamp)","requestId":"req-1"}}
      """),
      (200, roomsBody(names: ["launch"])),
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
}
