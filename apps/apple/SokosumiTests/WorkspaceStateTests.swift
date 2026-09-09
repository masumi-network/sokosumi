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
  var pausePOST = false
  private var pauseWaiter: CheckedContinuation<Void, Never>?
  /// Tests wait on `operationIDs` (appended before the body `await`). A
  /// release that arrives in that window must not be lost.
  private var postReleased = false

  init(_ responses: [(Int, String)]) {
    self.responses = responses
  }

  func send(
    _: HTTPRequest,
    body: HTTPBody?,
    baseURL _: URL,
    operationID: String
  ) async throws -> (HTTPResponse, HTTPBody?) {
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
    }
    let next = responses.removeFirst()
    return (HTTPResponse(status: HTTPResponse.Status(code: next.0)), HTTPBody(next.1))
  }

  func releasePOST() {
    postReleased = true
    pauseWaiter?.resume()
    pauseWaiter = nil
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
  let state = WorkspaceState(
    savedRoom: SavedRoomSelection(defaults: defaults)
  )
  state.clientResolver = { client }
  return (state, AuthState(store: MemoryTokenStore()), transport, defaults)
}

/// Settles the fire-and-forget transcript tasks `openRoom` / `loadOlder`
/// spawn, so stubbed responses are consumed in order. Every load in these
/// tests must be followed by one before the next load or op assertion.
private func waitForTranscriptIdle(_ state: WorkspaceState) async {
  for _ in 0 ..< 1000 where state.transcriptLoading || state.transcriptLoadingOlder {
    await Task.yield()
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
    let (state, auth, _, defaults) = try ephemeralState([
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
    await waitForOutboundIdle(state)
    #expect(state.outboundShells.isEmpty)
    #expect(state.transcriptRoomId == secondID)
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
        content: "visible"
      )], nextCursor: nil)),
      (500, """
      {"error":"Internal Server Error","message":"boom","meta":{"timestamp":"\(timestamp)","requestId":"req-1","path":"/v1/chats/rooms/\(roomID)/read","method":"POST"}}
      """)
    ])
    await state.reload(auth: auth)
    await waitForTranscriptIdle(state)
    // History resolved before the read failed: it stays on screen with a
    // banner, and unread chrome is untouched (no DTO to apply).
    #expect(state.transcriptMessages.map(\.content) == ["visible"])
    #expect(state.transcriptError != nil)
    #expect(state.rooms.first?.unreadCount == 2)
    #expect(transport.operationIDs.suffix(2) == [
      "get/chats/rooms/{id}/messages",
      "post/chats/rooms/{id}/read"
    ])
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
    state.retryOutbound(clientTurnId: turnId, auth: auth)
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

  @Test func oneInFlightSendRejectsASecond() async throws {
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
      (201, createdMessageBody(id: confirmedID, roomId: roomID, content: "first"))
    ])
    await state.reload(auth: auth)
    await waitForTranscriptIdle(state)
    transport.pausePOST = true
    state.sendMessage("first", auth: auth)
    for _ in 0 ..< 1000 where !transport.operationIDs.contains("post/chats/rooms/{id}/messages") {
      await Task.yield()
    }
    state.sendMessage("second", auth: auth)
    #expect(state.outboundShells.count == 1)
    #expect(state.outboundShells[0].content == "first")
    transport.releasePOST()
    await waitForOutboundIdle(state)
    #expect(state.displayedTranscript.map(\.content) == ["first"])
    #expect(transport.operationIDs.filter { $0 == "post/chats/rooms/{id}/messages" }.count == 1)
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
