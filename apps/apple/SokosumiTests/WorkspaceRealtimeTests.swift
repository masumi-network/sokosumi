import CoreAPI
import Foundation
import HTTPTypes
import OpenAPIRuntime
@testable import Sokosumi
import SokosumiAuth
import SokosumiChat
import SokosumiRealtime
import Testing

private let realtimeTimestamp = "2026-01-01T00:00:00.000Z"
private let roomA = "550e8400-e29b-41d4-a716-446655440700"
private let roomB = "550e8400-e29b-41d4-a716-446655440701"

private struct RealtimeMemoryTokenStore: TokenStore {
  var tokens: OAuthTokens?
  func load() -> OAuthTokens? {
    tokens
  }

  func save(_: OAuthTokens) throws {}
  func clear() -> Bool {
    true
  }
}

private final class RealtimeScriptedTransport: ClientTransport, @unchecked Sendable {
  private(set) var operationIDs: [String] = []
  private(set) var requests: [HTTPRequest] = []
  private(set) var bodies: [Data] = []
  private var responses: [(Int, String)]
  var pausePOST = false
  var pauseNextMessagesGET = false
  private var pauseWaiter: CheckedContinuation<Void, Never>?
  private var messagesGETWaiter: CheckedContinuation<Void, Never>?
  private var postReleased = false

  init(_ responses: [(Int, String)]) {
    self.responses = responses
  }

  func send(
    _ request: HTTPRequest,
    body: HTTPBody?,
    baseURL _: URL,
    operationID: String
  ) async throws -> (HTTPResponse, HTTPBody?) {
    operationIDs.append(operationID)
    requests.append(request)
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
    if pauseNextMessagesGET, operationID == "get/chats/rooms/{id}/messages" {
      pauseNextMessagesGET = false
      await withCheckedContinuation { messagesGETWaiter = $0 }
    }
    let next = responses.removeFirst()
    return (HTTPResponse(status: HTTPResponse.Status(code: next.0)), HTTPBody(next.1))
  }

  func releasePOST() {
    postReleased = true
    pauseWaiter?.resume()
    pauseWaiter = nil
  }

  func releaseMessagesGET() {
    messagesGETWaiter?.resume()
    messagesGETWaiter = nil
  }
}

private func realtimeAccessBody() -> String {
  """
  {"data":{"gate":"ready","hasPersonalWorkspace":true,"hasOrganizationMembership":true,"hasPendingOrganizationInvites":false},"meta":{"timestamp":"\(realtimeTimestamp)","requestId":"req-1"}}
  """
}

private let realtimeOrgsBody = """
{"data":[{"id":"org_1","createdAt":"\(realtimeTimestamp)","name":"Acme","slug":"acme","role":"member"}],"meta":{"timestamp":"\(realtimeTimestamp)","requestId":"req-1"}}
"""

private let realtimeUserBody = """
{"data":{"id":"user_1","createdAt":"\(realtimeTimestamp)","updatedAt":"\(realtimeTimestamp)","name":"Me","email":"me@example.com","emailVerified":true,"role":"user"},"meta":{"timestamp":"\(realtimeTimestamp)","requestId":"req-1"}}
"""

private func realtimeRoomsBody(ids: [String]) -> String {
  let rooms = ids.map { id in
    """
    {"id":"\(id)","organizationId":null,"organizationName":null,"name":"\(id)","slug":null,"kind":"channel","directKey":null,"topic":null,"discoverability":null,"createdByUserId":"user_1","createdAt":"\(realtimeTimestamp)","updatedAt":"\(realtimeTimestamp)","unreadCount":0,"unreadMentionCount":0,"starredAt":null,"pinnedMessageCount":0,"mutedAt":null,"markedUnread":false,"myAccess":"member","peerInActiveOrganization":false,"userMembers":[],"coworkerMembers":[],"sokoBotMembers":[]}
    """
  }.joined(separator: ",")
  return """
  {"data":[\(rooms)],"meta":{"timestamp":"\(realtimeTimestamp)","requestId":"req-1","pagination":{"cursor":null,"limit":100,"total":\(ids.count),"nextCursor":null}}}
  """
}

