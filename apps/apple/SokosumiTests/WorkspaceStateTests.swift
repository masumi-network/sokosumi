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
  private(set) var bodies: [Data] = []
  private var responses: [(Int, String)]
  var remainingStubs: Int {
    responses.count
  }

  var pausePOST = false
  var pauseStream = false
  var pauseGET = false
  private var pauseWaiter: CheckedContinuation<Void, Never>?
  /// Tests wait on `operationIDs` (appended before the body `await`). A
  /// release that arrives in that window must not be lost.
  private var postReleased = false
  private var postCompleted = false
  private var postCompletionWaiter: CheckedContinuation<Void, Never>?

  init(_ responses: [(Int, String)]) {
    self.responses = responses
  }

  func send(
    _: HTTPRequest,
    body: HTTPBody?,
    baseURL _: URL,
    operationID: String
  ) async throws -> (HTTPResponse, HTTPBody?) {
    defer {
      if operationID == "post/chats/rooms/{id}/messages" {
        postCompleted = true
        postCompletionWaiter?.resume()
        postCompletionWaiter = nil
      }
    }
    operationIDs.append(operationID)
    if let body, let bytes = try? await Array(collecting: body, upTo: 1_000_000) {
      bodies.append(Data(bytes))
    } else {
      bodies.append(Data())
    }
    if pausePOST, operationID == "post/chats/rooms/{id}/messages" {
      if !postReleased {
        await withCheckedContinuation { pauseWaiter = $0 }
      }
      postReleased = false
      try Task.checkCancellation()
    }
    if pauseStream, operationID == "post/chats/rooms/{id}/stream" || operationID == "get/chats/rooms/{id}/stream/active" {
      let next = responses.removeFirst()
      if !postReleased {
        await withCheckedContinuation { pauseWaiter = $0 }
      }
      postReleased = false
      try Task.checkCancellation()
      return (HTTPResponse(status: HTTPResponse.Status(code: next.0)), HTTPBody(next.1))
    }
    if pauseGET, operationID.hasPrefix("get/"), operationID.contains("/messages") {
      let next = responses.removeFirst()
      if !postReleased {
        await withCheckedContinuation { pauseWaiter = $0 }
      }
      postReleased = false
      try Task.checkCancellation()
      return (HTTPResponse(status: HTTPResponse.Status(code: next.0)), HTTPBody(next.1))
    }
    let next = responses.removeFirst()
    return (HTTPResponse(status: HTTPResponse.Status(code: next.0)), HTTPBody(next.1))
  }

  func releasePOST() {
    postReleased = true
    pauseWaiter?.resume()
    pauseWaiter = nil
  }

  func waitForPOSTCompletion() async {
    if postCompleted {
      return
    }
    await withCheckedContinuation { postCompletionWaiter = $0 }
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
  _ responses: [(Int, String)],
  visible: Bool = true
) throws -> (WorkspaceState, AuthState, ScriptedTransport, UserDefaults) { // swiftlint:disable:this large_tuple
  let transport = ScriptedTransport(responses)
  let client = try Client.connecting(to: #require(URL(string: "https://core.example/v1")), transport: transport)
  let suite = "sokosumi-workspace-state-tests.\(UUID().uuidString)"
  let defaults = UserDefaults(suiteName: suite)!
  defaults.removePersistentDomain(forName: suite)
  let state = WorkspaceState(
    savedRoom: SavedRoomSelection(defaults: defaults)
  )
  state.readAttention.setVisible(visible, window: UUID())
  state.clientResolver = { client }
  return (state, AuthState(store: MemoryTokenStore()), transport, defaults)
}

/// Settles the fire-and-forget transcript tasks `openRoom` / `loadOlder`
/// spawn, so stubbed responses are consumed in order. Every load in these
/// tests must be followed by one before the next load or op assertion.
private func waitForTranscriptIdle(_ state: WorkspaceState) async {
  while state.transcriptLoadTask != nil || state.olderPageTask != nil || state.transcriptRefreshTask != nil {
    await state.transcriptLoadTask?.value
    await state.olderPageTask?.value
    await state.transcriptRefreshTask?.value
  }
}

private func waitForOutboundIdle(_ state: WorkspaceState) async {
  for _ in 0 ..< 1000 where state.outboundInFlight {
    await Task.yield()
  }
}

struct WorkspaceStateTests {
  @Test func authInitSkipsTokenStoreRestoreUnderTestRunner() {
    let store = LoadCountingStore()
    store.tokens = OAuthTokens(accessToken: "stored", refreshToken: nil, expiresAt: Date(), scope: nil)
    _ = AuthState(store: store)
    #expect(store.loadCalls == 0)
  }

  @Test func reloadReadySelectsPersonalDefaultAndLoadsRooms() async throws {
    let (state, auth, transport, defaults) = try ephemeralState([
      (200, accessBody(gate: "ready")),
      (200, orgsBody),
      (200, userBody),
      (200, #"{"data":{"organizationId":null},"meta":{"timestamp":"2026-01-01T00:00:00.000Z","requestId":"req-1"}}"#),
      (200, roomsBody(names: ["general"])),
      (200, transcriptPageBody(messages: [], nextCursor: nil)),
      (200, roomReadBody(id: "550e8400-e29b-41d4-a716-446655440000", unread: 0))
    ])
    await state.reload(auth: auth)
    #expect(state.phase == .ready)
    #expect(state.selectionId == "personal")
    #expect(state.currentUserName == "Me")
    #expect(state.rooms.map(\.name) == ["general"])
    #expect(!transport.operationIDs.contains(where: { $0.hasPrefix("put/") }))
    // First room is selected and persisted when nothing was saved.
    #expect(state.selectedRoomId == "550e8400-e29b-41d4-a716-446655440000")
    #expect(SavedRoomSelection(defaults: defaults).load(userId: "user_1", organizationId: nil) == "550e8400-e29b-41d4-a716-446655440000")
  }

  @Test func sidebarRefreshFailureThenRetryPreservesOpenTranscript() async throws {
    let (state, auth, transport, _) = try ephemeralState([
      (200, accessBody(gate: "ready")),
      (200, orgsBody),
      (200, userBody),
      (200, #"{"data":{"organizationId":null},"meta":{"timestamp":"2026-01-01T00:00:00.000Z","requestId":"req-1"}}"#),
      (200, roomsBody(names: ["general"])),
      (200, transcriptPageBody(messages: [], nextCursor: nil)),
      (200, roomReadBody(id: "550e8400-e29b-41d4-a716-446655440000", unread: 0)),
      (500, """
      {"error":"Internal Server Error","message":"boom","meta":{"timestamp":"\(timestamp)","requestId":"req-1","path":"/v1/chats/rooms","method":"GET"}}
      """),
      (200, roomsBody(names: ["renamed", "second"]))
    ])
    await state.reload(auth: auth)
    await waitForTranscriptIdle(state)
    let selected = state.selectedRoomId
    await state.refreshRooms(auth: auth)
    #expect(state.rooms.map(\.name) == ["general"])
    #expect(state.selectedRoomId == selected)
    #expect(state.sidebar.errorMessage != nil)
    await state.refreshRooms(auth: auth)
    #expect(state.rooms.map(\.name) == ["renamed", "second"])
    #expect(state.selectedRoomId == selected)
    #expect(state.transcriptRoomId == selected)
    #expect(state.sidebar.errorMessage == nil)
    #expect(transport.operationIDs.suffix(2) == ["get/chats/rooms", "get/chats/rooms"])
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
      (200, #"{"data":{"organizationId":null},"meta":{"timestamp":"2026-01-01T00:00:00.000Z","requestId":"req-1"}}"#),
      (200, roomsBody(names: ["general"])),
      (200, transcriptPageBody(messages: [], nextCursor: nil)),
      (200, roomReadBody(id: "550e8400-e29b-41d4-a716-446655440000", unread: 0)),
      (200, """
      {"data":{"organizationId":"org_1"},"meta":{"timestamp":"\(timestamp)","requestId":"req-1"}}
      """),
      (200, roomsBody(names: ["launch"])),
      (200, transcriptPageBody(messages: [], nextCursor: nil)),
      (200, roomReadBody(id: "550e8400-e29b-41d4-a716-446655440000", unread: 0, name: "launch"))
    ])
    await state.reload(auth: auth)
    await waitForTranscriptIdle(state)
    let org = try #require(state.options.first { $0.id == "org_1" })
    await state.switchRooms(auth: auth, option: org)
    await waitForTranscriptIdle(state)
    #expect(state.selectionId == "org_1")
    #expect(state.rooms.map(\.name) == ["launch"])
    #expect(transport.operationIDs.suffix(4) == [
      "put/users/{id}/preferred-organization",
      "get/chats/rooms",
      "get/chats/rooms/{id}/messages",
      "post/chats/rooms/{id}/read"
    ])
    // The new workspace selects its first room.
    #expect(state.selectedRoomId == "550e8400-e29b-41d4-a716-446655440000")
  }

  @Test func switchFailureKeepsOldSelectionAndRooms() async throws {
    let (state, auth, _, _) = try ephemeralState([
      (200, accessBody(gate: "ready")),
      (200, orgsBody),
      (200, userBody),
      (200, #"{"data":{"organizationId":null},"meta":{"timestamp":"2026-01-01T00:00:00.000Z","requestId":"req-1"}}"#),
      (200, roomsBody(names: ["general"])),
      (200, transcriptPageBody(messages: [], nextCursor: nil)),
      (200, roomReadBody(id: "550e8400-e29b-41d4-a716-446655440000", unread: 0)),
      (500, """
      {"error":"Internal Server Error","message":"boom","meta":{"timestamp":"\(timestamp)","requestId":"req-1","path":"/v1/users/me/preferred-organization","method":"PUT"}}
      """)
    ])
    await state.reload(auth: auth)
    await waitForTranscriptIdle(state)
    let org = try #require(state.options.first { $0.id == "org_1" })
    await state.switchRooms(auth: auth, option: org)
    #expect(state.selectionId == "personal")
    #expect(state.rooms.map(\.name) == ["general"])
    #expect(state.phase == .ready)
    #expect(state.switchError == "Core rejected the request (500): boom")
    #expect(state.selectedRoomId == "550e8400-e29b-41d4-a716-446655440000")
  }

  @Test func selectWhileLoadingIgnoresSecondSwitch() async throws {
    let (state, auth, transport, _) = try ephemeralState([
      (200, accessBody(gate: "ready")),
      (200, orgsBody),
      (200, userBody),
      (200, #"{"data":{"organizationId":null},"meta":{"timestamp":"2026-01-01T00:00:00.000Z","requestId":"req-1"}}"#),
      (200, roomsBody(names: ["general"])),
      (200, transcriptPageBody(messages: [], nextCursor: nil)),
      (200, roomReadBody(id: "550e8400-e29b-41d4-a716-446655440000", unread: 0)),
      (200, """
      {"data":{"organizationId":"org_1"},"meta":{"timestamp":"\(timestamp)","requestId":"req-1"}}
      """),
      (200, roomsBody(names: ["launch"])),
      (200, transcriptPageBody(messages: [], nextCursor: nil)),
      (200, roomReadBody(id: "550e8400-e29b-41d4-a716-446655440000", unread: 0, name: "launch"))
    ])
    await state.reload(auth: auth)
    await waitForTranscriptIdle(state)
    let org = try #require(state.options.first { $0.id == "org_1" })
    let personal = try #require(state.options.first { $0.id == "personal" })
    state.select(org, auth: auth)
    state.select(personal, auth: auth)
    for _ in 0 ..< 1000 where state.roomsLoading {
      await Task.yield()
    }
    await waitForTranscriptIdle(state)
    #expect(state.selectionId == "org_1")
    #expect(state.rooms.map(\.name) == ["launch"])
    #expect(transport.operationIDs.filter { $0.hasPrefix("put/") }.count == 1)
  }

  @Test func resetClearsEverything() async throws {
    let (state, auth, _, _) = try ephemeralState([
      (200, accessBody(gate: "ready")),
      (200, orgsBody),
      (200, userBody),
      (200, #"{"data":{"organizationId":null},"meta":{"timestamp":"2026-01-01T00:00:00.000Z","requestId":"req-1"}}"#),
      (200, roomsBody(names: ["general"])),
      (200, transcriptPageBody(messages: [], nextCursor: nil)),
      (200, roomReadBody(id: "550e8400-e29b-41d4-a716-446655440000", unread: 0)),
      (200, """
      {"data":{"organizationId":"org_1"},"meta":{"timestamp":"\(timestamp)","requestId":"req-1"}}
      """),
      (200, roomsBody(names: ["launch"])),
      (200, transcriptPageBody(messages: [], nextCursor: nil)),
      (200, roomReadBody(id: "550e8400-e29b-41d4-a716-446655440000", unread: 0))
    ])
    await state.reload(auth: auth)
    await waitForTranscriptIdle(state)
    let org = try #require(state.options.first { $0.id == "org_1" })
    await state.switchRooms(auth: auth, option: org)
    #expect(state.phase == .ready)
    #expect(state.selectedRoomId != nil)
    state.reset()
    #expect(state.phase == .idle)
    #expect(state.selectionId == nil)
    #expect(state.selectedRoomId == nil)
    #expect(state.rooms.isEmpty)
    #expect(state.currentUserName.isEmpty)
    #expect(state.switchError == nil)
  }

  @Test func switchRoomsListFailureRestoresPreviousPreference() async throws {
    let (state, auth, transport, _) = try ephemeralState([
      (200, accessBody(gate: "ready")),
      (200, orgsBody),
      (200, userBody),
      (200, #"{"data":{"organizationId":null},"meta":{"timestamp":"2026-01-01T00:00:00.000Z","requestId":"req-1"}}"#),
      (200, roomsBody(names: ["general"])),
      (200, transcriptPageBody(messages: [transcriptMessage(
        id: "550e8400-e29b-41d4-a716-446655440037",
        roomId: "550e8400-e29b-41d4-a716-446655440000",
        content: "kept"
      )], nextCursor: nil)),
      (200, roomReadBody(id: "550e8400-e29b-41d4-a716-446655440000", unread: 0)),
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
    await waitForTranscriptIdle(state)
    let org = try #require(state.options.first { $0.id == "org_1" })
    await state.switchRooms(auth: auth, option: org)
    #expect(state.selectionId == "personal")
    #expect(state.rooms.map(\.name) == ["general"])
    #expect(state.phase == .ready)
    #expect(state.selectedRoomId == "550e8400-e29b-41d4-a716-446655440000")
    // The retained room keeps its transcript instead of loading forever.
    #expect(state.transcriptRoomId == "550e8400-e29b-41d4-a716-446655440000")
    #expect(state.transcriptMessages.map(\.content) == ["kept"])
    #expect(state.transcriptError == nil)
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
      (200, #"{"data":{"organizationId":null},"meta":{"timestamp":"2026-01-01T00:00:00.000Z","requestId":"req-1"}}"#),
      (200, unreadRoomsBody(id: roomID, unread: 3)),
      (200, transcriptPageBody(messages: [], nextCursor: nil)),
      (200, roomReadBody(id: roomID, unread: 3)),
      (200, transcriptPageBody(messages: [transcriptMessage(
        id: "550e8400-e29b-41d4-a716-446655440031",
        roomId: roomID,
        content: "hello"
      )], nextCursor: nil)),
      (200, roomReadBody(id: roomID, unread: 0))
    ])
    await state.reload(auth: auth)
    await waitForTranscriptIdle(state)
    // Launch auto-opens the first room, preserving its unread from the DTO.
    #expect(state.selectedRoomId == roomID)
    #expect(state.rooms.first?.unreadCount == 3)
    let room = try #require(state.rooms.first)
    state.openRoom(room, auth: auth)
    await waitForTranscriptIdle(state)
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
    let historyFailure = (500, """
    {"error":"Internal Server Error","message":"boom","meta":{"timestamp":"\(timestamp)","requestId":"req-1","path":"/v1/chats/rooms/\(roomID)/messages","method":"GET"}}
    """)
    let (state, auth, transport, _) = try ephemeralState([
      (200, accessBody(gate: "ready")),
      (200, orgsBody),
      (200, userBody),
      (200, #"{"data":{"organizationId":null},"meta":{"timestamp":"2026-01-01T00:00:00.000Z","requestId":"req-1"}}"#),
      (200, unreadRoomsBody(id: roomID, unread: 3)),
      historyFailure,
      historyFailure
    ])
    await state.reload(auth: auth)
    await waitForTranscriptIdle(state)
    // Launch auto-open fails the same way: error shown, unread kept.
    #expect(state.selectedRoomId == roomID)
    #expect(state.rooms.first?.unreadCount == 3)
    let room = try #require(state.rooms.first)
    state.openRoom(room, auth: auth)
    await waitForTranscriptIdle(state)
    #expect(state.transcriptMessages.isEmpty)
    #expect(state.transcriptError != nil)
    #expect(state.rooms.first?.unreadCount == 3)
    #expect(!transport.operationIDs.contains("post/chats/rooms/{id}/read"))
  }

  @Test func savedRoomRestoredOnReload() async throws {
    let savedID = "550e8400-e29b-41d4-a716-446655440001"
    let (state, auth, _, defaults) = try ephemeralState([
      (200, accessBody(gate: "ready")),
      (200, orgsBody),
      (200, userBody),
      (200, #"{"data":{"organizationId":null},"meta":{"timestamp":"2026-01-01T00:00:00.000Z","requestId":"req-1"}}"#),
      (200, roomsBody(names: ["general", "random"])),
      (200, transcriptPageBody(messages: [], nextCursor: nil)),
      (200, roomReadBody(id: savedID, unread: 0))
    ])
    SavedRoomSelection(defaults: defaults).save(savedID, userId: "user_1", organizationId: nil)
    await state.reload(auth: auth)
    #expect(state.selectedRoomId == savedID)
    #expect(state.transcriptRoomId == savedID)
  }

  @Test func staleSavedRoomFallsBackToFirst() async throws {
    let firstID = "550e8400-e29b-41d4-a716-446655440000"
    let (state, auth, _, defaults) = try ephemeralState([
      (200, accessBody(gate: "ready")),
      (200, orgsBody),
      (200, userBody),
      (200, #"{"data":{"organizationId":null},"meta":{"timestamp":"2026-01-01T00:00:00.000Z","requestId":"req-1"}}"#),
      (200, roomsBody(names: ["general"])),
      (200, transcriptPageBody(messages: [], nextCursor: nil)),
      (200, roomReadBody(id: firstID, unread: 0))
    ])
    SavedRoomSelection(defaults: defaults).save("550e8400-e29b-41d4-a716-446655440099", userId: "user_1", organizationId: nil)
    await state.reload(auth: auth)
    #expect(state.selectedRoomId == firstID)
    #expect(SavedRoomSelection(defaults: defaults).load(userId: "user_1", organizationId: nil) == firstID)
  }

  @Test func selectRoomPersistsAndOpensTranscript() async throws {
    let secondID = "550e8400-e29b-41d4-a716-446655440001"
    let (state, auth, _, defaults) = try ephemeralState([
      (200, accessBody(gate: "ready")),
      (200, orgsBody),
      (200, userBody),
      (200, #"{"data":{"organizationId":null},"meta":{"timestamp":"2026-01-01T00:00:00.000Z","requestId":"req-1"}}"#),
      (200, roomsBody(names: ["general", "random"])),
      (200, transcriptPageBody(messages: [], nextCursor: nil)),
      (200, roomReadBody(id: "550e8400-e29b-41d4-a716-446655440000", unread: 0)),
      (200, transcriptPageBody(messages: [transcriptMessage(
        id: "550e8400-e29b-41d4-a716-446655440040",
        roomId: secondID,
        content: "hi"
      )], nextCursor: nil)),
      (200, roomReadBody(id: secondID, unread: 0))
    ])
    await state.reload(auth: auth)
    await waitForTranscriptIdle(state)
    state.selectRoom(secondID, auth: auth)
    await waitForTranscriptIdle(state)
    #expect(state.selectedRoomId == secondID)
    #expect(SavedRoomSelection(defaults: defaults).load(userId: "user_1", organizationId: nil) == secondID)
    #expect(state.transcriptRoomId == secondID)
    #expect(state.transcriptMessages.map(\.content) == ["hi"])
  }

  @Test func selectRoomNilKeepsOpenTranscript() async throws {
    let selected = "550e8400-e29b-41d4-a716-446655440000"
    let (state, auth, _, _) = try ephemeralState([
      (200, accessBody(gate: "ready")),
      (200, orgsBody),
      (200, userBody),
      (200, #"{"data":{"organizationId":null},"meta":{"timestamp":"2026-01-01T00:00:00.000Z","requestId":"req-1"}}"#),
      (200, roomsBody(names: ["general"])),
      (200, transcriptPageBody(messages: [transcriptMessage(
        id: "550e8400-e29b-41d4-a716-446655440041",
        roomId: selected,
        content: "kept"
      )], nextCursor: nil)),
      (200, roomReadBody(id: selected, unread: 0))
    ])
    await state.reload(auth: auth)
    await waitForTranscriptIdle(state)
    #expect(state.selectedRoomId == selected)
    #expect(state.transcriptMessages.map(\.content) == ["kept"])
    // List emits nil when a collapsed section drops tagged rows. That is
    // not a user deselect — keep the open transcript.
    state.selectRoom(nil, auth: auth)
    #expect(state.selectedRoomId == selected)
    #expect(state.transcriptRoomId == selected)
    #expect(state.transcriptMessages.map(\.content) == ["kept"])
  }

  @Test func changingRoomDropsPendingOutbound() async throws {
    let firstID = "550e8400-e29b-41d4-a716-446655440000"
    let secondID = "550e8400-e29b-41d4-a716-446655440001"
    let (state, auth, transport, _) = try ephemeralState([
      (200, accessBody(gate: "ready")),
      (200, orgsBody),
      (200, userBody),
      (200, #"{"data":{"organizationId":null},"meta":{"timestamp":"2026-01-01T00:00:00.000Z","requestId":"req-1"}}"#),
      (200, roomsBody(names: ["general", "random"])),
      (200, transcriptPageBody(messages: [], nextCursor: nil)),
      (200, roomReadBody(id: firstID, unread: 0)),
      // POST is paused before it consumes a stub, so the room switch
      // takes the next responses. 201 is leftover for the released POST.
      (200, transcriptPageBody(messages: [transcriptMessage(
        id: "550e8400-e29b-41d4-a716-446655440040",
        roomId: secondID,
        content: "hi"
      )], nextCursor: nil)),
      (200, roomReadBody(id: secondID, unread: 0)),
      (201, createdMessageBody(id: "550e8400-e29b-41d4-a716-446655440505", roomId: firstID, content: "hello"))
    ])
    await state.reload(auth: auth)
    await waitForTranscriptIdle(state)
    transport.pausePOST = true
    state.sendMessage("hello", auth: auth)
    for _ in 0 ..< 1000 where !transport.operationIDs.contains("post/chats/rooms/{id}/messages") {
      await Task.yield()
    }
    #expect(state.outboundShells.count == 1)
    state.selectRoom(secondID, auth: auth)
    await waitForTranscriptIdle(state)
    #expect(state.outboundShells.isEmpty)
    #expect(!state.outboundInFlight)
    transport.releasePOST()
    await transport.waitForPOSTCompletion()
    await waitForOutboundIdle(state)
    #expect(state.outboundShells.isEmpty)
    #expect(state.transcriptRoomId == secondID)
    #expect(transport.remainingStubs == 0)
  }

  @Test func missingThreadClientEndsInitialLoading() throws {
    let (state, _, _, _) = try ephemeralState([])
    let auth = AuthState(configuration: nil, store: MemoryTokenStore(), browser: MacOAuthBrowser(), restoreSession: false)
    state.clientResolver = nil
    #expect(state.resolveClient(auth: auth) == nil)
    state.thread.timeline.reset(roomId: "room", parentMessageId: "parent")
    #expect(state.thread.timeline.isLoading)
    state.loadThreadPage(.initial, auth: auth)
    #expect(!state.thread.timeline.isLoading)
    #expect(state.thread.timeline.failedPage == .initial)
    #expect(state.thread.timeline.errorMessage == "Sign-in is not configured.")
  }

  @Test(arguments: ["Me", ""]) func outboundSenderUsesEmailForEmptyName(name: String) async throws {
    let (state, auth, _, _) = try ephemeralState([
      (200, accessBody(gate: "ready")), (200, orgsBody),
      (200, userBody.replacingOccurrences(of: "\"name\":\"Me\"", with: "\"name\":\"\(name)\"")),
      (200, #"{"data":{"organizationId":null},"meta":{"timestamp":"2026-01-01T00:00:00.000Z","requestId":"req-1"}}"#),
      (200, roomsBody(names: []))
    ])
    await state.reload(auth: auth)
    #expect(state.outboundSender.name == (name.isEmpty ? "me@example.com" : name))
    #expect(state.outboundSender.email == "me@example.com")
  }

  @Test(arguments: [false, true], [false, true]) func openingThreadLooksThenReadsRoomBeforeFetchingReplies(initialFailure: Bool, olderRoomFailure: Bool) async throws {
    let roomID = "550e8400-e29b-41d4-a716-446655440000"
    let rootID = "550e8400-e29b-41d4-a716-446655440034"
    let root = transcriptMessage(id: rootID, roomId: roomID, content: "Parent")
    let reply = transcriptMessage(id: "550e8400-e29b-41d4-a716-446655440035", roomId: roomID, content: "Reply")
      .replacingOccurrences(of: "\"parentMessageId\":null", with: "\"parentMessageId\":\"\(rootID)\"")
    var responses: [(Int, String)] = [
      (200, accessBody(gate: "ready")), (200, orgsBody), (200, userBody),
      (200, #"{"data":{"organizationId":null},"meta":{"timestamp":"2026-01-01T00:00:00.000Z","requestId":"req-1"}}"#),
      (200, roomsBody(names: ["general"])),
      (200, transcriptPageBody(messages: [root], nextCursor: olderRoomFailure ? "older-room" : nil)),
      (200, roomReadBody(id: roomID, unread: 3))
    ]
    responses += olderRoomFailure ? [(503, "{}")] : []
    let attention: [(Int, String)] = [
      (200, #"{"data":{"parentMessageId":"\#(rootID)","lastReadAt":"\#(timestamp)"},"meta":{"timestamp":"\#(timestamp)","requestId":"test"}}"#),
      (200, roomReadBody(id: roomID, unread: 2))
    ]
    responses += attention
    responses += initialFailure ? [(503, "{}")] + attention : []
    responses.append((200, transcriptPageBody(messages: [reply], nextCursor: "older-replies")))
    let (state, auth, transport, _) = try ephemeralState(responses)
    await state.reload(auth: auth)
    await waitForTranscriptIdle(state)
    if olderRoomFailure {
      state.loadOlderMessages(auth: auth)
      await state.olderPageTask?.value
      #expect(state.timeline.failedPage == .older)
    }
    try state.openThread(#require(state.transcriptMessages.first), auth: auth)
    await state.thread.loadTask?.value
    if initialFailure {
      #expect(state.thread.timeline.failedPage == .initial)
      state.thread.recovery.requestRefresh()
      while state.thread.recovery.isRefreshing {
        await Task.yield()
      }
    }
    #expect(state.thread.timeline.hasLoadedHistory)
    #expect(state.thread.timeline.cursor == "older-replies")
    #expect(state.thread.timeline.hasMore)
    #expect(state.thread.parent?.id == rootID)
    #expect(state.thread.displayedReplies.map(\.content) == ["Reply"])
    #expect(state.transcriptMessages.map(\.content) == ["Parent"])
    #expect(state.rooms.first?.unreadCount == 2)
    #expect(transport.operationIDs.suffix(3) == [
      "post/chats/rooms/{id}/threads/{parentMessageId}/read",
      "post/chats/rooms/{id}/read",
      "get/chats/rooms/{id}/threads/{parentMessageId}/messages"
    ])
    state.thread.close()
  }

  @Test func failedReadKeepsResolvedHistory() async throws {
    let roomID = "550e8400-e29b-41d4-a716-446655440035"
    let (state, auth, transport, _) = try ephemeralState([
      (200, accessBody(gate: "ready")),
      (200, orgsBody),
      (200, userBody),
      (200, #"{"data":{"organizationId":null},"meta":{"timestamp":"2026-01-01T00:00:00.000Z","requestId":"req-1"}}"#),
      (200, unreadRoomsBody(id: roomID, unread: 2)),
      (200, transcriptPageBody(messages: [transcriptMessage(
        id: "550e8400-e29b-41d4-a716-446655440036",
        roomId: roomID,
        content: "visible"
      )], nextCursor: nil)),
      (500, """
      {"error":"Internal Server Error","message":"boom","meta":{"timestamp":"\(timestamp)","requestId":"req-1","path":"/v1/chats/rooms/\(roomID)/read","method":"POST"}}
      """)
    ])
    await state.reload(auth: auth)
    await waitForTranscriptIdle(state)
    // History resolved before the read failed: it stays on screen with no
    // modal (background reads fail silently), and unread chrome is
    // untouched (no DTO to apply).
    #expect(state.transcriptMessages.map(\.content) == ["visible"])
    #expect(state.readAttention.errorMessage == nil)
    #expect(state.rooms.first?.unreadCount == 2)
    #expect(transport.operationIDs.suffix(2) == [
      "get/chats/rooms/{id}/messages",
      "post/chats/rooms/{id}/read"
    ])
  }

  @Test func hiddenHistoryDefersReadUntilWindowBecomesVisible() async throws {
    let roomID = "550e8400-e29b-41d4-a716-446655440033"
    let (state, auth, transport, _) = try ephemeralState([
      (200, accessBody(gate: "ready")), (200, orgsBody), (200, userBody),
      (200, #"{"data":{"organizationId":null},"meta":{"timestamp":"2026-01-01T00:00:00.000Z","requestId":"req-1"}}"#),
      (200, unreadRoomsBody(id: roomID, unread: 2)),
      (200, transcriptPageBody(messages: [], nextCursor: nil)),
      (200, roomReadBody(id: roomID, unread: 1))
    ], visible: false)
    await state.reload(auth: auth)
    await waitForTranscriptIdle(state)
    #expect(!transport.operationIDs.contains("post/chats/rooms/{id}/read"))
    #expect(state.rooms.first?.unreadCount == 2)
    state.readAttention.setVisible(true, window: UUID())
    await state.syncReadAttention(auth: auth)
    #expect(state.rooms.first?.unreadCount == 1)
    #expect(transport.operationIDs.filter { $0 == "post/chats/rooms/{id}/read" }.count == 1)
  }

  @Test func successfulRefreshRetryMarksUnchangedVisibleContentRead() async throws {
    let roomID = "550e8400-e29b-41d4-a716-446655440033"
    let messageID = "550e8400-e29b-41d4-a716-446655440034"
    let page = transcriptPageBody(messages: [transcriptMessage(id: messageID, roomId: roomID, content: "first")], nextCursor: nil)
    let updatedPage = transcriptPageBody(messages: [transcriptMessage(id: messageID, roomId: roomID, content: "updated")], nextCursor: nil)
    let (state, auth, transport, _) = try ephemeralState([
      (200, accessBody(gate: "ready")), (200, orgsBody), (200, userBody),
      (200, #"{"data":{"organizationId":null},"meta":{"timestamp":"2026-01-01T00:00:00.000Z","requestId":"req-1"}}"#),
      (200, unreadRoomsBody(id: roomID, unread: 2)),
      (200, page), (200, roomReadBody(id: roomID, unread: 0)),
      (500, #"{"error":"Internal Server Error","message":"boom","meta":{"timestamp":"2026-01-01T00:00:00.000Z","requestId":"req-1","path":"/messages","method":"GET"}}"#),
      (200, updatedPage), (200, roomReadBody(id: roomID, unread: 1))
    ])
    await state.reload(auth: auth)
    await waitForTranscriptIdle(state)
    state.refreshTranscript(auth: auth)
    await waitForTranscriptIdle(state)
    #expect(state.timeline.failedPage == .latest)
    // A realtime update arrives while the failed refresh blocks reads.
    let messageIndex = try #require(state.timeline.messages.firstIndex { $0.id == messageID })
    state.timeline.messages[messageIndex].content = "updated"
    await state.syncReadAttention(auth: auth)
    #expect(transport.operationIDs.filter { $0 == "post/chats/rooms/{id}/read" }.count == 1)
    state.refreshTranscript(auth: auth)
    await waitForTranscriptIdle(state)
    #expect(state.timeline.failedPage == nil)
    #expect(state.transcriptMessages.map(\.content) == ["updated"])
    #expect(transport.operationIDs.filter { $0 == "post/chats/rooms/{id}/read" }.count == 2)
    #expect(state.rooms.first?.unreadCount == 1)
  }

  @Test func failedOlderPageKeepsResolvedHistory() async throws {
    let roomID = "550e8400-e29b-41d4-a716-446655440033"
    let (state, auth, transport, _) = try ephemeralState([
      (200, accessBody(gate: "ready")),
      (200, orgsBody),
      (200, userBody),
      (200, #"{"data":{"organizationId":null},"meta":{"timestamp":"2026-01-01T00:00:00.000Z","requestId":"req-1"}}"#),
      (200, unreadRoomsBody(id: roomID, unread: 1)),
      (200, transcriptPageBody(messages: [transcriptMessage(
        id: "550e8400-e29b-41d4-a716-446655440034",
        roomId: roomID,
        content: "newest"
      )], nextCursor: "cursor-1")),
      (200, roomReadBody(id: roomID, unread: 0)),
      (500, """
      {"error":"Internal Server Error","message":"boom","meta":{"timestamp":"\(timestamp)","requestId":"req-1","path":"/v1/chats/rooms/\(roomID)/messages","method":"GET"}}
      """)
    ])
    await state.reload(auth: auth)
    await waitForTranscriptIdle(state)
    #expect(state.transcriptHasMore)
    state.loadOlderMessages(auth: auth)
    await waitForTranscriptIdle(state)
    // Resolved history stays; the failure surfaces as a banner instead.
    #expect(state.transcriptMessages.map(\.content) == ["newest"])
    #expect(state.transcriptError != nil)
    #expect(state.transcriptHasMore)
    #expect(transport.operationIDs.filter { $0 == "get/chats/rooms/{id}/messages" }.count == 2)
  }

  @Test func sendPaintsPendingThenConfirmed() async throws {
    let roomID = "550e8400-e29b-41d4-a716-446655440000"
    let confirmedID = "550e8400-e29b-41d4-a716-446655440501"
    let (state, auth, transport, _) = try ephemeralState([
      (200, accessBody(gate: "ready")),
      (200, orgsBody),
      (200, userBody),
      (200, #"{"data":{"organizationId":null},"meta":{"timestamp":"2026-01-01T00:00:00.000Z","requestId":"req-1"}}"#),
      (200, roomsBody(names: ["general"])),
      (200, transcriptPageBody(messages: [], nextCursor: nil)),
      (200, roomReadBody(id: roomID, unread: 0)),
      (201, createdMessageBody(id: confirmedID, roomId: roomID, content: "hello"))
    ])
    await state.reload(auth: auth)
    await waitForTranscriptIdle(state)
    transport.pausePOST = true
    state.sendMessage("hello", auth: auth)
    #expect(state.outboundShells.count == 1)
    #expect(state.outboundShells[0].status == .pending)
    #expect(state.displayedTranscript.map(\.content) == ["hello"])
    #expect(isOutboundLocalMessage(state.displayedTranscript[0]))
    for _ in 0 ..< 1000 where !transport.operationIDs.contains("post/chats/rooms/{id}/messages") {
      await Task.yield()
    }
    transport.releasePOST()
    await waitForOutboundIdle(state)
    #expect(state.outboundShells.isEmpty)
    #expect(state.displayedTranscript.map(\.content) == ["hello"])
    #expect(state.transcriptMessages.map(\.id) == [confirmedID])
    #expect(transport.operationIDs.last == "post/chats/rooms/{id}/messages")
  }

  @Test func failedSendRetryReusesTurnAndRemoveDropsShell() async throws {
    let roomID = "550e8400-e29b-41d4-a716-446655440000"
    let confirmedID = "550e8400-e29b-41d4-a716-446655440502"
    let (state, auth, transport, _) = try ephemeralState([
      (200, accessBody(gate: "ready")),
      (200, orgsBody),
      (200, userBody),
      (200, #"{"data":{"organizationId":null},"meta":{"timestamp":"2026-01-01T00:00:00.000Z","requestId":"req-1"}}"#),
      (200, roomsBody(names: ["general"])),
      (200, transcriptPageBody(messages: [], nextCursor: nil)),
      (200, roomReadBody(id: roomID, unread: 0)),
      (500, """
      {"error":"Internal Server Error","message":"boom","meta":{"timestamp":"\(timestamp)","requestId":"req-1","path":"/v1/chats/rooms/\(roomID)/messages","method":"POST"}}
      """),
      (201, createdMessageBody(id: confirmedID, roomId: roomID, content: "hello"))
    ])
    await state.reload(auth: auth)
    await waitForTranscriptIdle(state)
    state.sendMessage("hello", auth: auth)
    await waitForOutboundIdle(state)
    #expect(state.outboundShells.count == 1)
    #expect(state.outboundShells[0].status == .failed)
    #expect(state.displayedTranscript.map(\.content) == ["hello"])
    let turnId = try #require(state.outboundShells.first?.clientTurnId)
    state.retryOutbound(clientTurnId: turnId)
    await waitForOutboundIdle(state)
    #expect(state.outboundShells.isEmpty)
    #expect(state.transcriptMessages.map(\.id) == [confirmedID])
    let posts = zip(transport.operationIDs, transport.bodies).compactMap { id, body -> [String: Any]? in
      guard id == "post/chats/rooms/{id}/messages" else { return nil }
      return (try? JSONSerialization.jsonObject(with: body) as? [String: Any]) ?? [:]
    }
    #expect(posts.count == 2)
    #expect(posts[0]["clientMessageId"] as? String == turnId)
    #expect(posts[1]["clientMessageId"] as? String == turnId)
    #expect(posts[0]["content"] as? String == "hello")
    #expect(posts[1]["content"] as? String == "hello")
  }

  @Test func failedSendRemoveDropsLocalShellOnly() async throws {
    let roomID = "550e8400-e29b-41d4-a716-446655440000"
    let (state, auth, transport, _) = try ephemeralState([
      (200, accessBody(gate: "ready")),
      (200, orgsBody),
      (200, userBody),
      (200, #"{"data":{"organizationId":null},"meta":{"timestamp":"2026-01-01T00:00:00.000Z","requestId":"req-1"}}"#),
      (200, roomsBody(names: ["general"])),
      (200, transcriptPageBody(messages: [], nextCursor: nil)),
      (200, roomReadBody(id: roomID, unread: 0)),
      (500, """
      {"error":"Internal Server Error","message":"boom","meta":{"timestamp":"\(timestamp)","requestId":"req-1","path":"/v1/chats/rooms/\(roomID)/messages","method":"POST"}}
      """)
    ])
    await state.reload(auth: auth)
    await waitForTranscriptIdle(state)
    state.sendMessage("hello", auth: auth)
    await waitForOutboundIdle(state)
    let turnId = try #require(state.outboundShells.first?.clientTurnId)
    state.removeOutbound(clientTurnId: turnId)
    #expect(state.outboundShells.isEmpty)
    #expect(state.displayedTranscript.isEmpty)
    #expect(transport.operationIDs.filter { $0 == "post/chats/rooms/{id}/messages" }.count == 1)
  }

  @Test func inFlightSendQueuesASecond() async throws {
    let roomID = "550e8400-e29b-41d4-a716-446655440000"
    let confirmedID = "550e8400-e29b-41d4-a716-446655440503"
    let (state, auth, transport, _) = try ephemeralState([
      (200, accessBody(gate: "ready")),
      (200, orgsBody),
      (200, userBody),
      (200, #"{"data":{"organizationId":null},"meta":{"timestamp":"2026-01-01T00:00:00.000Z","requestId":"req-1"}}"#),
      (200, roomsBody(names: ["general"])),
      (200, transcriptPageBody(messages: [], nextCursor: nil)),
      (200, roomReadBody(id: roomID, unread: 0)),
      (201, createdMessageBody(id: confirmedID, roomId: roomID, content: "first")),
      (201, createdMessageBody(id: "550e8400-e29b-41d4-a716-446655440504", roomId: roomID, content: "second"))
    ])
    await state.reload(auth: auth)
    await waitForTranscriptIdle(state)
    transport.pausePOST = true
    state.sendMessage("first", auth: auth)
    for _ in 0 ..< 1000 where !transport.operationIDs.contains("post/chats/rooms/{id}/messages") {
      await Task.yield()
    }
    state.sendMessage("second", auth: auth)
    #expect(state.outboundShells.count == 2)
    #expect(state.outboundShells[0].content == "first")
    transport.pausePOST = false
    transport.releasePOST()
    await waitForOutboundIdle(state)
    #expect(state.displayedTranscript.map(\.content) == ["first", "second"])
    #expect(transport.operationIDs.filter { $0 == "post/chats/rooms/{id}/messages" }.count == 2)
  }

  @Test func failedSwitchDuringSendSettlesOutboundAndFreesSlot() async throws {
    let roomID = "550e8400-e29b-41d4-a716-446655440000"
    let confirmedID = "550e8400-e29b-41d4-a716-446655440504"
    let (state, auth, transport, _) = try ephemeralState([
      (200, accessBody(gate: "ready")),
      (200, orgsBody),
      (200, userBody),
      (200, #"{"data":{"organizationId":null},"meta":{"timestamp":"2026-01-01T00:00:00.000Z","requestId":"req-1"}}"#),
      (200, roomsBody(names: ["general"])),
      (200, transcriptPageBody(messages: [], nextCursor: nil)),
      (200, roomReadBody(id: roomID, unread: 0)),
      // POST is paused before it consumes a response, so the switch PUT
      // takes the next stub. 500 then 201 is the in-flight order.
      (500, """
      {"error":"Internal Server Error","message":"boom","meta":{"timestamp":"\(timestamp)","requestId":"req-1","path":"/v1/users/me/preferred-organization","method":"PUT"}}
      """),
      (201, createdMessageBody(id: confirmedID, roomId: roomID, content: "hello"))
    ])
    await state.reload(auth: auth)
    await waitForTranscriptIdle(state)
    transport.pausePOST = true
    state.sendMessage("hello", auth: auth)
    for _ in 0 ..< 1000 where !transport.operationIDs.contains("post/chats/rooms/{id}/messages") {
      await Task.yield()
    }
    #expect(state.outboundInFlight)
    #expect(state.outboundShells[0].status == .pending)
    let org = try #require(state.options.first { $0.id == "org_1" })
    await state.switchRooms(auth: auth, option: org)
    #expect(state.selectionId == "personal")
    #expect(state.switchError != nil)
    transport.releasePOST()
    await waitForOutboundIdle(state)
    #expect(!state.outboundInFlight)
    #expect(state.outboundShells.isEmpty)
    #expect(state.transcriptMessages.map(\.id) == [confirmedID])
  }

  @Test func directSendUsesStreamAndSettlesHistoryWithoutClassicOutbox() async throws {
    let roomId = "550e8400-e29b-41d4-a716-446655440000"
    let stream = "data: {\"type\":\"start\",\"messageId\":\"answer\"}\n\ndata: {\"type\":\"text-start\",\"id\":\"text\"}\n\ndata: {\"type\":\"text-delta\",\"id\":\"text\",\"delta\":\"Answer\"}\n\ndata: {\"type\":\"text-end\",\"id\":\"text\"}\n\ndata: {\"type\":\"finish\"}\n\ndata: [DONE]\n\n"
    let (state, auth, transport, _) = try ephemeralState([
      (200, transcriptPageBody(messages: [], nextCursor: nil)),
      (200, stream),
      (200, transcriptPageBody(messages: [transcriptMessage(id: "persisted", roomId: roomId, content: "Answer")], nextCursor: nil))
    ], visible: false)
    let sender = Components.Schemas.ChatRoomUserParticipant(id: "me", name: "Me", email: "me@example.com", presence: .online)
    let room = Components.Schemas.ChatRoom(id: roomId, name: "Coworker", kind: .direct, createdByUserId: "me", createdAt: Date(), updatedAt: Date(), unreadCount: 0, unreadMentionCount: 0, markedUnread: false, myAccess: .member, userMembers: [sender], coworkerMembers: [.init(id: "coworker", name: "Coworker", slug: "coworker", presence: .online)], sokoBotMembers: [])
    state.timeline.reset(roomId: roomId)
    let client = try #require(state.clientResolver?())
    _ = try await state.timeline.loadPage(.initial, client: client, organizationSlug: nil, generation: state.timeline.generation)
    state.directStream.reset(room: room)
    #expect(state.sendMessage("Hello", auth: auth))
    #expect(!state.sendMessage("Again", auth: auth))
    #expect(state.outboundShells.isEmpty)
    let echo = chatRoomMessage(from: .init(clientTurnId: "echo", roomId: roomId, content: "Hello", sender: sender))
    state.applyRealtimeMessage(roomId: roomId, eventType: .create, message: echo)
    #expect(state.transcriptMessages.isEmpty)
    var root = echo
    root.id = "root"
    state.transcriptMessages = [root]
    #expect(state.thread.open(root))
    state.applyRealtimeEnvelope(.init(eventType: .delete, messageId: "root", roomId: roomId))
    #expect(state.thread.parent?.deletedAt != nil)
    #expect(state.transcriptMessages.first?.deletedAt != nil)
    await state.directStream.task?.value
    #expect(state.directStream.overlayMessages.isEmpty)
    #expect(Set(state.displayedTranscript.map(\.id)) == ["persisted", "root"])
    #expect(state.transcriptMessages.first { $0.id == "root" }?.deletedAt != nil)
    #expect(transport.operationIDs == ["get/chats/rooms/{id}/messages", "post/chats/rooms/{id}/stream", "get/chats/rooms/{id}/messages"])
    state.clearTranscript()
    #expect(state.directStream.roomId == nil)
  }

  @Test(arguments: [false, true])
  func threadStreamSettlesAndReopensClosedParent(closeThread: Bool) async throws {
    let roomId = "550e8400-e29b-41d4-a716-446655440000"
    let root = transcriptMessage(id: "root", roomId: roomId, content: "Parent")
    let reply = transcriptMessage(id: "reply", roomId: roomId, content: "Answer")
      .replacingOccurrences(of: "\"parentMessageId\":null", with: "\"parentMessageId\":\"root\"")
    let stream = "data: {\"type\":\"start\",\"messageId\":\"answer\"}\n\ndata: {\"type\":\"finish\"}\n\ndata: [DONE]\n\n"
    let responses: [(Int, String)] = [
      (200, transcriptPageBody(messages: [root], nextCursor: nil)),
      (200, stream),
      (200, transcriptPageBody(messages: [root], nextCursor: nil)),
      (200, transcriptPageBody(messages: [reply], nextCursor: nil))
    ]
    let (state, auth, transport, _) = try ephemeralState(responses, visible: false)
    let sender = Components.Schemas.ChatRoomUserParticipant(id: "me", name: "Me", email: "me@example.com", presence: .online)
    let room = Components.Schemas.ChatRoom(id: roomId, name: "Coworker", kind: .direct, createdByUserId: "me", createdAt: Date(), updatedAt: Date(), unreadCount: 0, unreadMentionCount: 0, markedUnread: false, myAccess: .member, userMembers: [sender], coworkerMembers: [.init(id: "coworker", name: "Coworker", slug: "coworker", presence: .online)], sokoBotMembers: [])
    state.timeline.reset(roomId: roomId)
    let client = try #require(state.clientResolver?())
    _ = try await state.timeline.loadPage(.initial, client: client, organizationSlug: nil, generation: state.timeline.generation)
    state.directStream.reset(room: room)
    #expect(try state.thread.open(#require(state.transcriptMessages.first)))
    #expect(state.sendThreadReply("Thread turn", auth: auth))
    #expect(!state.sendMessage("Room turn", auth: auth))
    #expect(state.thread.outbox.shells.isEmpty)
    #expect(state.displayedTranscript.map(\.id) == ["root"])
    #expect(state.displayedThreadReplies.first?.content == "Thread turn")
    if closeThread {
      state.thread.close()
      #expect(state.streamingThreadToOpen?.id == "root")
    }
    await state.directStream.task?.value
    #expect(state.thread.parent?.id == "root")
    #expect(state.displayedThreadReplies.map(\.id) == ["reply"])
    #expect(state.directStream.overlayMessages.isEmpty)
    #expect(transport.threadGets == 1)
    #expect(!transport.operationIDs.contains("post/chats/rooms/{id}/messages"))
  }

  @Test func parentEnvelopeWhileStreamingRefetchesParent() async throws {
    let roomId = "550e8400-e29b-41d4-a716-446655440000"
    let stream = "data: {\"type\":\"start\",\"messageId\":\"answer\"}\n\ndata: {\"type\":\"text-start\",\"id\":\"text\"}\n\ndata: {\"type\":\"text-delta\",\"id\":\"text\",\"delta\":\"Answer\"}\n\ndata: {\"type\":\"text-end\",\"id\":\"text\"}\n\ndata: {\"type\":\"finish\"}\n\ndata: [DONE]\n\n"
    let root = transcriptMessage(id: "root", roomId: roomId, content: "Parent")
    let updatedRoot = transcriptMessage(id: "root", roomId: roomId, content: "Parent edited")
    let (state, auth, transport, _) = try ephemeralState([
      (200, transcriptPageBody(messages: [root], nextCursor: nil)),
      (200, stream),
      (200, transcriptPageBody(messages: [updatedRoot], nextCursor: nil)),
      (200, transcriptPageBody(messages: [
        updatedRoot,
        transcriptMessage(id: "persisted", roomId: roomId, content: "Answer")
      ], nextCursor: nil))
    ], visible: false)
    let sender = Components.Schemas.ChatRoomUserParticipant(id: "me", name: "Me", email: "me@example.com", presence: .online)
    let room = Components.Schemas.ChatRoom(id: roomId, name: "Coworker", kind: .direct, createdByUserId: "me", createdAt: Date(), updatedAt: Date(), unreadCount: 0, unreadMentionCount: 0, markedUnread: false, myAccess: .member, userMembers: [sender], coworkerMembers: [.init(id: "coworker", name: "Coworker", slug: "coworker", presence: .online)], sokoBotMembers: [])
    state.timeline.reset(roomId: roomId)
    let client = try #require(state.clientResolver?())
    _ = try await state.timeline.loadPage(.initial, client: client, organizationSlug: nil, generation: state.timeline.generation)
    state.directStream.reset(room: room)
    let parent = try #require(state.transcriptMessages.first)
    #expect(state.thread.open(parent))
    state.transcriptRecovery.start(foreground: true, healthy: true) {
      state.refreshTranscript(auth: auth)
      while state.transcriptRefreshTask != nil {
        await state.transcriptRefreshTask?.value
      }
    }
    transport.pauseStream = true
    #expect(state.sendMessage("Hello", auth: auth))
    for _ in 0 ..< 1000 where !transport.operationIDs.contains("post/chats/rooms/{id}/stream") {
      await Task.yield()
    }
    #expect(state.directStream.isBusy)
    state.applyRealtimeEnvelope(.init(eventType: .update, messageId: "root", roomId: roomId))
    for _ in 0 ..< 1000 where state.thread.parent?.content != "Parent edited" {
      await Task.yield()
    }
    #expect(state.thread.parent?.content == "Parent edited")
    transport.releasePOST()
    await state.directStream.task?.value
    #expect(state.thread.parent?.content == "Parent edited")
    #expect(transport.operationIDs.filter { $0 == "get/chats/rooms/{id}/messages" }.count >= 2)
  }

  @Test func olderHistoryDoesNotLoadWhileDirectStreamIsBusy() async throws {
    let roomId = "550e8400-e29b-41d4-a716-446655440000"
    let stream = "data: {\"type\":\"start\",\"messageId\":\"answer\"}\n\ndata: {\"type\":\"finish\"}\n\ndata: [DONE]\n\n"
    let (state, auth, transport, _) = try ephemeralState([
      (200, transcriptPageBody(messages: [transcriptMessage(id: "newest", roomId: roomId, content: "newest")], nextCursor: "older")),
      (200, stream),
      (200, transcriptPageBody(messages: [transcriptMessage(id: "persisted", roomId: roomId, content: "Answer")], nextCursor: nil))
    ], visible: false)
    let sender = Components.Schemas.ChatRoomUserParticipant(id: "me", name: "Me", email: "me@example.com", presence: .online)
    let room = Components.Schemas.ChatRoom(id: roomId, name: "Coworker", kind: .direct, createdByUserId: "me", createdAt: Date(), updatedAt: Date(), unreadCount: 0, unreadMentionCount: 0, markedUnread: false, myAccess: .member, userMembers: [sender], coworkerMembers: [.init(id: "coworker", name: "Coworker", slug: "coworker", presence: .online)], sokoBotMembers: [])
    state.timeline.reset(roomId: roomId)
    let client = try #require(state.clientResolver?())
    _ = try await state.timeline.loadPage(.initial, client: client, organizationSlug: nil, generation: state.timeline.generation)
    state.directStream.reset(room: room)
    transport.pauseStream = true
    #expect(state.sendMessage("Hello", auth: auth))
    for _ in 0 ..< 1000 where !transport.operationIDs.contains("post/chats/rooms/{id}/stream") {
      await Task.yield()
    }
    #expect(state.transcriptHasMore)
    state.loadOlderMessages(auth: auth)
    #expect(state.olderPageTask == nil)
    #expect(transport.operationIDs.filter { $0 == "get/chats/rooms/{id}/messages" }.count == 1)
    transport.releasePOST()
    await state.directStream.task?.value
    #expect(transport.operationIDs.filter { $0 == "get/chats/rooms/{id}/messages" }.count == 2)
  }

  @Test func closingThreadDuringSettleStillClearsOverlay() async throws {
    let roomId = "550e8400-e29b-41d4-a716-446655440000"
    let fixtures = ThreadStreamFixtures(roomId: roomId)
    let prepared = try await preparedCoworkerDirect(roomId: roomId, responses: [
      (200, transcriptPageBody(messages: [fixtures.root], nextCursor: nil)),
      (200, fixtures.stream),
      (200, transcriptPageBody(messages: [fixtures.root], nextCursor: nil)),
      (200, transcriptPageBody(messages: [fixtures.reply], nextCursor: nil)),
      (200, transcriptPageBody(messages: [fixtures.reply], nextCursor: nil))
    ])
    let parent = try #require(prepared.state.transcriptMessages.first)
    #expect(prepared.state.thread.open(parent))
    prepared.transport.pauseGET = true
    #expect(prepared.state.sendThreadReply("Thread turn", auth: prepared.auth))
    await waitWhile { prepared.transport.messageGets < 2 }
    prepared.state.thread.close()
    #expect(prepared.state.streamingThreadToOpen?.id == "root")
    prepared.transport.releasePOST()
    await waitWhile { prepared.transport.threadGets == 0 }
    prepared.state.openThread(parent, auth: prepared.auth)
    prepared.transport.releasePOST()
    await prepared.state.directStream.task?.value
    #expect(prepared.state.thread.parent?.id == "root")
    #expect(prepared.state.directStream.overlayMessages.isEmpty)
    #expect(prepared.transport.threadGets == 1)
  }

  @Test func roomReentryResumeOpensRetainedThreadOnSettle() async throws {
    let roomId = "550e8400-e29b-41d4-a716-446655440000"
    let fixtures = ThreadStreamFixtures(roomId: roomId)
    let prepared = try await preparedCoworkerDirect(roomId: roomId, responses: [
      (200, transcriptPageBody(messages: [fixtures.root], nextCursor: nil)),
      (200, fixtures.stream),
      (500, """
      {"error":"Internal Server Error","message":"boom","meta":{"timestamp":"\(timestamp)","requestId":"req-1","path":"/v1/chats/rooms/\(roomId)/messages","method":"GET"}}
      """),
      (200, fixtures.stream),
      (200, transcriptPageBody(messages: [fixtures.root], nextCursor: nil)),
      (200, transcriptPageBody(messages: [fixtures.reply], nextCursor: nil)),
      (200, transcriptPageBody(messages: [fixtures.reply], nextCursor: nil))
    ])
    #expect(try prepared.state.thread.open(#require(prepared.state.transcriptMessages.first)))
    #expect(prepared.state.sendThreadReply("Thread turn", auth: prepared.auth))
    await prepared.state.directStream.task?.value
    prepared.state.thread.close()
    prepared.state.directStream.reset(room: prepared.room)
    #expect(prepared.state.directStream.parentMessageId == "root")
    prepared.transport.pauseStream = true
    prepared.transport.pauseGET = true
    prepared.state.directStream.resume(client: prepared.client, organizationSlug: nil, settled: {
      await prepared.state.settleDirectStream(auth: prepared.auth, generation: prepared.state.timeline.generation)
    }, failed: { Issue.record($0) })
    await waitWhile { !prepared.transport.operationIDs.contains("get/chats/rooms/{id}/stream/active") }
    #expect(prepared.state.directStream.phase == .resuming)
    #expect(prepared.state.streamingThreadToOpen == nil)
    prepared.transport.releasePOST()
    await waitWhile { prepared.transport.messageGets < 3 }
    #expect(prepared.state.streamingThreadToOpen?.id == "root")
    prepared.transport.releasePOST()
    await waitWhile { prepared.transport.threadGets == 0 }
    prepared.transport.releasePOST()
    await prepared.state.directStream.task?.value
    #expect(prepared.state.thread.parent?.id == "root")
    #expect(prepared.state.displayedThreadReplies.map(\.id) == ["reply"])
    #expect(prepared.state.directStream.overlayMessages.isEmpty)
    #expect(prepared.transport.threadGets == 1)
  }
}

private extension ScriptedTransport {
  var messageGets: Int {
    operationIDs.filter { $0 == "get/chats/rooms/{id}/messages" }.count
  }

  var threadGets: Int {
    operationIDs.filter { $0 == "get/chats/rooms/{id}/threads/{parentMessageId}/messages" }.count
  }
}

private func waitWhile(_ condition: () -> Bool) async {
  for _ in 0 ..< 1000 where condition() {
    await Task.yield()
  }
}

private func coworkerDirect(roomId: String) -> Components.Schemas.ChatRoom {
  let sender = Components.Schemas.ChatRoomUserParticipant(id: "me", name: "Me", email: "me@example.com", presence: .online)
  return .init(
    id: roomId, name: "Coworker", kind: .direct, createdByUserId: "me", createdAt: Date(), updatedAt: Date(),
    unreadCount: 0, unreadMentionCount: 0, markedUnread: false, myAccess: .member, userMembers: [sender],
    coworkerMembers: [.init(id: "coworker", name: "Coworker", slug: "coworker", presence: .online)], sokoBotMembers: []
  )
}

private struct ThreadStreamFixtures {
  let root: String
  let reply: String
  let stream: String

  init(roomId: String) {
    root = transcriptMessage(id: "root", roomId: roomId, content: "Parent")
    reply = transcriptMessage(id: "reply", roomId: roomId, content: "Answer")
      .replacingOccurrences(of: "\"parentMessageId\":null", with: "\"parentMessageId\":\"root\"")
    stream = "data: {\"type\":\"start\",\"messageId\":\"answer\"}\n\ndata: {\"type\":\"finish\"}\n\ndata: [DONE]\n\n"
  }
}

private struct PreparedCoworkerDirect {
  let state: WorkspaceState
  let auth: AuthState
  let transport: ScriptedTransport
  let room: Components.Schemas.ChatRoom
  let client: Client
}

private func preparedCoworkerDirect(
  roomId: String,
  responses: [(Int, String)]
) async throws -> PreparedCoworkerDirect {
  let (state, auth, transport, _) = try ephemeralState(responses, visible: false)
  let room = coworkerDirect(roomId: roomId)
  state.timeline.reset(roomId: roomId)
  let client = try #require(state.clientResolver?())
  _ = try await state.timeline.loadPage(.initial, client: client, organizationSlug: nil, generation: state.timeline.generation)
  state.directStream.reset(room: room)
  return PreparedCoworkerDirect(state: state, auth: auth, transport: transport, room: room, client: client)
}

private func unreadRoomsBody(id: String, unread: Int) -> String {
  """
  {"data":[{"id":"\(id)","organizationId":null,"organizationName":null,"name":"general","slug":null,"kind":"channel","directKey":null,"topic":null,"discoverability":null,"createdByUserId":"user_1","createdAt":"\(timestamp)","updatedAt":"\(timestamp)","unreadCount":\(unread),"unreadMentionCount":0,"starredAt":null,"pinnedMessageCount":0,"mutedAt":null,"markedUnread":false,"myAccess":"member","peerInActiveOrganization":false,"userMembers":[],"coworkerMembers":[],"sokoBotMembers":[]}],"meta":{"timestamp":"\(timestamp)","requestId":"req-1","pagination":{"cursor":null,"limit":100,"total":1,"nextCursor":null}}}
  """
}

private func transcriptMessage(id: String, roomId: String, content: String) -> String {
  """
  {"id":"\(id)","roomId":"\(roomId)","parentMessageId":null,"content":"\(content)","createdAt":"\(timestamp)","deletedAt":null,"editedAt":null,"sender":{"type":"user","user":{"id":"user_2","name":"Ada","email":"ada@example.com","presence":"offline"}},"mentions":[],"reactions":[],"threadReplyCount":0,"threadLastReplyAt":null,"metadata":null,"quote":null,"membership":null,"unfurls":null}
  """
}

private func transcriptPageBody(messages: [String], nextCursor: String?) -> String {
  let cursorJSON = nextCursor.map { "\"\($0)\"" } ?? "null"
  return """
  {"data":[\(messages.joined(separator: ","))],"meta":{"timestamp":"\(timestamp)","requestId":"req-1","pagination":{"cursor":null,"limit":100,"total":\(messages.count),"nextCursor":\(cursorJSON)}}}
  """
}

private func createdMessageBody(id: String, roomId: String, content: String) -> String {
  let message = """
  {"id":"\(id)","roomId":"\(roomId)","parentMessageId":null,"content":"\(content)","createdAt":"\(timestamp)","deletedAt":null,"editedAt":null,"sender":{"type":"user","user":{"id":"user_1","name":"Me","email":"me@example.com","presence":"offline"}},"mentions":[],"reactions":[],"threadReplyCount":0,"threadLastReplyAt":null,"metadata":null,"quote":null,"membership":null,"unfurls":null}
  """
  return """
  {"data":\(message),"meta":{"timestamp":"\(timestamp)","requestId":"req-1"}}
  """
}

private func roomReadBody(id: String, unread: Int, name: String = "general") -> String {
  let room = """
  {"id":"\(id)","organizationId":null,"organizationName":null,"name":"\(name)","slug":null,"kind":"channel","directKey":null,"topic":null,"discoverability":null,"createdByUserId":"user_1","createdAt":"\(timestamp)","updatedAt":"\(timestamp)","unreadCount":\(unread),"unreadMentionCount":0,"starredAt":null,"pinnedMessageCount":0,"mutedAt":null,"markedUnread":false,"myAccess":"member","peerInActiveOrganization":false,"userMembers":[],"coworkerMembers":[],"sokoBotMembers":[]}
  """
  return """
  {"data":\(room),"meta":{"timestamp":"\(timestamp)","requestId":"req-1"}}
  """
}
