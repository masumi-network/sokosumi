import CoreAPI
import Foundation
import HTTPTypes
import OpenAPIRuntime
import SokosumiAuth
import SokosumiChat
import SokosumiRealtime
@testable import SokosumiWorkspace
import Testing

private let realtimeTimestamp = "2026-01-01T00:00:00.000Z"
private let roomA = "550e8400-e29b-41d4-a716-446655440700"
private let roomB = "550e8400-e29b-41d4-a716-446655440701"
private let realtimeWindow = UUID()

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
  var pauseNextRoomsGET = false
  private var roomsGETWaiter: CheckedContinuation<Void, Never>?
  private var roomsGETObserver: CheckedContinuation<Void, Never>?
  private var pauseWaiter: CheckedContinuation<Void, Never>?
  private var messagesGETObserver: CheckedContinuation<Void, Never>?
  private var messagesGETWaiter: CheckedContinuation<Void, Never>?
  private var postReleased = false
  private var messagesGETReleased = false

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
      if !messagesGETReleased {
        await withCheckedContinuation { messagesGETWaiter = $0
          messagesGETObserver?.resume()
          messagesGETObserver = nil
        }
      }
      messagesGETReleased = false
    }
    let next = responses.removeFirst()
    if pauseNextRoomsGET, operationID == "get/chats/rooms" {
      pauseNextRoomsGET = false
      await withCheckedContinuation { roomsGETWaiter = $0
        roomsGETObserver?.resume()
        roomsGETObserver = nil
      }
    }
    return (HTTPResponse(status: HTTPResponse.Status(code: next.0)), HTTPBody(next.1))
  }

  func waitForRoomsGET() async {
    if roomsGETWaiter != nil {
      return
    }
    await withCheckedContinuation { roomsGETObserver = $0 }
  }

  func releaseRoomsGET() {
    roomsGETWaiter?.resume()
    roomsGETWaiter = nil
  }

  func waitForMessagesGET() async {
    if messagesGETWaiter != nil {
      return
    }
    await withCheckedContinuation { messagesGETObserver = $0 }
  }

  func releasePOST() {
    postReleased = true
    pauseWaiter?.resume()
    pauseWaiter = nil
  }

  func releaseMessagesGET() {
    messagesGETReleased = true
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

private func realtimePageBody(messages: [String], nextCursor: String? = nil) -> String {
  """
  {"data":[\(messages.joined(separator: ","))],"meta":{"timestamp":"\(realtimeTimestamp)","requestId":"req-1","pagination":{"cursor":null,"limit":100,"total":\(messages.count),"nextCursor":\(nextCursor.map { "\"\($0)\"" } ?? "null")}}}
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
    savedRoom: SavedRoomSelection(defaults: defaults),
    instanceStore: MemoryAblyClientInstanceIdStore(stored: instanceId)
  )
  state.setWindowVisible(true, window: realtimeWindow)
  state.clientResolver = { client }
  return (state, AuthState(configuration: nil, store: RealtimeMemoryTokenStore(), browser: StubOAuthBrowser(), restoreSession: false), transport)
}

private func waitForRealtimeIdle(_ state: WorkspaceState) async {
  while state.sidebarRecovery.isRefreshing || state.roomsRefreshTask != nil || state.transcriptRecovery.isRefreshing || state.transcriptLoadTask != nil || state.olderPageTask != nil || state.transcriptRefreshTask != nil {
    await state.roomsRefreshTask?.value
    await state.transcriptLoadTask?.value
    await state.olderPageTask?.value
    await state.transcriptRefreshTask?.value
    await Task.yield()
  }
  for _ in 0 ..< 1000 where state.outboundInFlight {
    await Task.yield()
  }
}

private final class FakeRealtimeConnection: RealtimeConnection, @unchecked Sendable {
  private(set) var connectCount = 0
  private(set) var connectedUserId: String?
  private(set) var connectedSlug: String?
  private(set) var watchedRooms: [String?] = []
  private(set) var membershipRooms: [Set<String>] = []
  private(set) var membershipRefreshes = 0
  private(set) var slugs: [String?] = []
  private(set) var tokenProvider: RealtimeTokenProvider?
  private(set) var disconnectCount = 0
  private var handler: RealtimeEventHandler?

  func connect(
    userId: String,
    organizationSlug: String?,
    tokenProvider: @escaping RealtimeTokenProvider,
    onEvent: @escaping RealtimeEventHandler
  ) {
    self.tokenProvider = tokenProvider
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

  func setMembershipRooms(_ roomIds: Set<String>) {
    membershipRooms.append(roomIds)
  }

  func refreshMembership() {
    membershipRefreshes += 1
  }

  func disconnect() {
    disconnectCount += 1
  }

  func deliver(_ event: ResolvedRealtimeDelivery) {
    handler?(event)
  }
}

struct WorkspaceRealtimeTests {
  @Test func hiddenEnvelopeWaitsForWindowReturn() async throws {
    let (state, auth, transport) = try realtimeState([
      (200, realtimeAccessBody()),
      (200, realtimeOrgsBody),
      (200, realtimeUserBody),
      (200, #"{"data":{"organizationId":null},"meta":{"timestamp":"2026-01-01T00:00:00.000Z","requestId":"req-1"}}"#),
      (200, realtimeRoomsBody(ids: [roomA])),
      (200, realtimePageBody(messages: [])),
      (200, realtimeReadBody(id: roomA)),
      (200, realtimePageBody(messages: [])),
      (200, realtimeReadBody(id: roomA))
    ])
    await state.reload(auth: auth)
    await waitForRealtimeIdle(state)
    state.setWindowVisible(false, window: realtimeWindow)
    state.applyRealtimeEnvelope(.init(eventType: .create, messageId: "new", roomId: roomA))
    state.applyRealtimeEnvelope(.init(eventType: .update, messageId: "new", roomId: roomA))
    await waitForRealtimeIdle(state)
    #expect(transport.operationIDs.filter { $0 == "get/chats/rooms/{id}/messages" }.count == 1)
    state.setWindowVisible(true, window: realtimeWindow)
    await waitForRealtimeIdle(state)
    #expect(transport.operationIDs.filter { $0 == "get/chats/rooms/{id}/messages" }.count == 2)
    state.reset()
  }

  @Test func realtimeCreateAppearsWithoutReload() async throws {
    let firstId = "550e8400-e29b-41d4-a716-446655440710"
    let liveId = "550e8400-e29b-41d4-a716-446655440711"
    let (state, auth, transport) = try realtimeState([
      (200, realtimeAccessBody()),
      (200, realtimeOrgsBody),
      (200, realtimeUserBody),
      (200, #"{"data":{"organizationId":null},"meta":{"timestamp":"2026-01-01T00:00:00.000Z","requestId":"req-1"}}"#),
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
      (200, #"{"data":{"organizationId":null},"meta":{"timestamp":"2026-01-01T00:00:00.000Z","requestId":"req-1"}}"#),
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

  @Test func foreignActivityRefreshesSidebarOnForegroundReturn() async throws {
    let firstId = "550e8400-e29b-41d4-a716-446655440714"
    let (state, auth, transport) = try realtimeState([
      (200, realtimeAccessBody()),
      (200, realtimeOrgsBody),
      (200, realtimeUserBody),
      (200, #"{"data":{"organizationId":null},"meta":{"timestamp":"2026-01-01T00:00:00.000Z","requestId":"req-1"}}"#),
      (200, realtimeRoomsBody(ids: [roomA])),
      (200, realtimePageBody(messages: [realtimeMessageJSON(id: firstId, roomId: roomA, content: "first")])),
      (200, realtimeReadBody(id: roomA)),
      (200, realtimeRoomsBody(ids: [roomA, roomB]))
    ])
    await state.reload(auth: auth)
    await waitForRealtimeIdle(state)

    let foreign = try await decodeRealtimeMessages([
      realtimeMessageJSON(id: "550e8400-e29b-41d4-a716-446655440715", roomId: roomB, content: "elsewhere")
    ])
    state.setWindowVisible(false, window: realtimeWindow)
    state.applyRealtimeMessage(roomId: roomB, eventType: .create, message: foreign[0])
    state.applyRealtimeEnvelope(.init(eventType: .create, messageId: "large", roomId: roomB))
    await waitForRealtimeIdle(state)
    #expect(transport.operationIDs.filter { $0 == "get/chats/rooms" }.count == 1)
    state.setWindowVisible(true, window: realtimeWindow)
    await waitForRealtimeIdle(state)
    #expect(transport.operationIDs.filter { $0 == "get/chats/rooms" }.count == 2)
    #expect(state.rooms.map(\.id) == [roomA, roomB])
    #expect(state.displayedTranscript.map(\.content) == ["first"])
    state.reset()
  }

  @Test func ownSendPlusAblyCreateDedupeToOneBubble() async throws {
    let confirmedId = "550e8400-e29b-41d4-a716-446655440716"
    let (state, auth, transport) = try realtimeState([
      (200, realtimeAccessBody()),
      (200, realtimeOrgsBody),
      (200, realtimeUserBody),
      (200, #"{"data":{"organizationId":null},"meta":{"timestamp":"2026-01-01T00:00:00.000Z","requestId":"req-1"}}"#),
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

  @Test func queuedEnvelopeAfterOlderPageIsRefetched() async throws {
    let messageId = "550e8400-e29b-41d4-a716-446655440717"
    let (state, auth, transport) = try realtimeState([
      (200, realtimeAccessBody()), (200, realtimeOrgsBody), (200, realtimeUserBody),
      (200, #"{"data":{"organizationId":null},"meta":{"timestamp":"2026-01-01T00:00:00.000Z","requestId":"req-1"}}"#),
      (200, realtimeRoomsBody(ids: [roomA])),
      (200, realtimePageBody(messages: [], nextCursor: "older")),
      (200, realtimeReadBody(id: roomA)),
      (200, realtimePageBody(messages: [])),
      (200, realtimePageBody(messages: [realtimeMessageJSON(id: messageId, roomId: roomA, content: "arrived")])),
      (200, realtimeReadBody(id: roomA))
    ])
    await state.reload(auth: auth)
    await waitForRealtimeIdle(state)
    transport.pauseNextMessagesGET = true
    // Both actions queue before either page request starts.
    state.loadOlderMessages(auth: auth)
    state.applyRealtimeEnvelope(.init(eventType: .create, messageId: messageId, roomId: roomA))
    await transport.waitForMessagesGET()
    transport.releaseMessagesGET()
    await waitForRealtimeIdle(state)
    #expect(state.transcriptMessages.map(\.content) == ["arrived"])
    #expect(transport.operationIDs.filter { $0 == "get/chats/rooms/{id}/messages" }.count == 3)
  }

  @Test(arguments: [false, true]) func envelopeCreateRefetchesAndMergesWithoutFakeRow(openParent: Bool) async throws {
    let oldId = "550e8400-e29b-41d4-a716-446655440717"
    let newId = "550e8400-e29b-41d4-a716-446655440718"
    let (state, auth, transport) = try realtimeState([
      (200, realtimeAccessBody()),
      (200, realtimeOrgsBody),
      (200, realtimeUserBody),
      (200, #"{"data":{"organizationId":null},"meta":{"timestamp":"2026-01-01T00:00:00.000Z","requestId":"req-1"}}"#),
      (200, realtimeRoomsBody(ids: [roomA])),
      (200, realtimePageBody(messages: [realtimeMessageJSON(id: oldId, roomId: roomA, content: "old")])),
      (200, realtimeReadBody(id: roomA)),
      // Envelope refetch: the oversize row arrives via HTTP, not invented.
      (200, realtimePageBody(messages: [
        realtimeMessageJSON(id: oldId, roomId: roomA, content: "old edited", editedAt: realtimeTimestamp),
        realtimeMessageJSON(id: newId, roomId: roomA, content: "oversize body", createdAt: "2026-01-01T00:00:01.000Z")
      ])),
      (200, realtimeReadBody(id: roomA))
    ])
    await state.reload(auth: auth)
    await waitForRealtimeIdle(state)
    if openParent {
      try state.thread.open(#require(state.transcriptMessages.first))
    }
    state.applyRealtimeEnvelope(
      .init(eventType: .create, messageId: openParent ? oldId : newId, roomId: roomA)
    )
    state.thread.close()
    await waitForRealtimeIdle(state)
    #expect(state.transcriptMessages.map(\.content) == ["old edited", "oversize body"])
    #expect(state.transcriptError == nil)
    // Refreshed visible content advances room attention again.
    #expect(transport.operationIDs.filter { $0 == "get/chats/rooms/{id}/messages" }.count == 2)
    #expect(transport.operationIDs.filter { $0 == "post/chats/rooms/{id}/read" }.count == 2)
  }

  @Test func envelopeCreateDuringHistoryLoadRefetchesAfterResolve() async throws {
    let oldId = "550e8400-e29b-41d4-a716-446655440742"
    let newId = "550e8400-e29b-41d4-a716-446655440743"
    let (state, auth, transport) = try realtimeState([
      (200, realtimeAccessBody()),
      (200, realtimeOrgsBody),
      (200, realtimeUserBody),
      (200, #"{"data":{"organizationId":null},"meta":{"timestamp":"2026-01-01T00:00:00.000Z","requestId":"req-1"}}"#),
      (200, realtimeRoomsBody(ids: [roomA])),
      (200, realtimePageBody(messages: [realtimeMessageJSON(id: oldId, roomId: roomA, content: "old")])),
      (200, realtimeReadBody(id: roomA)),
      (200, realtimePageBody(messages: [
        realtimeMessageJSON(id: oldId, roomId: roomA, content: "old"),
        realtimeMessageJSON(id: newId, roomId: roomA, content: "oversize body", createdAt: "2026-01-01T00:00:01.000Z")
      ])),
      (200, realtimeReadBody(id: roomA))
    ])
    transport.pauseNextMessagesGET = true
    await state.reload(auth: auth)
    for _ in 0 ..< 1000 where !transport.operationIDs.contains("get/chats/rooms/{id}/messages") {
      await Task.yield()
    }
    #expect(state.transcriptLoading)
    state.applyRealtimeEnvelope(
      .init(eventType: .create, messageId: newId, roomId: roomA)
    )
    transport.releaseMessagesGET()
    await waitForRealtimeIdle(state)
    #expect(state.transcriptMessages.map(\.content) == ["old", "oversize body"])
    #expect(transport.operationIDs.filter { $0 == "get/chats/rooms/{id}/messages" }.count == 2)
  }

  @Test func failedSwitchDuringEnvelopeRefreshStillRefetches() async throws {
    let oldId = "550e8400-e29b-41d4-a716-446655440744"
    let newId = "550e8400-e29b-41d4-a716-446655440745"
    let laterId = "550e8400-e29b-41d4-a716-446655440746"
    let (state, auth, transport) = try realtimeState([
      (200, realtimeAccessBody()),
      (200, realtimeOrgsBody),
      (200, realtimeUserBody),
      (200, #"{"data":{"organizationId":null},"meta":{"timestamp":"2026-01-01T00:00:00.000Z","requestId":"req-1"}}"#),
      (200, realtimeRoomsBody(ids: [roomA])),
      (200, realtimePageBody(messages: [realtimeMessageJSON(id: oldId, roomId: roomA, content: "old")])),
      (200, realtimeReadBody(id: roomA)),
      (500, """
      {"error":"Internal Server Error","message":"boom","meta":{"timestamp":"\(realtimeTimestamp)","requestId":"req-1","path":"/v1/users/me/preferred-organization","method":"PUT"}}
      """),
      (200, realtimePageBody(messages: [
        realtimeMessageJSON(id: oldId, roomId: roomA, content: "old"),
        realtimeMessageJSON(id: newId, roomId: roomA, content: "oversize")
      ])),
      (200, realtimeReadBody(id: roomA)),
      (200, realtimePageBody(messages: [
        realtimeMessageJSON(id: oldId, roomId: roomA, content: "old"),
        realtimeMessageJSON(id: newId, roomId: roomA, content: "oversize"),
        realtimeMessageJSON(id: laterId, roomId: roomA, content: "later", createdAt: "2026-01-01T00:00:02.000Z")
      ])),
      (200, realtimeReadBody(id: roomA))
    ])
    await state.reload(auth: auth)
    await waitForRealtimeIdle(state)
    transport.pauseNextMessagesGET = true
    state.applyRealtimeEnvelope(
      .init(eventType: .create, messageId: newId, roomId: roomA)
    )
    for _ in 0 ..< 1000 where !state.transcriptRefreshing {
      await Task.yield()
    }
    let org = try #require(state.options.first { $0.id == "org_1" })
    await state.switchRooms(auth: auth, option: org)
    #expect(state.selectionId == "personal")
    #expect(state.switchError != nil)
    transport.releaseMessagesGET()
    await waitForRealtimeIdle(state)
    #expect(!state.transcriptRefreshing)
    state.applyRealtimeEnvelope(
      .init(eventType: .create, messageId: laterId, roomId: roomA)
    )
    await waitForRealtimeIdle(state)
    #expect(state.transcriptMessages.map(\.content) == ["old", "oversize", "later"])
    #expect(transport.operationIDs.filter { $0 == "get/chats/rooms/{id}/messages" }.count == 3)
  }

  @Test func envelopeDeleteTombstonesOnScreenRow() async throws {
    let targetId = "550e8400-e29b-41d4-a716-446655440719"
    let (state, auth, _) = try realtimeState([
      (200, realtimeAccessBody()),
      (200, realtimeOrgsBody),
      (200, realtimeUserBody),
      (200, #"{"data":{"organizationId":null},"meta":{"timestamp":"2026-01-01T00:00:00.000Z","requestId":"req-1"}}"#),
      (200, realtimeRoomsBody(ids: [roomA])),
      (200, realtimePageBody(messages: [realtimeMessageJSON(id: targetId, roomId: roomA, content: "bye")])),
      (200, realtimeReadBody(id: roomA))
    ])
    await state.reload(auth: auth)
    await waitForRealtimeIdle(state)
    state.applyRealtimeEnvelope(
      .init(eventType: .delete, messageId: targetId, roomId: roomA)
    )
    #expect(state.transcriptMessages.count == 1)
    #expect(state.transcriptMessages[0].content.isEmpty)
    #expect(state.transcriptMessages[0].deletedAt != nil)
  }

  @Test func revokeDropsOpenRoomAndUpdatesMembership() async throws {
    let fake = FakeRealtimeConnection()
    let (state, auth, _) = try realtimeState([
      (200, realtimeAccessBody()),
      (200, realtimeOrgsBody),
      (200, realtimeUserBody),
      (200, #"{"data":{"organizationId":null},"meta":{"timestamp":"2026-01-01T00:00:00.000Z","requestId":"req-1"}}"#),
      (200, realtimeRoomsBody(ids: [roomA, roomB])),
      (200, realtimePageBody(messages: [realtimeMessageJSON(
        id: "550e8400-e29b-41d4-a716-446655440720",
        roomId: roomA,
        content: "in open room"
      )])),
      (200, realtimeReadBody(id: roomA))
    ])
    state.realtimeConnectionFactory = { fake }
    await state.reload(auth: auth)
    await waitForRealtimeIdle(state)
    #expect(state.selectedRoomId == roomA)

    state.applyMembershipRevoked(roomId: roomA)
    #expect(state.rooms.map(\.id) == [roomB])
    #expect(state.selectedRoomId == nil)
    #expect(state.transcriptRoomId == nil)
    #expect(state.transcriptMessages.isEmpty)
    #expect(fake.membershipRooms.last == [roomB])
  }

  @Test func pendingSidebarResponseCannotRestoreRevokedRoom() async throws {
    let (state, auth, transport) = try realtimeState([
      (200, realtimeAccessBody()), (200, realtimeOrgsBody), (200, realtimeUserBody),
      (200, #"{"data":{"organizationId":null},"meta":{"timestamp":"2026-01-01T00:00:00.000Z","requestId":"req-1"}}"#),
      (200, realtimeRoomsBody(ids: [roomA])),
      (200, realtimePageBody(messages: [])),
      (200, realtimeReadBody(id: roomA)),
      (200, realtimeRoomsBody(ids: [roomA]))
    ])
    await state.reload(auth: auth)
    await waitForRealtimeIdle(state)
    transport.pauseNextRoomsGET = true
    let refresh = Task { await state.refreshRooms(auth: auth) }
    await transport.waitForRoomsGET()
    state.applyMembershipRevoked(roomId: roomA)
    transport.releaseRoomsGET()
    await refresh.value
    #expect(state.rooms.isEmpty)
    #expect(state.selectedRoomId == nil)
    #expect(state.transcriptRoomId == nil)
  }

  @Test func pendingWorkspaceResponseCannotRestoreRevokedDestination() async throws {
    let fake = FakeRealtimeConnection()
    let (state, auth, transport) = try realtimeState([
      (200, realtimeAccessBody()), (200, realtimeOrgsBody), (200, realtimeUserBody),
      (200, #"{"data":{"organizationId":null},"meta":{"timestamp":"2026-01-01T00:00:00.000Z","requestId":"req-1"}}"#),
      (200, realtimeRoomsBody(ids: [roomA])),
      (200, realtimePageBody(messages: [])),
      (200, realtimeReadBody(id: roomA)),
      (200, #"{"data":{"organizationId":"org_1"},"meta":{"timestamp":"2026-01-01T00:00:00.000Z","requestId":"req-1"}}"#),
      (200, realtimeRoomsBody(ids: [roomB]))
    ])
    state.realtimeConnectionFactory = { fake }
    await state.reload(auth: auth)
    await waitForRealtimeIdle(state)
    let org = try #require(state.options.first { $0.id == "org_1" })
    transport.pauseNextRoomsGET = true
    let switching = Task { await state.switchRooms(auth: auth, option: org) }
    await transport.waitForRoomsGET()
    state.applyMembershipRevoked(roomId: roomB)
    transport.releaseRoomsGET()
    await switching.value
    #expect(state.selectionId == "org_1")
    #expect(state.rooms.isEmpty)
    #expect(state.selectedRoomId == nil)
    #expect(state.transcriptRoomId == nil)
    #expect(fake.membershipRooms.last?.isEmpty == true)
  }

  @Test func continuityLossWaitsForForegroundAndIgnoresOtherRooms() async throws {
    let fake = FakeRealtimeConnection()
    let (state, auth, transport) = try realtimeState([
      (200, realtimeAccessBody()), (200, realtimeOrgsBody), (200, realtimeUserBody),
      (200, #"{"data":{"organizationId":null},"meta":{"timestamp":"2026-01-01T00:00:00.000Z","requestId":"req-1"}}"#),
      (200, realtimeRoomsBody(ids: [roomA])),
      (200, realtimePageBody(messages: [])), (200, realtimeReadBody(id: roomA)),
      (200, realtimePageBody(messages: [])), (200, realtimeReadBody(id: roomA))
    ])
    state.realtimeConnectionFactory = { fake }
    await state.reload(auth: auth)
    await waitForRealtimeIdle(state)
    let initialRequests = transport.operationIDs.count
    fake.deliver(.roomHealth(roomId: roomB, healthy: false, continuityLost: true))
    fake.deliver(.roomHealth(roomId: roomA, healthy: true, continuityLost: false))
    // A following pin is a visible barrier for the ordered event stream.
    fake.deliver(.pin(roomId: roomA, messageId: "barrier", isPinned: true, count: 1))
    for _ in 0 ..< 1000 where state.timeline.pinOverrides["barrier"] != true {
      await Task.yield()
    }
    #expect(state.timeline.pinOverrides["barrier"] == true)
    await waitForRealtimeIdle(state)
    #expect(transport.operationIDs.count == initialRequests)
    state.setWindowVisible(false, window: realtimeWindow)
    fake.deliver(.roomHealth(roomId: roomA, healthy: false, continuityLost: true))
    fake.deliver(.roomHealth(roomId: roomA, healthy: true, continuityLost: true))
    fake.deliver(.pin(roomId: roomA, messageId: "barrier", isPinned: false, count: 0))
    for _ in 0 ..< 1000 where state.timeline.pinOverrides["barrier"] != false {
      await Task.yield()
    }
    #expect(state.timeline.pinOverrides["barrier"] == false)
    await waitForRealtimeIdle(state)
    #expect(transport.operationIDs.count == initialRequests)
    state.setWindowVisible(true, window: realtimeWindow)
    await waitForRealtimeIdle(state)
    #expect(transport.operationIDs.filter { $0 == "get/chats/rooms/{id}/messages" }.count == 2)
  }

  @Test func revokeKeepsUnrelatedRoomTranscript() async throws {
    let (state, auth, transport) = try realtimeState([
      (200, realtimeAccessBody()),
      (200, realtimeOrgsBody),
      (200, realtimeUserBody),
      (200, #"{"data":{"organizationId":null},"meta":{"timestamp":"2026-01-01T00:00:00.000Z","requestId":"req-1"}}"#),
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
    state.applyMembershipRevoked(roomId: roomB)
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
      (200, #"{"data":{"organizationId":null},"meta":{"timestamp":"2026-01-01T00:00:00.000Z","requestId":"req-1"}}"#),
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
    let fake = FakeRealtimeConnection()
    let (state, auth, transport) = try realtimeState(
      [
        (200, realtimeAccessBody()),
        (200, realtimeOrgsBody),
        (200, realtimeUserBody),
        (200, #"{"data":{"organizationId":null},"meta":{"timestamp":"2026-01-01T00:00:00.000Z","requestId":"req-1"}}"#),
        (200, realtimeRoomsBody(ids: [roomA])),
        (200, realtimePageBody(messages: [])),
        (200, realtimeReadBody(id: roomA)),
        (200, realtimeTokenBody())
      ],
      instanceId: "inst_personal0001"
    )
    state.realtimeConnectionFactory = { fake }
    await state.reload(auth: auth)
    await waitForRealtimeIdle(state)
    let provider = try #require(fake.tokenProvider)
    let token = try await provider(nil)
    #expect(token.keyName == "test.app")
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
    let (state, auth, _) = try realtimeState([
      (200, realtimeAccessBody()),
      (200, realtimeOrgsBody),
      (200, realtimeUserBody),
      (200, #"{"data":{"organizationId":null},"meta":{"timestamp":"2026-01-01T00:00:00.000Z","requestId":"req-1"}}"#),
      (200, realtimeRoomsBody(ids: [roomA])),
      (200, realtimePageBody(messages: [realtimeMessageJSON(id: firstId, roomId: roomA, content: "first")])),
      (200, realtimeReadBody(id: roomA)),
      (200, realtimeTokenBody())
    ])
    state.realtimeConnectionFactory = { fake }
    await state.reload(auth: auth)
    await waitForRealtimeIdle(state)

    #expect(fake.connectCount == 1)
    #expect(fake.connectedUserId == "user_1" && fake.connectedSlug == nil)
    #expect(fake.watchedRooms == [roomA] && fake.membershipRooms == [[roomA]])

    let live = try await decodeRealtimeMessages([
      realtimeMessageJSON(id: liveId, roomId: roomA, content: "over the wire", createdAt: "2026-01-01T00:00:01.000Z")
    ])
    fake.deliver(.message(roomId: roomA, eventType: .create, message: live[0]))
    for _ in 0 ..< 1000 where state.displayedTranscript.map(\.content) != ["first", "over the wire"] {
      await Task.yield()
    }
    #expect(state.displayedTranscript.map(\.content) == ["first", "over the wire"])

    fake.deliver(.pin(roomId: roomA, messageId: liveId, isPinned: true, count: 1))
    for _ in 0 ..< 1000 where state.timeline.pinOverrides[liveId] != true {
      await Task.yield()
    }
    #expect(state.timeline.pinOverrides[liveId] == true)
    #expect(state.rooms.first?.pinnedMessageCount == 1)
    fake.deliver(.pin(roomId: roomA, messageId: liveId, isPinned: false, count: 0))
    for _ in 0 ..< 1000 where state.timeline.pinOverrides[liveId] != false {
      await Task.yield()
    }
    #expect(state.timeline.pinOverrides[liveId] == false)
    #expect(state.rooms.first?.pinnedMessageCount == 0)

    fake.deliver(.revoked(roomId: roomA))
    for _ in 0 ..< 1000 where !state.rooms.isEmpty {
      await Task.yield()
    }
    #expect(state.rooms.isEmpty)
    #expect(state.selectedRoomId == nil)
    #expect(state.transcriptRoomId == nil)
    #expect(fake.watchedRooms == [roomA, nil])
    #expect(state.timeline.pinOverrides.isEmpty)

    state.reset()
    #expect(fake.disconnectCount == 1)
  }

  @Test func workspaceSwitchRetargetsSlugReauthorizesAndRewatches() async throws {
    let fake = FakeRealtimeConnection()
    let (state, auth, _) = try realtimeState([
      (200, realtimeAccessBody()),
      (200, realtimeOrgsBody),
      (200, realtimeUserBody),
      (200, #"{"data":{"organizationId":null},"meta":{"timestamp":"2026-01-01T00:00:00.000Z","requestId":"req-1"}}"#),
      (200, realtimeRoomsBody(ids: [roomA])),
      (200, realtimePageBody(messages: [])),
      (200, realtimeReadBody(id: roomA)),
      (200, """
      {"data":{"organizationId":"org_1"},"meta":{"timestamp":"\(realtimeTimestamp)","requestId":"req-1"}}
      """),
      (200, realtimeRoomsBody(ids: [roomB])),
      (200, realtimePageBody(messages: [])),
      (200, realtimeReadBody(id: roomB))
    ])
    state.realtimeConnectionFactory = { fake }
    await state.reload(auth: auth)
    await waitForRealtimeIdle(state)
    #expect(fake.watchedRooms == [roomA])

    let org = try #require(state.options.first { $0.id == "org_1" })
    await state.switchRooms(auth: auth, option: org)
    await waitForRealtimeIdle(state)

    #expect(state.selectionId == "org_1")
    #expect(fake.slugs == ["acme"])
    #expect(fake.connectedSlug == nil)
    #expect(fake.membershipRooms.last == [roomB])
    #expect(fake.watchedRooms == [roomA, nil, roomB])
    #expect(state.selectedRoomId == roomB)
  }
}