private func realtimeMessageJSON(
  id: String,
  roomId: String,
  content: String,
  createdAt: String = realtimeTimestamp,
  deletedAt: String? = nil,
  editedAt: String? = nil,
  metadata: String? = nil
) -> String {
  let deletedJSON = deletedAt.map { "\"\($0)\"" } ?? "null"
  let editedJSON = editedAt.map { "\"\($0)\"" } ?? "null"
  return """
  {"id":"\(id)","roomId":"\(roomId)","parentMessageId":null,"content":"\(content)","createdAt":"\(createdAt)","deletedAt":\(deletedJSON),"editedAt":\(editedJSON),"sender":{"type":"user","user":{"id":"user_2","name":"Ada","email":"ada@example.com","presence":"offline"}},"mentions":[],"reactions":[],"threadReplyCount":0,"threadLastReplyAt":null,"metadata":\(metadata ?? "null"),"quote":null,"membership":null,"unfurls":null}
  """
}

private func realtimePageBody(messages: [String]) -> String {
  """
  {"data":[\(messages.joined(separator: ","))],"meta":{"timestamp":"\(realtimeTimestamp)","requestId":"req-1","pagination":{"cursor":null,"limit":100,"total":\(messages.count),"nextCursor":null}}}
  """
}

private func realtimeReadBody(id: String) -> String {
  """
  {"data":{"id":"\(id)","organizationId":null,"organizationName":null,"name":"\(id)","slug":null,"kind":"channel","directKey":null,"topic":null,"discoverability":null,"createdByUserId":"user_1","createdAt":"\(realtimeTimestamp)","updatedAt":"\(realtimeTimestamp)","unreadCount":0,"unreadMentionCount":0,"starredAt":null,"pinnedMessageCount":0,"mutedAt":null,"markedUnread":false,"myAccess":"member","peerInActiveOrganization":false,"userMembers":[],"coworkerMembers":[],"sokoBotMembers":[]},"meta":{"timestamp":"\(realtimeTimestamp)","requestId":"req-1"}}
  """
}

private func realtimeTokenBody() -> String {
  """
  {"data":{"keyName":"test.app","capability":"{}","timestamp":1704067200000,"nonce":"nonce-1","mac":"mac-1"},"meta":{"timestamp":"\(realtimeTimestamp)","requestId":"req-1"}}
  """
}

private func realtimeCreatedBody(id: String, roomId: String, content: String) -> String {
  """
  {"data":\(realtimeMessageJSON(id: id, roomId: roomId, content: content)),"meta":{"timestamp":"\(realtimeTimestamp)","requestId":"req-1"}}
  """
}

/// Decodes Ably-style full DTOs through the real generated client so the
/// apply path exercises the same shapes the transcript renders.
private func decodeRealtimeMessages(_ messages: [String]) async throws -> [Components.Schemas.ChatRoomMessage] {
  let transport = RealtimeScriptedTransport([(200, realtimePageBody(messages: messages))])
  let client = try Client.connecting(to: #require(URL(string: "https://core.example/v1")), transport: transport)
  let response = try await client.getChatsRoomsIdMessages(
    .init(path: .init(id: roomA), query: .init(), headers: .init())
  )
  guard case let .ok(okResponse) = response else {
    Issue.record("fixture failed to decode")
    return []
  }
  return try okResponse.body.json.data
}

private func realtimeState(
  _ responses: [(Int, String)],
  instanceId: String = "inst_test00000001"
) throws -> (WorkspaceState, AuthState, RealtimeScriptedTransport) { // swiftlint:disable:this large_tuple
  let transport = RealtimeScriptedTransport(responses)
  let client = try Client.connecting(to: #require(URL(string: "https://core.example/v1")), transport: transport)
  let suite = "sokosumi-workspace-realtime-tests.\(UUID().uuidString)"
  let defaults = UserDefaults(suiteName: suite)!
  defaults.removePersistentDomain(forName: suite)
  let state = WorkspaceState(
    savedSelection: SavedWorkspaceSelection(defaults: defaults),
    savedRoom: SavedRoomSelection(defaults: defaults),
    instanceStore: MemoryAblyClientInstanceIdStore(stored: instanceId)
  )
  state.clientResolver = { client }
  return (state, AuthState(store: RealtimeMemoryTokenStore()), transport)
}

private func waitForRealtimeIdle(_ state: WorkspaceState) async {
  for _ in 0 ..< 1000 where state.transcriptLoading || state.transcriptLoadingOlder || state.transcriptRefreshing || state.outboundInFlight {
    await Task.yield()
  }
}

private func waitForTokenMints(_ transport: RealtimeScriptedTransport, count: Int) async {
  for _ in 0 ..< 1000 {
    let seen = transport.operationIDs.filter { $0 == "post/realtime/ably-token" }.count
    if seen >= count {
      return
    }
    await Task.yield()
  }
}

private final class FakeRealtimeConnection: RealtimeConnection, @unchecked Sendable {
  private(set) var connectCount = 0
  private(set) var connectedUserId: String?
  private(set) var connectedSlug: String?
  private(set) var watchedRooms: [String?] = []
  private(set) var slugs: [String?] = []
  private(set) var reauthorizeCount = 0
  private(set) var reauthorizedToken: AblyTokenFields?
  private(set) var disconnectCount = 0
  private var handler: RealtimeEventHandler?

  func connect(
    userId: String,
    organizationSlug: String?,
    tokenProvider _: @escaping RealtimeTokenProvider,
    onEvent: @escaping RealtimeEventHandler
  ) {
    connectCount += 1
    connectedUserId = userId
    connectedSlug = organizationSlug
    handler = onEvent
  }

  func setOrganizationSlug(_ slug: String?) {
    slugs.append(slug)
  }

  func watchRoom(_ roomId: String?) {
    watchedRooms.append(roomId)
  }

  func reauthorize(token: AblyTokenFields) {
    reauthorizeCount += 1
    reauthorizedToken = token
  }

  func disconnect() {
    disconnectCount += 1
  }

  func deliver(_ event: ResolvedRealtimeDelivery) {
    handler?(event)
  }
}

private struct NeverTokenTransport: TokenEndpointTransport {
  func postForm(_: [(name: String, value: String)], to _: URL) async throws -> (Data, Int) {
    throw URLError(.notConnectedToInternet)
  }
}

/// Session with fresh tokens: the socket provider never hits the network in
/// fake tests (package tests cover the token POST itself).
private func realtimeOAuthSession() -> OAuthSession {
  let configuration = OAuthConfiguration(
    issuerBaseURL: URL(string: "https://core.example/auth")!,
    clientID: "test-client"
  )
  let store = RealtimeMemoryTokenStore(tokens: OAuthTokens(
    accessToken: "test-access",
    refreshToken: "test-refresh",
    expiresAt: Date().addingTimeInterval(3600),
    scope: nil
  ))
  return OAuthSession(configuration: configuration, store: store, transport: NeverTokenTransport())
}

struct WorkspaceRealtimeTests {
  @Test func realtimeCreateAppearsWithoutReload() async throws {
    let firstId = "550e8400-e29b-41d4-a716-446655440710"
    let liveId = "550e8400-e29b-41d4-a716-446655440711"
    let (state, auth, transport) = try realtimeState([
      (200, realtimeAccessBody()),
      (200, realtimeOrgsBody),
      (200, realtimeUserBody),
      (200, realtimeRoomsBody(ids: [roomA])),
      (200, realtimePageBody(messages: [realtimeMessageJSON(id: firstId, roomId: roomA, content: "first")])),
      (200, realtimeReadBody(id: roomA))
    ])
    await state.reload(auth: auth)
    await waitForRealtimeIdle(state)
    #expect(state.displayedTranscript.map(\.content) == ["first"])

    let live = try await decodeRealtimeMessages([
      realtimeMessageJSON(id: liveId, roomId: roomA, content: "from web", createdAt: "2026-01-01T00:00:01.000Z")
    ])
    state.applyRealtimeMessage(roomId: roomA, eventType: .create, message: live[0])
    #expect(state.displayedTranscript.map(\.content) == ["first", "from web"])
    // No extra history GET: the row arrived over the wire.
    #expect(transport.operationIDs.filter { $0 == "get/chats/rooms/{id}/messages" }.count == 1)
  }

  @Test func realtimeUpdateAndHardDeleteApply() async throws {
    let targetId = "550e8400-e29b-41d4-a716-446655440712"
    let otherId = "550e8400-e29b-41d4-a716-446655440713"
    let (state, auth, _) = try realtimeState([
      (200, realtimeAccessBody()),
      (200, realtimeOrgsBody),
      (200, realtimeUserBody),
      (200, realtimeRoomsBody(ids: [roomA])),
      (200, realtimePageBody(messages: [
        realtimeMessageJSON(id: targetId, roomId: roomA, content: "hello"),
        realtimeMessageJSON(id: otherId, roomId: roomA, content: "other")
      ])),
      (200, realtimeReadBody(id: roomA))
    ])
    await state.reload(auth: auth)
    await waitForRealtimeIdle(state)

    let edited = try await decodeRealtimeMessages([
      realtimeMessageJSON(id: targetId, roomId: roomA, content: "hello edited", editedAt: realtimeTimestamp)
    ])
    state.applyRealtimeMessage(roomId: roomA, eventType: .update, message: edited[0])
    #expect(state.transcriptMessages.first { $0.id == targetId }?.content == "hello edited")

    let deleted = try await decodeRealtimeMessages([
      realtimeMessageJSON(id: targetId, roomId: roomA, content: "hello edited", editedAt: realtimeTimestamp)
    ])
    state.applyRealtimeMessage(roomId: roomA, eventType: .delete, message: deleted[0])
    #expect(state.transcriptMessages.map(\.id) == [otherId])
  }

  @Test func realtimeIgnoresOtherRooms() async throws {
    let firstId = "550e8400-e29b-41d4-a716-446655440714"
    let (state, auth, _) = try realtimeState([
      (200, realtimeAccessBody()),
      (200, realtimeOrgsBody),
      (200, realtimeUserBody),
      (200, realtimeRoomsBody(ids: [roomA])),
      (200, realtimePageBody(messages: [realtimeMessageJSON(id: firstId, roomId: roomA, content: "first")])),
      (200, realtimeReadBody(id: roomA))
    ])
    await state.reload(auth: auth)
    await waitForRealtimeIdle(state)

    let foreign = try await decodeRealtimeMessages([
      realtimeMessageJSON(id: "550e8400-e29b-41d4-a716-446655440715", roomId: roomB, content: "elsewhere")
    ])
    state.applyRealtimeMessage(roomId: roomB, eventType: .create, message: foreign[0])
    #expect(state.displayedTranscript.map(\.content) == ["first"])
  }

  @Test func ownSendPlusAblyCreateDedupeToOneBubble() async throws {
    let confirmedId = "550e8400-e29b-41d4-a716-446655440716"
    let (state, auth, transport) = try realtimeState([
      (200, realtimeAccessBody()),
      (200, realtimeOrgsBody),
      (200, realtimeUserBody),
      (200, realtimeRoomsBody(ids: [roomA])),
      (200, realtimePageBody(messages: [])),
      (200, realtimeReadBody(id: roomA)),
      (201, realtimeCreatedBody(id: confirmedId, roomId: roomA, content: "hello"))
    ])
    await state.reload(auth: auth)
    await waitForRealtimeIdle(state)
    transport.pausePOST = true
    state.sendMessage("hello", auth: auth)
    for _ in 0 ..< 1000 where !transport.operationIDs.contains("post/chats/rooms/{id}/messages") {
      await Task.yield()
    }
    let turnId = try #require(state.outboundShells.first?.clientTurnId)
    #expect(state.displayedTranscript.map(\.content) == ["hello"])

    // The Ably create for our own send carries the same client turn id.
    let incoming = try await decodeRealtimeMessages([
      realtimeMessageJSON(
        id: confirmedId,
        roomId: roomA,
        content: "hello",
        metadata: "{\"client_message_id\":\"\(turnId)\"}"
      )
    ])
    state.applyRealtimeMessage(roomId: roomA, eventType: .create, message: incoming[0])
    #expect(state.outboundShells.isEmpty)
    #expect(state.displayedTranscript.map(\.content) == ["hello"])
    #expect(state.transcriptMessages.map(\.id) == [confirmedId])

    transport.releasePOST()
    await waitForRealtimeIdle(state)
    #expect(state.displayedTranscript.map(\.content) == ["hello"])
    #expect(transport.operationIDs.filter { $0 == "post/chats/rooms/{id}/messages" }.count == 1)
  }

  @Test func envelopeCreateRefetchesAndMergesWithoutFakeRow() async throws {
    let oldId = "550e8400-e29b-41d4-a716-446655440717"
    let newId = "550e8400-e29b-41d4-a716-446655440718"
    let (state, auth, transport) = try realtimeState([
      (200, realtimeAccessBody()),
      (200, realtimeOrgsBody),
      (200, realtimeUserBody),
      (200, realtimeRoomsBody(ids: [roomA])),
      (200, realtimePageBody(messages: [realtimeMessageJSON(id: oldId, roomId: roomA, content: "old")])),
      (200, realtimeReadBody(id: roomA)),
      // Envelope refetch: the oversize row arrives via HTTP, not invented.
      (200, realtimePageBody(messages: [
        realtimeMessageJSON(id: oldId, roomId: roomA, content: "old edited", editedAt: realtimeTimestamp),
        realtimeMessageJSON(id: newId, roomId: roomA, content: "oversize body", createdAt: "2026-01-01T00:00:01.000Z")
      ]))
    ])
    await state.reload(auth: auth)
    await waitForRealtimeIdle(state)
    state.applyRealtimeEnvelope(
      .init(eventType: .create, messageId: newId, roomId: roomA),
      auth: auth
    )
    await waitForRealtimeIdle(state)
    #expect(state.transcriptMessages.map(\.content) == ["old edited", "oversize body"])
    #expect(state.transcriptError == nil)
    // Refetch only: history re-read once, mark-read never re-posted.
    #expect(transport.operationIDs.filter { $0 == "get/chats/rooms/{id}/messages" }.count == 2)
    #expect(transport.operationIDs.filter { $0 == "post/chats/rooms/{id}/read" }.count == 1)
  }

  @Test func envelopeCreateDuringHistoryLoadRefetchesAfterResolve() async throws {
    let oldId = "550e8400-e29b-41d4-a716-446655440742"
    let newId = "550e8400-e29b-41d4-a716-446655440743"
    let (state, auth, transport) = try realtimeState([
      (200, realtimeAccessBody()),
      (200, realtimeOrgsBody),
      (200, realtimeUserBody),
      (200, realtimeRoomsBody(ids: [roomA])),
      (200, realtimePageBody(messages: [realtimeMessageJSON(id: oldId, roomId: roomA, content: "old")])),
      (200, realtimeReadBody(id: roomA)),
      (200, realtimePageBody(messages: [
        realtimeMessageJSON(id: oldId, roomId: roomA, content: "old"),
        realtimeMessageJSON(id: newId, roomId: roomA, content: "oversize body", createdAt: "2026-01-01T00:00:01.000Z")
      ]))
    ])
    transport.pauseNextMessagesGET = true
    await state.reload(auth: auth)
    for _ in 0 ..< 1000 where !transport.operationIDs.contains("get/chats/rooms/{id}/messages") {
      await Task.yield()
    }
    #expect(state.transcriptLoading)
    state.applyRealtimeEnvelope(
      .init(eventType: .create, messageId: newId, roomId: roomA),
      auth: auth
    )
    transport.releaseMessagesGET()
    await waitForRealtimeIdle(state)
    #expect(state.transcriptMessages.map(\.content) == ["old", "oversize body"])
    #expect(transport.operationIDs.filter { $0 == "get/chats/rooms/{id}/messages" }.count == 2)
  }

  @Test func envelopeDeleteTombstonesOnScreenRow() async throws {
    let targetId = "550e8400-e29b-41d4-a716-446655440719"
    let (state, auth, _) = try realtimeState([
      (200, realtimeAccessBody()),
      (200, realtimeOrgsBody),
      (200, realtimeUserBody),
      (200, realtimeRoomsBody(ids: [roomA])),
      (200, realtimePageBody(messages: [realtimeMessageJSON(id: targetId, roomId: roomA, content: "bye")])),
      (200, realtimeReadBody(id: roomA))
    ])
    await state.reload(auth: auth)
    await waitForRealtimeIdle(state)
    state.applyRealtimeEnvelope(
      .init(eventType: .delete, messageId: targetId, roomId: roomA),
      auth: auth
    )
    #expect(state.transcriptMessages.count == 1)
    #expect(state.transcriptMessages[0].content.isEmpty)
    #expect(state.transcriptMessages[0].deletedAt != nil)
  }

  @Test func revokeDropsOpenRoomClearsTranscriptAndRemintsToken() async throws {
    let (state, auth, transport) = try realtimeState([
      (200, realtimeAccessBody()),
      (200, realtimeOrgsBody),
      (200, realtimeUserBody),
      (200, realtimeRoomsBody(ids: [roomA, roomB])),
      (200, realtimePageBody(messages: [realtimeMessageJSON(
        id: "550e8400-e29b-41d4-a716-446655440720",
        roomId: roomA,
        content: "in open room"
      )])),
      (200, realtimeReadBody(id: roomA)),
      (200, realtimeTokenBody()),
      (200, realtimeTokenBody())
    ])
    await state.reload(auth: auth)
    await waitForRealtimeIdle(state)
    #expect(state.selectedRoomId == roomA)
    await state.refreshAblyToken(auth: auth)
    #expect(state.ablyToken?.keyName == "test.app")

    state.applyMembershipRevoked(roomId: roomA, auth: auth)
    await waitForTokenMints(transport, count: 2)
    #expect(state.rooms.map(\.id) == [roomB])
    #expect(state.selectedRoomId == nil)
    #expect(state.transcriptRoomId == nil)
    #expect(state.transcriptMessages.isEmpty)
    // Explicit mint plus the revoke remint: capabilities drop with membership.
    #expect(transport.operationIDs.filter { $0 == "post/realtime/ably-token" }.count == 2)
  }

  @Test func revokeKeepsUnrelatedRoomTranscript() async throws {
    let (state, auth, transport) = try realtimeState([
      (200, realtimeAccessBody()),
      (200, realtimeOrgsBody),
      (200, realtimeUserBody),
      (200, realtimeRoomsBody(ids: [roomA, roomB])),
      (200, realtimePageBody(messages: [realtimeMessageJSON(
        id: "550e8400-e29b-41d4-a716-446655440721",
        roomId: roomA,
        content: "stays"
      )])),
      (200, realtimeReadBody(id: roomA))
    ])
    await state.reload(auth: auth)
    await waitForRealtimeIdle(state)
    state.applyMembershipRevoked(roomId: roomB, auth: auth)
    #expect(state.rooms.map(\.id) == [roomA])
    #expect(state.selectedRoomId == roomA)
    #expect(state.transcriptMessages.map(\.content) == ["stays"])
    // No token minted yet: revoke alone never pays for one.
    #expect(!transport.operationIDs.contains("post/realtime/ably-token"))
  }

  @Test func liveArrivalDuringHistoryLoadSurvivesResolve() async throws {
    let firstId = "550e8400-e29b-41d4-a716-446655440740"
    let liveId = "550e8400-e29b-41d4-a716-446655440741"
    let (state, auth, _) = try realtimeState([
      (200, realtimeAccessBody()),
      (200, realtimeOrgsBody),
      (200, realtimeUserBody),
      (200, realtimeRoomsBody(ids: [roomA])),
      (200, realtimePageBody(messages: [realtimeMessageJSON(id: firstId, roomId: roomA, content: "first")])),
      (200, realtimeReadBody(id: roomA)),
      // Reopen re-reads history.
      (200, realtimePageBody(messages: [realtimeMessageJSON(id: firstId, roomId: roomA, content: "first")])),
      (200, realtimeReadBody(id: roomA))
    ])
    await state.reload(auth: auth)
    await waitForRealtimeIdle(state)
    let live = try await decodeRealtimeMessages([
      realtimeMessageJSON(id: liveId, roomId: roomA, content: "in flight", createdAt: "2026-01-01T00:00:01.000Z")
    ])
    let room = try #require(state.rooms.first)
    state.openRoom(room, auth: auth)
    // The load task has not run yet: this live row lands first, and the
    // resolving history GET must merge around it, not wipe it.
    state.applyRealtimeMessage(roomId: roomA, eventType: .create, message: live[0])
    await waitForRealtimeIdle(state)
    #expect(state.displayedTranscript.map(\.content) == ["first", "in flight"])
  }

  @Test func instanceIdIsStableAcrossStates() {
    let store = MemoryAblyClientInstanceIdStore()
    let first = WorkspaceState(instanceStore: store)
    let second = WorkspaceState(instanceStore: store)
    #expect(first.ablyClientInstanceId == second.ablyClientInstanceId)
    #expect(isValidAblyClientInstanceId(first.ablyClientInstanceId))
  }

  @Test func tokenMintUsesInstanceIdAndPersonalOmitsOrgHeader() async throws {
    let (state, auth, transport) = try realtimeState(
      [
        (200, realtimeAccessBody()),
        (200, realtimeOrgsBody),
        (200, realtimeUserBody),
        (200, realtimeRoomsBody(ids: [roomA])),
        (200, realtimePageBody(messages: [])),
        (200, realtimeReadBody(id: roomA)),
        (200, realtimeTokenBody())
      ],
      instanceId: "inst_personal0001"
    )
    await state.reload(auth: auth)
    await waitForRealtimeIdle(state)
    await state.refreshAblyToken(auth: auth)
    #expect(state.ablyToken?.keyName == "test.app")
    let tokenOps = transport.operationIDs.enumerated().compactMap { index, id in
      id == "post/realtime/ably-token" ? index : nil
    }
    #expect(tokenOps.count == 1)
    let tokenRequest = transport.requests[tokenOps[0]]
    #expect(tokenRequest.path?.contains("clientInstanceId=inst_personal0001") == true)
    // Personal workspace omits the org header (same rule as rooms/history).
    guard let slugName = HTTPField.Name("X-Organization-Slug") else {
      Issue.record("missing org slug header name")
      return
    }
    #expect(tokenRequest.headerFields[slugName] == nil)
  }

  @Test func liveSocketConnectsWatchesOpenRoomAndDelivers() async throws {
    let firstId = "550e8400-e29b-41d4-a716-446655440730"
    let liveId = "550e8400-e29b-41d4-a716-446655440731"
    let fake = FakeRealtimeConnection()
    let (state, auth, transport) = try realtimeState([
      (200, realtimeAccessBody()),
      (200, realtimeOrgsBody),
      (200, realtimeUserBody),
      (200, realtimeRoomsBody(ids: [roomA])),
      (200, realtimePageBody(messages: [realtimeMessageJSON(id: firstId, roomId: roomA, content: "first")])),
      (200, realtimeReadBody(id: roomA)),
      (200, realtimeTokenBody())
    ])
    state.realtimeConnectionFactory = { fake }
    state.realtimeSessionOverride = realtimeOAuthSession()
    await state.reload(auth: auth)
    await waitForRealtimeIdle(state)

    #expect(fake.connectCount == 1)
    #expect(fake.connectedUserId == "user_1")
    #expect(fake.connectedSlug == nil)
    #expect(fake.watchedRooms == [roomA])

    let live = try await decodeRealtimeMessages([
      realtimeMessageJSON(id: liveId, roomId: roomA, content: "over the wire", createdAt: "2026-01-01T00:00:01.000Z")
    ])
    fake.deliver(.message(roomId: roomA, eventType: .create, message: live[0]))
    for _ in 0 ..< 1000 where state.displayedTranscript.map(\.content) != ["first", "over the wire"] {
      await Task.yield()
    }
    #expect(state.displayedTranscript.map(\.content) == ["first", "over the wire"])

    fake.deliver(.revoked(roomId: roomA))
    await waitForTokenMints(transport, count: 1)
    #expect(state.rooms.isEmpty)
    #expect(state.selectedRoomId == nil)
    #expect(state.transcriptRoomId == nil)
    #expect(fake.watchedRooms == [roomA, nil])

    state.reset()
    #expect(fake.disconnectCount == 1)
  }

  @Test func workspaceSwitchRetargetsSlugReauthorizesAndRewatches() async throws {
    let fake = FakeRealtimeConnection()
    let (state, auth, transport) = try realtimeState([
      (200, realtimeAccessBody()),
      (200, realtimeOrgsBody),
      (200, realtimeUserBody),
      (200, realtimeRoomsBody(ids: [roomA])),
      (200, realtimePageBody(messages: [])),
      (200, realtimeReadBody(id: roomA)),
      (200, """
      {"data":{"organizationId":"org_1"},"meta":{"timestamp":"\(realtimeTimestamp)","requestId":"req-1"}}
      """),
      (200, realtimeRoomsBody(ids: [roomB])),
      (200, realtimeTokenBody()),
      (200, realtimePageBody(messages: [])),
      (200, realtimeReadBody(id: roomB))
    ])
    state.realtimeConnectionFactory = { fake }
    state.realtimeSessionOverride = realtimeOAuthSession()
    await state.reload(auth: auth)
    await waitForRealtimeIdle(state)
    #expect(fake.watchedRooms == [roomA])

    let org = try #require(state.options.first { $0.id == "org_1" })
    await state.switchRooms(auth: auth, option: org)
    await waitForRealtimeIdle(state)

    #expect(state.selectionId == "org_1")
    #expect(fake.slugs == ["acme"])
    #expect(fake.connectedSlug == nil)
    await waitForTokenMints(transport, count: 1)
    #expect(fake.reauthorizeCount == 1)
    #expect(fake.reauthorizedToken?.keyName == "test.app")
    #expect(fake.watchedRooms == [roomA, roomB])
    #expect(state.selectedRoomId == roomB)
  }
}
