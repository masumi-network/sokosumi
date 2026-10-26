import Combine
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

private final class RealtimeScriptedTransport: ClientTransport, @unchecked Sendable {
  private(set) var operationIDs: [String] = []
  private(set) var requests: [HTTPRequest] = []
  private(set) var bodies: [Data] = []
  private var responses: [(Int, String)]
  var pausePOST = false
  var pauseNextMessagesGET = false
  var pauseNextRoomsGET = false
  var pauseNextRead = false
  private var readWaiter: CheckedContinuation<Void, Never>?
  private var readReleased = false
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
    if pauseNextRead, operationID == "post/chats/rooms/{id}/read" {
      pauseNextRead = false
      if !readReleased {
        await withCheckedContinuation { readWaiter = $0 }
      }
    }
    let next = try nextScriptedResponse(&responses, operationID: operationID)
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

  func releaseRead() {
    readReleased = true
    readWaiter?.resume()
    readWaiter = nil
  }
}

private let personalWorkspaceId = "11111111-1111-7111-8111-111111111111"
private let acmeWorkspaceId = "22222222-2222-7222-8222-222222222222"

/// One `UserWorkspace`: personal for nil, Acme for `org_1`.
private func userWorkspaceJSON(_ organizationId: String?, preferred: Bool) -> String {
  organizationId == nil
    ? #"{"id":"\#(personalWorkspaceId)","kind":"personal","name":"Me","organizationId":null,"slug":null,"logo":null,"websiteUrl":null,"preferred":\#(preferred)}"#
    : #"{"id":"\#(acmeWorkspaceId)","kind":"organization","name":"Acme","organizationId":"org_1","slug":"acme","logo":null,"websiteUrl":null,"preferred":\#(preferred)}"#
}

/// `GET /users/me/workspaces`: personal and Acme, `preferring` the one a
/// session opens (nil is personal).
private func workspacesBody(preferring organizationId: String? = nil) -> String {
  """
  {"data":{"workspaces":[\(userWorkspaceJSON(nil, preferred: organizationId == nil)),\(userWorkspaceJSON("org_1", preferred: organizationId == "org_1"))],"pendingInvitationCount":0},"meta":{"timestamp":"\(realtimeTimestamp)","requestId":"req-1"}}
  """
}

/// `PUT /users/me/workspaces/preferred` reply.
private func preferredWorkspaceBody(preferring organizationId: String? = nil) -> String {
  """
  {"data":\(userWorkspaceJSON(organizationId, preferred: true)),"meta":{"timestamp":"\(realtimeTimestamp)","requestId":"req-1"}}
  """
}

private let realtimeUserBody = """
{"data":{"id":"user_1","createdAt":"\(realtimeTimestamp)","updatedAt":"\(realtimeTimestamp)","name":"Me","email":"me@example.com","emailVerified":true,"role":"user"},"meta":{"timestamp":"\(realtimeTimestamp)","requestId":"req-1"}}
"""

private func realtimeRoomsBody(ids: [String], groupDirect: Bool = false, userMembers: String = "[]") -> String {
  let rooms = ids.map { id in
    """
    {"id":"\(id)","organizationId":null,"organizationName":null,"name":"\(id)","slug":null,"kind":"\(groupDirect ? "direct" : "channel")","isSelfDirect":false,"directKey":null,"isGroupDirect":\(groupDirect),"isReadOnly":false,"formerUserMembers":[],"groupName":null,"topic":null,"discoverability":null,"createdByUserId":"user_1","createdAt":"\(realtimeTimestamp)","updatedAt":"\(realtimeTimestamp)","unreadCount":0,"unreadMentionCount":0,"starredAt":null,"pinnedMessageCount":0,"mutedAt":null,"markedUnread":false,"myAccess":"member","peerInActiveOrganization":false,"userMembers":\(userMembers),"coworkerMembers":[],"sokoBotMembers":[]}
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
  metadata: String? = nil,
  groupNameChange: String? = nil
) -> String {
  let deletedJSON = deletedAt.map { "\"\($0)\"" } ?? "null"
  let editedJSON = editedAt.map { "\"\($0)\"" } ?? "null"
  return """
  {"id":"\(id)","roomId":"\(roomId)","parentMessageId":null,"content":"\(content)","createdAt":"\(createdAt)","deletedAt":\(deletedJSON),"editedAt":\(editedJSON),"sender":{"type":"user","user":{"id":"user_2","name":"Ada","email":"ada@example.com","presence":"offline"}},"mentions":[],"reactions":[],"threadReplyCount":0,"threadLastReplyAt":null,"metadata":\(metadata ?? "null"),"quote":null,"membership":null,"groupNameChange":\(groupNameChange ?? "null"),"unfurls":null}
  """
}

private func realtimePageBody(messages: [String], nextCursor: String? = nil) -> String {
  """
  {"data":[\(messages.joined(separator: ","))],"meta":{"timestamp":"\(realtimeTimestamp)","requestId":"req-1","pagination":{"cursor":null,"limit":100,"total":\(messages.count),"nextCursor":\(nextCursor.map { "\"\($0)\"" } ?? "null")}}}
  """
}

private func realtimeReadBody(id: String) -> String {
  """
  {"data":{"id":"\(id)","organizationId":null,"organizationName":null,"name":"\(id)","slug":null,"kind":"channel","isSelfDirect":false,"directKey":null,"isGroupDirect":false,"isReadOnly":false,"formerUserMembers":[],"groupName":null,"topic":null,"discoverability":null,"createdByUserId":"user_1","createdAt":"\(realtimeTimestamp)","updatedAt":"\(realtimeTimestamp)","unreadCount":0,"unreadMentionCount":0,"starredAt":null,"pinnedMessageCount":0,"mutedAt":null,"markedUnread":false,"myAccess":"member","peerInActiveOrganization":false,"userMembers":[],"coworkerMembers":[],"sokoBotMembers":[]},"meta":{"timestamp":"\(realtimeTimestamp)","requestId":"req-1"}}
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
  let client = try Client.core(baseURL: #require(URL(string: "https://core.example/v1")), transport: transport)
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
  instanceId: String = "inst_test00000001",
  realtime: (@Sendable () -> any RealtimeConnection)? = nil,
  presenter: (any ChatNotificationPresenting)? = nil
) throws -> (WorkspaceState, AuthState, RealtimeScriptedTransport) { // swiftlint:disable:this large_tuple
  let transport = RealtimeScriptedTransport(responses)
  let client = try Client.core(baseURL: #require(URL(string: "https://core.example/v1")), transport: transport)
  let suite = "sokosumi-workspace-realtime-tests.\(UUID().uuidString)"
  let defaults = UserDefaults(suiteName: suite)!
  defaults.removePersistentDomain(forName: suite)
  let auth = AuthState(configuration: nil, store: InMemoryTokenStore(), browser: StubOAuthBrowser(), restoreSession: false)
  let state = WorkspaceState(
    auth: auth,
    savedRoom: SavedRoomSelection(defaults: defaults),
    instanceStore: MemoryRealtimeClientInstanceIdStore(stored: instanceId),
    realtimeConnectionFactory: realtime,
    notificationPresenter: presenter,
    sleep: recoveryTimersNeverFire
  )
  state.setWindowVisible(true, window: realtimeWindow)
  keepRoomListAtTheEnd(state)
  state.clientResolver = { client }
  return (state, auth, transport)
}

/// Holds a room-list read in flight, runs `action` until it has sent `operation` (the change on Core) and has had
/// time to reach its own room read, then lets the held read finish with the list it started with. Nothing observable
/// says the action is waiting on the held read, so the yields are a budget: a run that releases too early passes
/// without the fix, never fails with it.
private func whileARoomListReadIsInFlight<T: Sendable>(
  _ state: WorkspaceState,
  _ transport: RealtimeScriptedTransport,
  until operation: String,
  _ action: @escaping () async throws -> T
) async throws -> T {
  transport.pauseNextRoomsGET = true
  let listing = Task { await state.refreshRooms() }
  await transport.waitForRoomsGET()
  let acting = Task { try await action() }
  // Bounded: an action that fails before sending `operation` surfaces its error below instead of hanging the run.
  for _ in 0 ..< 10000 where !transport.operationIDs.contains(operation) {
    await Task.yield()
  }
  #expect(transport.operationIDs.contains(operation))
  for _ in 0 ..< 100 {
    await Task.yield()
  }
  transport.releaseRoomsGET()
  await listing.value
  return try await acting.value
}

private func waitForRealtimeIdle(_ state: WorkspaceState) async {
  while state.sidebarRecovery.isRefreshing || state.roomsRefreshTask != nil || state.openRoom.room.recovery.isRefreshing || state.openRoom.room.loadTask != nil {
    await state.roomsRefreshTask?.value
    _ = await state.openRoom.room.loadTask?.value
    await Task.yield()
  }
  for _ in 0 ..< 1000 where state.openRoom.room.outbox.isSending {
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
  private(set) var presenceOrganizations: [String?] = []
  private(set) var publishedPresence: [ChatPresenceMemberData] = []
  private(set) var inFront: [Bool] = []
  /// Room watches, Typing publishes and the disconnect, in the order the coordinator issued them.
  private(set) var typingLog: [String] = []
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
    typingLog.append("watch \(roomId ?? "nil")")
  }

  func publishTyping(_ state: ChatTypingState, roomId: String) {
    typingLog.append("\(state.rawValue) \(roomId)")
  }

  func setMembershipRooms(_ roomIds: Set<String>) {
    membershipRooms.append(roomIds)
  }

  func refreshMembership() {
    membershipRefreshes += 1
  }

  func setPresenceOrganization(_ organizationId: String?) {
    presenceOrganizations.append(organizationId)
  }

  func publishPresence(_ data: ChatPresenceMemberData) {
    publishedPresence.append(data)
  }

  func setInFront(_ inFront: Bool) {
    self.inFront.append(inFront)
  }

  func disconnect() {
    disconnectCount += 1
    typingLog.append("disconnect")
  }

  func deliver(_ event: ResolvedRealtimeDelivery) {
    handler?(event)
  }
}

struct WorkspaceRealtimeTests {
  /// Row 07d (web `use-chat-refresh-scheduler.ts` explicit requests): an id envelope reads the open room while no chat
  /// window is active, without marking it read; the second envelope queues one follow-up, and the return reads nothing.
  @Test func hiddenEnvelopeReadsWithoutMarkingRead() async throws {
    let (state, _, transport) = try realtimeState([
      (200, workspacesBody()),
      (200, realtimeUserBody),
      (200, realtimeRoomsBody(ids: [roomA])),
      (200, realtimePageBody(messages: [])),
      (200, realtimeReadBody(id: roomA)),
      (200, realtimePageBody(messages: [])),
      (200, realtimePageBody(messages: []))
    ])
    await state.reload()
    await waitForRealtimeIdle(state)
    state.setWindowVisible(false, window: realtimeWindow)
    state.applyRealtimeEnvelope(.init(eventType: .create, messageId: "new", roomId: roomA))
    state.applyRealtimeEnvelope(.init(eventType: .update, messageId: "new", roomId: roomA))
    await waitForRealtimeIdle(state)
    #expect(transport.operationIDs.filter { $0 == "get/chats/rooms/{id}/messages" }.count == 3)
    #expect(transport.operationIDs.filter { $0 == "post/chats/rooms/{id}/read" }.count == 1)
    state.setWindowVisible(true, window: realtimeWindow)
    await waitForRealtimeIdle(state)
    #expect(transport.operationIDs.filter { $0 == "get/chats/rooms/{id}/messages" }.count == 3)
    state.reset()
  }

  @Test func realtimeCreateAppearsWithoutReload() async throws {
    let firstId = "550e8400-e29b-41d4-a716-446655440710"
    let liveId = "550e8400-e29b-41d4-a716-446655440711"
    let (state, _, transport) = try realtimeState([
      (200, workspacesBody()),
      (200, realtimeUserBody),
      (200, realtimeRoomsBody(ids: [roomA])),
      (200, realtimePageBody(messages: [realtimeMessageJSON(id: firstId, roomId: roomA, content: "first")])),
      (200, realtimeReadBody(id: roomA))
    ])
    await state.reload()
    await waitForRealtimeIdle(state)
    #expect(state.openRoom.displayedTranscript.map(\.content) == ["first"])

    let live = try await decodeRealtimeMessages([
      realtimeMessageJSON(id: liveId, roomId: roomA, content: "from web", createdAt: "2026-01-01T00:00:01.000Z")
    ])
    state.applyRealtimeMessage(roomId: roomA, eventType: .create, message: live[0])
    #expect(state.openRoom.displayedTranscript.map(\.content) == ["first", "from web"])
    // No extra history GET: the row arrived over the wire.
    #expect(transport.operationIDs.filter { $0 == "get/chats/rooms/{id}/messages" }.count == 1)
  }

  /// Row 38e1: the turn's completion arrives as a full update carrying the descriptors (web hydrates
  /// `resultPreviews` from the realtime DTO), so the row reads its cards without a reload, through the room's
  /// workspace.
  @Test func aCompletionUpdateBringsTheDescriptorsAndTheRowReadsItsCards() async throws {
    let replyId = "550e8400-e29b-41d4-a716-446655440730"
    let card = "7d1f0c2a-0000-4000-8000-000000000001"
    let locked = "7d1f0c2a-0000-4000-8000-000000000002"
    let results = """
    {"data":[{"id":"\(card)","state":"available","capturedAt":"\(realtimeTimestamp)","kind":"file","title":"plan.pdf",\
    "status":null,"sourceHref":"/drive/files/f1?scope=org&organizationId=org_1"},{"id":"\(locked)","state":"unavailable"}],\
    "meta":{"timestamp":"\(realtimeTimestamp)","requestId":"req-1"}}
    """
    let (state, _, transport) = try realtimeState([
      (200, workspacesBody(preferring: "org_1")), (200, realtimeUserBody),
      (200, realtimeRoomsBody(ids: [roomA])),
      (200, realtimePageBody(messages: [realtimeMessageJSON(id: replyId, roomId: roomA, content: "")])),
      (200, results)
    ])
    // No realtime connection here, so the open room's fallback poll reads history every 3 s while a window is
    // active; with none active it waits (and nothing is marked read), so the script holds exactly the reads this test
    // makes however slow the run.
    state.setWindowVisible(false, window: realtimeWindow)
    await state.reload()
    await waitForRealtimeIdle(state)
    let placeholder = try #require(state.openRoom.room.timeline.messages.first { $0.id == replyId })
    #expect(MessageResultPreviews.descriptorIds(of: placeholder).isEmpty)

    let answered = try await decodeRealtimeMessages([
      realtimeMessageJSON(id: replyId, roomId: roomA, content: "Here is the plan.", editedAt: nil)
        .replacingOccurrences(of: #""unfurls":null}"#,
                              with: #""unfurls":null,"resultPreviews":[{"id":"\#(card)","capturedAt":"\#(realtimeTimestamp)"},{"id":"\#(locked)","capturedAt":"\#(realtimeTimestamp)"}]}"#)
    ])
    state.applyRealtimeMessage(roomId: roomA, eventType: .update, message: answered[0])
    let reply = try #require(state.openRoom.room.timeline.messages.first { $0.id == replyId })
    #expect(MessageResultPreviews.descriptorIds(of: reply) == [card, locked])

    let previews = try await state.messageResultPreviews(reply)
    #expect(previews.count == 2)
    #expect(transport.operationIDs.last == "getChatRoomMessageResults")
    let request = try #require(transport.requests.last)
    #expect(request.path?.hasSuffix("/chats/rooms/\(roomA)/messages/\(replyId)/results") == true)
    #expect(HTTPField.Name("X-Organization-Slug").flatMap { request.headerFields[$0] } == "acme")
    state.reset()
  }

  @Test func aProjectPickRepliesToTheBotAndLandsInTheRoomAtOnce() async throws {
    let questionId = "550e8400-e29b-41d4-a716-446655440731"
    let replyId = "550e8400-e29b-41d4-a716-446655440732"
    let preview = "7d1f0c2a-0000-4000-8000-000000000007"
    let books = "0b5e0e7a-0000-4000-8000-0000000000a1"
    let results = """
    {"data":[{"id":"\(preview)","state":"available","capturedAt":"\(realtimeTimestamp)","kind":"project_selection",\
    "title":"Choose a project","status":null,"sourceHref":"/projects",\
    "projectOptions":[{"id":"\(books)","name":"Books","identifier":null,"logo":null}]}],\
    "meta":{"timestamp":"\(realtimeTimestamp)","requestId":"req-1"}}
    """
    let botSender = #"{"type":"sokoBot","sokoBot":{"id":"bot_1","name":"Soko","caption":"Me's personal assistant","image":null,"avatarSeed":"orb:user_1","ownerUserId":"user_1","scope":"personal","presence":"online"}}"#
    let question = realtimeMessageJSON(id: questionId, roomId: roomA, content: "Which project?")
      .replacingOccurrences(of: #"{"type":"user","user":{"id":"user_2","name":"Ada","email":"ada@example.com","presence":"offline"}}"#, with: botSender)
    let (state, _, transport) = try realtimeState([
      (200, workspacesBody(preferring: "org_1")), (200, realtimeUserBody),
      (200, realtimeRoomsBody(ids: [roomA])),
      (200, realtimePageBody(messages: [question])),
      (200, results),
      (201, realtimeCreatedBody(id: replyId, roomId: roomA, content: #"Use project \"Books\" (project ID: \#(books))."#))
    ])
    // As above: no window active, so the fallback poll takes no scripted answer.
    state.setWindowVisible(false, window: realtimeWindow)
    await state.reload()
    await waitForRealtimeIdle(state)
    let asked = try #require(state.openRoom.room.timeline.messages.first { $0.id == questionId })

    try await state.selectProject(books, preview: preview, question: asked)
    #expect(Array(transport.operationIDs.suffix(2)) == ["getChatRoomMessageResults", "post/chats/rooms/{id}/messages"])
    #expect(transport.requests.suffix(2).allSatisfy { request in
      HTTPField.Name("X-Organization-Slug").flatMap { request.headerFields[$0] } == "acme"
    })
    let body = try #require(transport.bodies.last)
    let sent = try #require(JSONSerialization.jsonObject(with: body) as? [String: Any])
    #expect(sent["mentionedSokoBotIds"] as? [String] == ["bot_1"])
    #expect(sent["clientMessageId"] as? String == ProjectSelection.clientMessageId(
      userId: "user_1", roomId: roomA, messageId: questionId, previewId: preview, projectId: books
    ))
    let reply = try #require(state.openRoom.room.timeline.messages.last)
    #expect(reply.id == replyId)
    #expect(ProjectSelectionReply(content: reply.content) == ProjectSelectionReply(projectId: books, name: "Books"))
    state.reset()
  }

  /// Row 38h2: Approve on a decision card resolves the owner's decision through the coordinator's client, with no
  /// workspace header (decisions are the owner's); a 401 reaches the card as the session's rejection (which signs out).
  @Test func aDecisionResolvesForItsOwnerOutsideTheWorkspace() async throws {
    let decisionId = "3c4d5e6f-0000-4000-8000-0000000000d1"
    let settled = """
    {"data":{"id":"\(decisionId)","turnId":"3c4d5e6f-0000-4000-8000-0000000000e1","toolName":"hire_agent",\
    "proposal":{"agentId":"agent_123","maxCredits":25},"reason":"Hire Scout","status":"ACCEPTED",\
    "expiresAt":"\(realtimeTimestamp)","resolvedAt":"\(realtimeTimestamp)","resultingEntityId":"job_1",\
    "createdAt":"\(realtimeTimestamp)","updatedAt":"\(realtimeTimestamp)"},"meta":{"timestamp":"\(realtimeTimestamp)","requestId":"req-1"}}
    """
    let rejected = #"{"error":"Unauthorized","message":"Session expired","meta":{"timestamp":"\#(realtimeTimestamp)","requestId":"req-1","path":"/x","method":"POST"}}"#
    let (state, _, transport) = try realtimeState([
      (200, workspacesBody(preferring: "org_1")), (200, realtimeUserBody),
      (200, realtimeRoomsBody(ids: [roomA])),
      (200, realtimePageBody(messages: [])),
      (200, settled),
      (401, rejected)
    ])
    // With no window active the open room's fallback poll waits, so the script holds exactly these reads.
    state.setWindowVisible(false, window: realtimeWindow)
    await state.reload()
    await waitForRealtimeIdle(state)

    try await state.resolveSokoBotDecision(decisionId, .accept)
    #expect(transport.operationIDs.last == "resolveMySokoBotDecision")
    let request = try #require(transport.requests.last)
    #expect(request.path?.hasSuffix("/soko-bots/me/decisions/\(decisionId)") == true)
    #expect(HTTPField.Name("X-Organization-Slug").flatMap { request.headerFields[$0] } == nil)
    let body = try #require(transport.bodies.last)
    #expect(try JSONSerialization.jsonObject(with: body) as? [String: String] == ["resolution": "ACCEPT"])

    await #expect(throws: ChatServiceError.unauthorized("Session expired")) {
      try await state.resolveSokoBotDecision(decisionId, .reject)
    }
    #expect(transport.operationIDs.suffix(2) == ["resolveMySokoBotDecision", "resolveMySokoBotDecision"])
    #expect(try JSONSerialization.jsonObject(with: #require(transport.bodies.last)) as? [String: String] == ["resolution": "REJECT"])
    state.reset()
  }

  /// Row 38e2: a card's protected output loads through the coordinator's client in the open workspace, as web's
  /// proxy forwards the session; a 401 reaches the caller as the session's rejection (which signs out).
  @Test func aResultOutputLoadsInTheOpenWorkspace() async throws {
    let rejected = #"{"error":"Unauthorized","message":"Session expired","meta":{"timestamp":"\#(realtimeTimestamp)","requestId":"req-1","path":"/x","method":"GET"}}"#
    let (state, _, transport) = try realtimeState([
      (200, workspacesBody(preferring: "org_1")), (200, realtimeUserBody),
      (200, realtimeRoomsBody(ids: [roomA])),
      (200, realtimePageBody(messages: [])),
      (200, "%PDF-1.7 report"),
      (401, rejected)
    ])
    // With no window active the open room's fallback poll waits, so the script holds exactly these reads.
    state.setWindowVisible(false, window: realtimeWindow)
    await state.reload()
    await waitForRealtimeIdle(state)

    let file = try await state.resultOutput(.jobFile(jobId: "job-1", fileId: "blob-1", download: true), fileName: "report.pdf")
    #expect(try Data(contentsOf: file.url) == Data("%PDF-1.7 report".utf8))
    #expect(file.url.lastPathComponent == "report.pdf")
    #expect(transport.operationIDs.last == "get/jobs/{id}/files/{fileId}/content")
    let request = try #require(transport.requests.last)
    #expect(request.path?.hasSuffix("/jobs/job-1/files/blob-1/content?download=true") == true)
    #expect(HTTPField.Name("X-Organization-Slug").flatMap { request.headerFields[$0] } == "acme")

    await #expect(throws: ChatServiceError.unauthorized("Session expired")) {
      try await state.resultOutput(.studioAsset(projectId: "p1", assetId: "a1"), fileName: "fox.png")
    }
    #expect(transport.operationIDs.last == "get/projects/{id}/image-studio/assets/{assetId}/content")
    state.reset()
  }

  @Test func renameRowRetitlesTheOpenGroupDirect() async throws {
    let (state, _, _) = try realtimeState([
      (200, workspacesBody()),
      (200, realtimeUserBody),
      (200, realtimeRoomsBody(ids: [roomA], groupDirect: true)),
      (200, realtimePageBody(messages: [realtimeMessageJSON(id: "550e8400-e29b-41d4-a716-446655440716", roomId: roomA, content: "first")])),
      (200, realtimeReadBody(id: roomA))
    ])
    await state.reload()
    await waitForRealtimeIdle(state)
    #expect(state.rooms.first?.groupName == nil)
    var listWrites = 0
    let watch = state.sidebar.$rooms.dropFirst().sink { _ in listWrites += 1 }
    defer { watch.cancel() }
    let plain = try await decodeRealtimeMessages([
      realtimeMessageJSON(id: "550e8400-e29b-41d4-a716-446655440719", roomId: roomA, content: "Just a message",
                          createdAt: "2026-01-01T00:00:00.500Z")
    ])
    state.applyRealtimeMessage(roomId: roomA, eventType: .create, message: plain[0])
    #expect(listWrites == 0, "A message that renames nothing leaves the room list alone.")

    let change = #"{"action":"named","name":"Launch crew","actor":{"id":"user_2","name":"Ada"}}"#
    let renamed = try await decodeRealtimeMessages([
      realtimeMessageJSON(id: "550e8400-e29b-41d4-a716-446655440717", roomId: roomA, content: "Ada named the group Launch crew",
                          createdAt: "2026-01-01T00:00:01.000Z", groupNameChange: change)
    ])
    state.applyRealtimeMessage(roomId: roomA, eventType: .create, message: renamed[0])
    #expect(state.rooms.first?.groupName == "Launch crew")
    #expect(listWrites == 1)
    #expect(state.openRoom.displayedTranscript.map(\.content) == ["first", "Just a message", "Ada named the group Launch crew"])

    let cleared = try await decodeRealtimeMessages([
      realtimeMessageJSON(id: "550e8400-e29b-41d4-a716-446655440718", roomId: roomA, content: "Ada removed the group name",
                          createdAt: "2026-01-01T00:00:02.000Z", groupNameChange: #"{"action":"cleared","name":null,"actor":{"id":"user_2","name":"Ada"}}"#)
    ])
    state.applyRealtimeMessage(roomId: roomA, eventType: .create, message: cleared[0])
    #expect(state.rooms.first?.groupName == nil)
    state.reset()
  }

  @Test func realtimeUpdateAndHardDeleteApply() async throws {
    let targetId = "550e8400-e29b-41d4-a716-446655440712"
    let otherId = "550e8400-e29b-41d4-a716-446655440713"
    let (state, _, _) = try realtimeState([
      (200, workspacesBody()),
      (200, realtimeUserBody),
      (200, realtimeRoomsBody(ids: [roomA])),
      (200, realtimePageBody(messages: [
        realtimeMessageJSON(id: targetId, roomId: roomA, content: "hello"),
        realtimeMessageJSON(id: otherId, roomId: roomA, content: "other")
      ])),
      (200, realtimeReadBody(id: roomA))
    ])
    await state.reload()
    await waitForRealtimeIdle(state)

    let edited = try await decodeRealtimeMessages([
      realtimeMessageJSON(id: targetId, roomId: roomA, content: "hello edited", editedAt: realtimeTimestamp)
    ])
    state.applyRealtimeMessage(roomId: roomA, eventType: .update, message: edited[0])
    #expect(state.openRoom.room.timeline.messages.first { $0.id == targetId }?.content == "hello edited")

    let deleted = try await decodeRealtimeMessages([
      realtimeMessageJSON(id: targetId, roomId: roomA, content: "hello edited", editedAt: realtimeTimestamp)
    ])
    state.applyRealtimeMessage(roomId: roomA, eventType: .delete, message: deleted[0])
    #expect(state.openRoom.room.timeline.messages.map(\.id) == [otherId])
  }

  /// Row 07d: activity in another room re-reads the room list while no chat window is active, as web's tab title
  /// follows it while away; the second request queues one follow-up, and the return reads nothing more.
  @Test func foreignActivityRefreshesSidebarWhileHidden() async throws {
    let firstId = "550e8400-e29b-41d4-a716-446655440714"
    let (state, _, transport) = try realtimeState([
      (200, workspacesBody()),
      (200, realtimeUserBody),
      (200, realtimeRoomsBody(ids: [roomA])),
      (200, realtimePageBody(messages: [realtimeMessageJSON(id: firstId, roomId: roomA, content: "first")])),
      (200, realtimeReadBody(id: roomA)),
      (200, realtimeRoomsBody(ids: [roomA, roomB])),
      (200, realtimeRoomsBody(ids: [roomA, roomB]))
    ])
    await state.reload()
    await waitForRealtimeIdle(state)

    let foreign = try await decodeRealtimeMessages([
      realtimeMessageJSON(id: "550e8400-e29b-41d4-a716-446655440715", roomId: roomB, content: "elsewhere")
    ])
    state.setWindowVisible(false, window: realtimeWindow)
    state.applyRealtimeMessage(roomId: roomB, eventType: .create, message: foreign[0])
    state.applyRealtimeEnvelope(.init(eventType: .create, messageId: "large", roomId: roomB))
    await waitForRealtimeIdle(state)
    #expect(transport.operationIDs.filter { $0 == "get/chats/rooms" }.count == 3)
    #expect(state.rooms.map(\.id) == [roomA, roomB])
    state.setWindowVisible(true, window: realtimeWindow)
    await waitForRealtimeIdle(state)
    #expect(transport.operationIDs.filter { $0 == "get/chats/rooms" }.count == 3)
    #expect(state.rooms.map(\.id) == [roomA, roomB])
    #expect(state.openRoom.displayedTranscript.map(\.content) == ["first"])
    state.reset()
  }

  @Test func ownSendPlusAblyCreateDedupeToOneBubble() async throws {
    let confirmedId = "550e8400-e29b-41d4-a716-446655440716"
    let (state, _, transport) = try realtimeState([
      (200, workspacesBody()),
      (200, realtimeUserBody),
      (200, realtimeRoomsBody(ids: [roomA])),
      (200, realtimePageBody(messages: [])),
      (200, realtimeReadBody(id: roomA)),
      (201, realtimeCreatedBody(id: confirmedId, roomId: roomA, content: "hello"))
    ])
    await state.reload()
    await waitForRealtimeIdle(state)
    transport.pausePOST = true
    state.sendMessage("hello")
    for _ in 0 ..< 1000 where !transport.operationIDs.contains("post/chats/rooms/{id}/messages") {
      await Task.yield()
    }
    let turnId = try #require(state.openRoom.room.outbox.shells.first?.clientTurnId)
    #expect(state.openRoom.displayedTranscript.map(\.content) == ["hello"])

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
    #expect(state.openRoom.room.outbox.shells.isEmpty)
    #expect(state.openRoom.displayedTranscript.map(\.content) == ["hello"])
    #expect(state.openRoom.room.timeline.messages.map(\.id) == [confirmedId])

    transport.releasePOST()
    await waitForRealtimeIdle(state)
    #expect(state.openRoom.displayedTranscript.map(\.content) == ["hello"])
    #expect(transport.operationIDs.filter { $0 == "post/chats/rooms/{id}/messages" }.count == 1)
  }

  @Test func queuedEnvelopeAfterOlderPageIsRefetched() async throws {
    let messageId = "550e8400-e29b-41d4-a716-446655440717"
    let (state, _, transport) = try realtimeState([
      (200, workspacesBody()), (200, realtimeUserBody),
      (200, realtimeRoomsBody(ids: [roomA])),
      (200, realtimePageBody(messages: [], nextCursor: "older")),
      (200, realtimeReadBody(id: roomA)),
      (200, realtimePageBody(messages: [])),
      (200, realtimePageBody(messages: [realtimeMessageJSON(id: messageId, roomId: roomA, content: "arrived")])),
      (200, realtimeReadBody(id: roomA))
    ])
    await state.reload()
    await waitForRealtimeIdle(state)
    transport.pauseNextMessagesGET = true
    // Both actions queue before either page request starts.
    state.openRoom.loadOlder()
    state.applyRealtimeEnvelope(.init(eventType: .create, messageId: messageId, roomId: roomA))
    await transport.waitForMessagesGET()
    transport.releaseMessagesGET()
    await waitForRealtimeIdle(state)
    #expect(state.openRoom.room.timeline.messages.map(\.content) == ["arrived"])
    #expect(transport.operationIDs.filter { $0 == "get/chats/rooms/{id}/messages" }.count == 3)
  }

  @Test(arguments: [false, true]) func envelopeCreateRefetchesAndMergesWithoutFakeRow(openParent: Bool) async throws {
    let oldId = "550e8400-e29b-41d4-a716-446655440717"
    let newId = "550e8400-e29b-41d4-a716-446655440718"
    let (state, _, transport) = try realtimeState([
      (200, workspacesBody()),
      (200, realtimeUserBody),
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
    await state.reload()
    await waitForRealtimeIdle(state)
    if openParent {
      try state.openRoom.thread.open(#require(state.openRoom.room.timeline.messages.first))
    }
    state.applyRealtimeEnvelope(
      .init(eventType: .create, messageId: openParent ? oldId : newId, roomId: roomA)
    )
    state.openRoom.thread.close()
    await waitForRealtimeIdle(state)
    #expect(state.openRoom.room.timeline.messages.map(\.content) == ["old edited", "oversize body"])
    #expect(state.openRoom.room.timeline.errorMessage == nil)
    // Refreshed visible content advances room attention again.
    #expect(transport.operationIDs.filter { $0 == "get/chats/rooms/{id}/messages" }.count == 2)
    #expect(transport.operationIDs.filter { $0 == "post/chats/rooms/{id}/read" }.count == 2)
  }

  @Test func envelopeCreateDuringHistoryLoadRefetchesAfterResolve() async throws {
    let oldId = "550e8400-e29b-41d4-a716-446655440742"
    let newId = "550e8400-e29b-41d4-a716-446655440743"
    let (state, _, transport) = try realtimeState([
      (200, workspacesBody()),
      (200, realtimeUserBody),
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
    await state.reload()
    for _ in 0 ..< 1000 where !transport.operationIDs.contains("get/chats/rooms/{id}/messages") {
      await Task.yield()
    }
    #expect(state.openRoom.room.timeline.isLoading)
    state.applyRealtimeEnvelope(
      .init(eventType: .create, messageId: newId, roomId: roomA)
    )
    transport.releaseMessagesGET()
    await waitForRealtimeIdle(state)
    #expect(state.openRoom.room.timeline.messages.map(\.content) == ["old", "oversize body"])
    #expect(transport.operationIDs.filter { $0 == "get/chats/rooms/{id}/messages" }.count == 2)
  }

  @Test func failedSwitchDuringEnvelopeRefreshStillRefetches() async throws {
    let oldId = "550e8400-e29b-41d4-a716-446655440744"
    let newId = "550e8400-e29b-41d4-a716-446655440745"
    let laterId = "550e8400-e29b-41d4-a716-446655440746"
    let (state, _, transport) = try realtimeState([
      (200, workspacesBody()),
      (200, realtimeUserBody),
      (200, realtimeRoomsBody(ids: [roomA])),
      (200, realtimePageBody(messages: [realtimeMessageJSON(id: oldId, roomId: roomA, content: "old")])),
      (200, realtimeReadBody(id: roomA)),
      (500, """
      {"error":"Internal Server Error","message":"boom","meta":{"timestamp":"\(realtimeTimestamp)","requestId":"req-1","path":"/v1/users/me/workspaces/preferred","method":"PUT"}}
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
    await state.reload()
    await waitForRealtimeIdle(state)
    transport.pauseNextMessagesGET = true
    state.applyRealtimeEnvelope(
      .init(eventType: .create, messageId: newId, roomId: roomA)
    )
    for _ in 0 ..< 1000 where !state.openRoom.room.timeline.isRefreshing {
      await Task.yield()
    }
    let org = try #require(state.options.first { $0.id == "org_1" })
    await state.switchRooms(option: org)
    #expect(state.selectionId == "personal")
    #expect(state.switchError != nil)
    transport.releaseMessagesGET()
    await waitForRealtimeIdle(state)
    #expect(!state.openRoom.room.timeline.isRefreshing)
    state.applyRealtimeEnvelope(
      .init(eventType: .create, messageId: laterId, roomId: roomA)
    )
    await waitForRealtimeIdle(state)
    #expect(state.openRoom.room.timeline.messages.map(\.content) == ["old", "oversize", "later"])
    #expect(transport.operationIDs.filter { $0 == "get/chats/rooms/{id}/messages" }.count == 3)
  }

  @Test func envelopeDeleteDropsOnScreenRow() async throws {
    let targetId = "550e8400-e29b-41d4-a716-446655440719"
    let (state, _, _) = try realtimeState([
      (200, workspacesBody()),
      (200, realtimeUserBody),
      (200, realtimeRoomsBody(ids: [roomA])),
      (200, realtimePageBody(messages: [realtimeMessageJSON(id: targetId, roomId: roomA, content: "bye")])),
      (200, realtimeReadBody(id: roomA))
    ])
    await state.reload()
    await waitForRealtimeIdle(state)
    #expect(state.openRoom.displayedTranscript.map(\.id) == [targetId])
    state.applyRealtimeEnvelope(
      .init(eventType: .delete, messageId: targetId, roomId: roomA)
    )
    // Row 19a: state keeps the tombstone (patches still address it); the transcript drops it like web.
    #expect(state.openRoom.displayedTranscript.isEmpty)
    #expect(state.openRoom.room.timeline.messages.count == 1)
    #expect(state.openRoom.room.timeline.messages[0].content.isEmpty)
    #expect(state.openRoom.room.timeline.messages[0].deletedAt != nil)
  }

  @Test func revokeDropsOpenRoomAndUpdatesMembership() async throws {
    let fake = FakeRealtimeConnection()
    let (state, _, _) = try realtimeState([
      (200, workspacesBody()),
      (200, realtimeUserBody),
      (200, realtimeRoomsBody(ids: [roomA, roomB])),
      (200, realtimePageBody(messages: [realtimeMessageJSON(
        id: "550e8400-e29b-41d4-a716-446655440720",
        roomId: roomA,
        content: "in open room"
      )])),
      (200, realtimeReadBody(id: roomA))
    ], realtime: { fake })
    await state.reload()
    await waitForRealtimeIdle(state)
    #expect(state.selectedRoomId == roomA)

    state.applyMembershipRevoked(roomId: roomA)
    #expect(state.rooms.map(\.id) == [roomB])
    #expect(state.selectedRoomId == nil)
    #expect(state.transcriptRoomId == nil)
    #expect(state.openRoom.room.timeline.messages.isEmpty)
    #expect(fake.membershipRooms.last == [roomB])
  }

  /// `chat_rooms_changed` re-reads exactly the collections Core names (web `use-organization-chat-rooms.ts`, SOK-986):
  /// archive and restore name the list and Archived, an invitation names the invitations, a message the list.
  @Test func roomsChangedRereadsOnlyTheNamedCollections() async throws {
    let roomC = "550e8400-e29b-41d4-a716-446655440702"
    let fake = FakeRealtimeConnection()
    let envelope = { (data: String) in #"{"data":\#(data),"meta":{"timestamp":"\#(realtimeTimestamp)","requestId":"req-1"}}"# }
    let invitation = #"{"id":"inv-1","roomId":"\#(roomC)","roomName":"Partners","organizationId":"org_2","organizationName":"Acme Partners","email":"me@example.com","status":"pending","inviter":{"id":"host","name":"Hannah"},"expiresAt":"\#(realtimeTimestamp)","createdAt":"\#(realtimeTimestamp)"}"#
    let (state, _, transport) = try realtimeState([
      (200, workspacesBody(preferring: "org_1")), (200, realtimeUserBody),
      (200, realtimeRoomsBody(ids: [roomA])),
      (200, realtimePageBody(messages: [])), (200, realtimeReadBody(id: roomA)),
      (200, envelope(#"{"id":"member-me","userId":"user_1","organizationId":"org_1","role":"owner","seatAssignedAt":null,"createdAt":"\#(realtimeTimestamp)"}"#)),
      (200, realtimeRoomsBody(ids: [roomB])),
      (200, envelope("[\(invitation)]")),
      (200, realtimeRoomsBody(ids: [roomA, roomC]))
    ], realtime: { fake })
    await state.reload()
    await waitForRealtimeIdle(state)
    let loaded = transport.operationIDs.count

    fake.deliver(.roomsChanged([.archived]))
    for _ in 0 ..< 1000 where state.archivedChannels.rooms.isEmpty {
      await Task.yield()
    }
    #expect(state.archivedChannels.rooms.map(\.id) == [roomB] && state.archivedChannels.canDelete)
    #expect(transport.operationIDs[loaded...] == ["get/users/{id}/organizations/{organizationId}/member", "get/chats/rooms"])
    #expect(transport.requests.last?.path?.contains("status=archived") == true)

    fake.deliver(.roomsChanged([.invitations]))
    for _ in 0 ..< 1000 where state.pendingInvitations.invitations.isEmpty {
      await Task.yield()
    }
    #expect(state.pendingInvitations.invitations.map(\.id) == ["inv-1"])
    #expect(transport.operationIDs.last == "get/chats/invitations")

    fake.deliver(.roomsChanged([.active]))
    for _ in 0 ..< 1000 where state.rooms.count == 1 {
      await Task.yield()
    }
    await waitForRealtimeIdle(state)
    #expect(state.rooms.map(\.id) == [roomA, roomC])
    #expect(state.archivedChannels.rooms.map(\.id) == [roomB] && state.pendingInvitations.invitations.map(\.id) == ["inv-1"])
    #expect(transport.operationIDs.count == loaded + 4)
    state.reset()
  }

  /// The sidebar loads Archived and the invitations once per workspace. A list refresh used to restart that load, so
  /// every message re-read both; now each collection recovers on its own and only a workspace change reloads them.
  @Test func collectionsLoadContextSurvivesAListRefresh() async throws {
    let (state, _, transport) = try realtimeState([
      (200, workspacesBody()), (200, realtimeUserBody),
      (200, realtimeRoomsBody(ids: [roomA])),
      (200, realtimePageBody(messages: [])), (200, realtimeReadBody(id: roomA)),
      (200, realtimeRoomsBody(ids: [roomA, roomB])),
      (200, preferredWorkspaceBody(preferring: "org_1")),
      (200, realtimeRoomsBody(ids: [roomB])),
      (200, realtimePageBody(messages: [])), (200, realtimeReadBody(id: roomB))
    ])
    await state.reload()
    await waitForRealtimeIdle(state)
    let personal = try #require(state.collectionsLoadContext)

    transport.pauseNextRoomsGET = true
    let refresh = Task { await state.refreshRooms() }
    await transport.waitForRoomsGET()
    #expect(state.roomsLoading)
    #expect(state.collectionsLoadContext == personal)
    transport.releaseRoomsGET()
    await refresh.value
    #expect(state.rooms.map(\.id) == [roomA, roomB])
    #expect(state.collectionsLoadContext == personal)

    let org = try #require(state.options.first { $0.id == "org_1" })
    await state.switchRooms(option: org)
    await waitForRealtimeIdle(state)
    let organization = try #require(state.collectionsLoadContext)
    #expect(organization != personal && organization == state.compositionContext)
    state.reset()
  }

  /// A personal workspace has no Archived section: web runs no reader for it, so its invalidation reads nothing.
  @Test func personalWorkspaceIgnoresArchivedInvalidation() async throws {
    let fake = FakeRealtimeConnection()
    let (state, _, transport) = try realtimeState([
      (200, workspacesBody()), (200, realtimeUserBody),
      (200, realtimeRoomsBody(ids: [roomA])),
      (200, realtimePageBody(messages: [])), (200, realtimeReadBody(id: roomA)),
      (200, #"{"data":[],"meta":{"timestamp":"2026-01-01T00:00:00.000Z","requestId":"req-1"}}"#)
    ], realtime: { fake })
    await state.reload()
    await waitForRealtimeIdle(state)
    let loaded = transport.operationIDs.count

    fake.deliver(.roomsChanged([.archived, .invitations]))
    for _ in 0 ..< 1000 where transport.operationIDs.count == loaded {
      await Task.yield()
    }
    await waitForRealtimeIdle(state)
    #expect(transport.operationIDs[loaded...] == ["get/chats/invitations"])
    state.reset()
  }

  @Test func windowVisibilityDrivesNotificationPresence() async throws {
    let fake = FakeRealtimeConnection()
    let (state, _, _) = try realtimeState([
      (200, workspacesBody()),
      (200, realtimeUserBody),
      (200, realtimeRoomsBody(ids: [roomA])),
      (200, realtimePageBody(messages: [])),
      (200, realtimeReadBody(id: roomA))
    ], realtime: { fake })
    await state.reload()
    await waitForRealtimeIdle(state)
    // The window was visible before the socket existed, so the connection is
    // told at connect rather than waiting for the next change.
    #expect(fake.inFront == [true])

    state.setWindowVisible(false, window: realtimeWindow)
    #expect(fake.inFront == [true, false])
    state.setWindowVisible(true, window: realtimeWindow)
    #expect(fake.inFront == [true, false, true])
    state.reset()
  }

  @Test func pendingSidebarResponseCannotRestoreRevokedRoom() async throws {
    let (state, _, transport) = try realtimeState([
      (200, workspacesBody()), (200, realtimeUserBody),
      (200, realtimeRoomsBody(ids: [roomA])),
      (200, realtimePageBody(messages: [])),
      (200, realtimeReadBody(id: roomA)),
      (200, realtimeRoomsBody(ids: [roomA]))
    ])
    await state.reload()
    await waitForRealtimeIdle(state)
    transport.pauseNextRoomsGET = true
    let refresh = Task { await state.refreshRooms() }
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
    let (state, _, transport) = try realtimeState([
      (200, workspacesBody()), (200, realtimeUserBody),
      (200, realtimeRoomsBody(ids: [roomA])),
      (200, realtimePageBody(messages: [])),
      (200, realtimeReadBody(id: roomA)),
      (200, preferredWorkspaceBody(preferring: "org_1")),
      (200, realtimeRoomsBody(ids: [roomB]))
    ], realtime: { fake })
    await state.reload()
    await waitForRealtimeIdle(state)
    let org = try #require(state.options.first { $0.id == "org_1" })
    transport.pauseNextRoomsGET = true
    let switching = Task { await state.switchRooms(option: org) }
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

  /// Row 07d: lost continuity on the open room re-reads it while no chat window is active (web `handleContinuityLost`
  /// is an explicit request), without marking it read; the return finds nothing stale.
  @Test func continuityLossReadsWhileHiddenAndIgnoresOtherRooms() async throws {
    let fake = FakeRealtimeConnection()
    let (state, _, transport) = try realtimeState([
      (200, workspacesBody()), (200, realtimeUserBody),
      (200, realtimeRoomsBody(ids: [roomA])),
      (200, realtimePageBody(messages: [])), (200, realtimeReadBody(id: roomA)),
      (200, realtimePageBody(messages: [])), (200, realtimePageBody(messages: []))
    ], realtime: { fake })
    await state.reload()
    await waitForRealtimeIdle(state)
    let initialRequests = transport.operationIDs.count
    let initialAttention = state.openRoom.threadAttentionRevision
    fake.deliver(.roomHealth(roomId: roomB, healthy: false, continuityLost: true))
    fake.deliver(.roomHealth(roomId: roomA, healthy: true, continuityLost: false))
    // A following pin is a visible barrier for the ordered event stream.
    fake.deliver(.pin(roomId: roomA, messageId: "barrier", isPinned: true, count: 1))
    for _ in 0 ..< 1000 where state.openRoom.room.timeline.pinOverrides["barrier"] != true {
      await Task.yield()
    }
    #expect(state.openRoom.room.timeline.pinOverrides["barrier"] == true)
    #expect(state.openRoom.threadAttentionRevision == initialAttention)
    await waitForRealtimeIdle(state)
    #expect(transport.operationIDs.count == initialRequests)
    state.setWindowVisible(false, window: realtimeWindow)
    fake.deliver(.roomHealth(roomId: roomA, healthy: false, continuityLost: true))
    fake.deliver(.roomHealth(roomId: roomA, healthy: true, continuityLost: true))
    fake.deliver(.pin(roomId: roomA, messageId: "barrier", isPinned: false, count: 0))
    for _ in 0 ..< 1000 where state.openRoom.room.timeline.pinOverrides["barrier"] != false {
      await Task.yield()
    }
    #expect(state.openRoom.room.timeline.pinOverrides["barrier"] == false)
    #expect(state.openRoom.threadAttentionRevision == initialAttention + 2)
    await waitForRealtimeIdle(state)
    #expect(transport.operationIDs.filter { $0 == "get/chats/rooms/{id}/messages" }.count == 3)
    #expect(transport.operationIDs.filter { $0 == "post/chats/rooms/{id}/read" }.count == 1)
    state.setWindowVisible(true, window: realtimeWindow)
    await waitForRealtimeIdle(state)
    #expect(transport.operationIDs.filter { $0 == "get/chats/rooms/{id}/messages" }.count == 3)
  }

  @Test func revokeKeepsUnrelatedRoomTranscript() async throws {
    let (state, _, transport) = try realtimeState([
      (200, workspacesBody()),
      (200, realtimeUserBody),
      (200, realtimeRoomsBody(ids: [roomA, roomB])),
      (200, realtimePageBody(messages: [realtimeMessageJSON(
        id: "550e8400-e29b-41d4-a716-446655440721",
        roomId: roomA,
        content: "stays"
      )])),
      (200, realtimeReadBody(id: roomA))
    ])
    await state.reload()
    await waitForRealtimeIdle(state)
    state.applyMembershipRevoked(roomId: roomB)
    #expect(state.rooms.map(\.id) == [roomA])
    #expect(state.selectedRoomId == roomA)
    #expect(state.openRoom.room.timeline.messages.map(\.content) == ["stays"])
    // No token minted yet: revoke alone never pays for one.
    #expect(!transport.operationIDs.contains("post/realtime/ably-token"))
  }

  @Test func liveArrivalDuringHistoryLoadSurvivesResolve() async throws {
    let firstId = "550e8400-e29b-41d4-a716-446655440740"
    let liveId = "550e8400-e29b-41d4-a716-446655440741"
    let (state, _, _) = try realtimeState([
      (200, workspacesBody()),
      (200, realtimeUserBody),
      (200, realtimeRoomsBody(ids: [roomA])),
      (200, realtimePageBody(messages: [realtimeMessageJSON(id: firstId, roomId: roomA, content: "first")])),
      (200, realtimeReadBody(id: roomA)),
      // Reopen re-reads history.
      (200, realtimePageBody(messages: [realtimeMessageJSON(id: firstId, roomId: roomA, content: "first")])),
      (200, realtimeReadBody(id: roomA))
    ])
    await state.reload()
    await waitForRealtimeIdle(state)
    let live = try await decodeRealtimeMessages([
      realtimeMessageJSON(id: liveId, roomId: roomA, content: "in flight", createdAt: "2026-01-01T00:00:01.000Z")
    ])
    let room = try #require(state.rooms.first)
    state.enterRoom(room)
    // The load task has not run yet: this live row lands first, and the
    // resolving history GET must merge around it, not wipe it.
    state.applyRealtimeMessage(roomId: roomA, eventType: .create, message: live[0])
    await waitForRealtimeIdle(state)
    #expect(state.openRoom.displayedTranscript.map(\.content) == ["first", "in flight"])
  }

  @Test func instanceIdIsStableAcrossStates() {
    let store = MemoryRealtimeClientInstanceIdStore()
    let first = WorkspaceState(auth: signedOutAuth(), instanceStore: store)
    let second = WorkspaceState(auth: signedOutAuth(), instanceStore: store)
    #expect(first.realtimeClientInstanceId == second.realtimeClientInstanceId)
    #expect(first.realtimeClientInstanceId.count == 16)
  }

  @Test func tokenMintUsesInstanceIdAndPersonalOmitsOrgHeader() async throws {
    let fake = FakeRealtimeConnection()
    let (state, _, transport) = try realtimeState(
      [
        (200, workspacesBody()),
        (200, realtimeUserBody),
        (200, realtimeRoomsBody(ids: [roomA])),
        (200, realtimePageBody(messages: [])),
        (200, realtimeReadBody(id: roomA)),
        (200, realtimeTokenBody())
      ],
      instanceId: "inst_personal0001",
      realtime: { fake }
    )
    await state.reload()
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

  /// Another member's message over the socket changes what the reader sees, so the open room is read again; the
  /// read runs beside the event loop and the next event never waits on it.
  @Test func aLiveMessageReadsTheOpenRoom() async throws {
    let firstId = "550e8400-e29b-41d4-a716-446655440740"
    let fake = FakeRealtimeConnection()
    let (state, _, transport) = try realtimeState([
      (200, workspacesBody()),
      (200, realtimeUserBody),
      (200, realtimeRoomsBody(ids: [roomA])),
      (200, realtimePageBody(messages: [realtimeMessageJSON(id: firstId, roomId: roomA, content: "first")])),
      (200, realtimeReadBody(id: roomA)),
      (200, realtimeTokenBody()),
      (200, realtimeReadBody(id: roomA))
    ], realtime: { fake })
    await state.reload()
    await waitForRealtimeIdle(state)
    let reads = transport.operationIDs.filter { $0 == "post/chats/rooms/{id}/read" }.count
    // A sidebar refresh counted something unread meanwhile.
    state.rooms[0].unreadCount = 2
    let live = try await decodeRealtimeMessages([
      realtimeMessageJSON(id: "550e8400-e29b-41d4-a716-446655440741", roomId: roomA, content: "over the wire",
                          createdAt: "2026-01-01T00:00:01.000Z")
    ])
    fake.deliver(.message(roomId: roomA, eventType: .create, message: live[0]))
    for _ in 0 ..< 1000 where state.realtimeReadSync == nil {
      await Task.yield()
    }
    await state.realtimeReadSync?.value
    #expect(transport.operationIDs.filter { $0 == "post/chats/rooms/{id}/read" }.count == reads + 1)
    #expect(state.rooms.first?.unreadCount == 0)
  }

  /// SOK-1484: scrolled up, a live message stays unread, as does the scene coming back to the foreground; reaching
  /// the end reads it.
  @Test func aLiveMessageWhileScrolledUpWaitsForTheEnd() async throws {
    let fake = FakeRealtimeConnection()
    let (state, _, transport) = try realtimeState([
      (200, workspacesBody()),
      (200, realtimeUserBody),
      (200, realtimeRoomsBody(ids: [roomA])),
      (200, realtimePageBody(messages: [realtimeMessageJSON(id: "550e8400-e29b-41d4-a716-446655440750", roomId: roomA, content: "first")])),
      (200, realtimeReadBody(id: roomA)),
      (200, realtimeTokenBody()),
      (200, realtimeReadBody(id: roomA))
    ], realtime: { fake })
    await state.reload()
    await waitForRealtimeIdle(state)
    let reads = { transport.operationIDs.filter { $0 == "post/chats/rooms/{id}/read" }.count }
    let opened = reads()
    await state.openRoom.setAtEnd(false, roomId: roomA)
    let live = try await decodeRealtimeMessages([
      realtimeMessageJSON(id: "550e8400-e29b-41d4-a716-446655440751", roomId: roomA, content: "over the wire",
                          createdAt: "2026-01-01T00:00:01.000Z")
    ])
    fake.deliver(.message(roomId: roomA, eventType: .create, message: live[0]))
    for _ in 0 ..< 1000 where state.realtimeReadSync == nil {
      await Task.yield()
    }
    await state.realtimeReadSync?.value
    await state.syncReadAttention()
    #expect(reads() == opened, "Away from the end the arrival stays unread.")
    await state.openRoom.setAtEnd(true, roomId: roomA)
    #expect(reads() == opened + 1, "Reaching the end reads it.")
  }

  /// Events arriving while a read is in flight queue exactly one more read after it, however many there are.
  @Test func eventsDuringAReadQueueOneMoreRead() async throws {
    let fake = FakeRealtimeConnection()
    let (state, _, transport) = try realtimeState([
      (200, workspacesBody()),
      (200, realtimeUserBody),
      (200, realtimeRoomsBody(ids: [roomA])),
      (200, realtimePageBody(messages: [realtimeMessageJSON(id: "550e8400-e29b-41d4-a716-446655440750", roomId: roomA, content: "first")])),
      (200, realtimeReadBody(id: roomA)),
      (200, realtimeTokenBody()),
      (200, realtimeReadBody(id: roomA))
    ], realtime: { fake })
    await state.reload()
    await waitForRealtimeIdle(state)
    let reads = transport.operationIDs.filter { $0 == "post/chats/rooms/{id}/read" }.count
    state.rooms[0].unreadCount = 2
    transport.pauseNextRead = true
    let live = try await decodeRealtimeMessages((1 ... 3).map { index in
      realtimeMessageJSON(id: "550e8400-e29b-41d4-a716-44665544076\(index)", roomId: roomA, content: "live \(index)",
                          createdAt: "2026-01-01T00:00:0\(index).000Z")
    })
    fake.deliver(.message(roomId: roomA, eventType: .create, message: live[0]))
    // The read is on the wire (recorded before it pauses), so its sync is past the point where it can take more.
    for _ in 0 ..< 1000 where transport.operationIDs.filter({ $0 == "post/chats/rooms/{id}/read" }).count == reads {
      await Task.yield()
    }
    let inFlight = try #require(state.realtimeReadSync)
    fake.deliver(.message(roomId: roomA, eventType: .create, message: live[1]))
    for _ in 0 ..< 1000 where state.realtimeReadSync == inFlight {
      await Task.yield()
    }
    let queued = try #require(state.realtimeReadSync)
    #expect(queued != inFlight, "An event during the read queues one more.")
    fake.deliver(.message(roomId: roomA, eventType: .create, message: live[2]))
    for _ in 0 ..< 1000 where state.openRoom.displayedTranscript.count < 4 {
      await Task.yield()
    }
    #expect(state.realtimeReadSync == queued, "A further event joins the queued read.")
    transport.releaseRead()
    await queued.value
    // Two reads in all: the one in flight, and one covering both messages that arrived during it.
    #expect(transport.operationIDs.filter { $0 == "post/chats/rooms/{id}/read" }.count == reads + 2)
  }

  @Test func liveSocketConnectsWatchesOpenRoomAndDelivers() async throws {
    let firstId = "550e8400-e29b-41d4-a716-446655440730"
    let liveId = "550e8400-e29b-41d4-a716-446655440731"
    let fake = FakeRealtimeConnection()
    let (state, _, _) = try realtimeState([
      (200, workspacesBody()),
      (200, realtimeUserBody),
      (200, realtimeRoomsBody(ids: [roomA])),
      (200, realtimePageBody(messages: [realtimeMessageJSON(id: firstId, roomId: roomA, content: "first")])),
      (200, realtimeReadBody(id: roomA)),
      (200, realtimeTokenBody())
    ], realtime: { fake })
    await state.reload()
    await waitForRealtimeIdle(state)

    #expect(fake.connectCount == 1)
    #expect(fake.connectedUserId == "user_1" && fake.connectedSlug == nil)
    #expect(fake.watchedRooms == [roomA] && fake.membershipRooms == [[roomA]])

    let live = try await decodeRealtimeMessages([
      realtimeMessageJSON(id: liveId, roomId: roomA, content: "over the wire", createdAt: "2026-01-01T00:00:01.000Z")
    ])
    fake.deliver(.message(roomId: roomA, eventType: .create, message: live[0]))
    for _ in 0 ..< 1000 where state.openRoom.displayedTranscript.map(\.content) != ["first", "over the wire"] {
      await Task.yield()
    }
    #expect(state.openRoom.displayedTranscript.map(\.content) == ["first", "over the wire"])

    fake.deliver(.pin(roomId: roomA, messageId: liveId, isPinned: true, count: 1))
    for _ in 0 ..< 1000 where state.openRoom.room.timeline.pinOverrides[liveId] != true {
      await Task.yield()
    }
    #expect(state.openRoom.room.timeline.pinOverrides[liveId] == true)
    #expect(state.rooms.first?.pinnedMessageCount == 1)
    fake.deliver(.pin(roomId: roomA, messageId: liveId, isPinned: false, count: 0))
    for _ in 0 ..< 1000 where state.openRoom.room.timeline.pinOverrides[liveId] != false {
      await Task.yield()
    }
    #expect(state.openRoom.room.timeline.pinOverrides[liveId] == false)
    #expect(state.rooms.first?.pinnedMessageCount == 0)

    fake.deliver(.revoked(roomId: roomA))
    for _ in 0 ..< 1000 where !state.rooms.isEmpty {
      await Task.yield()
    }
    #expect(state.rooms.isEmpty)
    #expect(state.selectedRoomId == nil)
    #expect(state.transcriptRoomId == nil)
    #expect(fake.watchedRooms == [roomA, nil])
    #expect(state.openRoom.room.timeline.pinOverrides.isEmpty)

    state.reset()
    #expect(fake.disconnectCount == 1)
  }

  @Test func workspaceSwitchRetargetsSlugReauthorizesAndRewatches() async throws {
    let fake = FakeRealtimeConnection()
    let (state, _, _) = try realtimeState([
      (200, workspacesBody()),
      (200, realtimeUserBody),
      (200, realtimeRoomsBody(ids: [roomA])),
      (200, realtimePageBody(messages: [])),
      (200, realtimeReadBody(id: roomA)),
      (200, preferredWorkspaceBody(preferring: "org_1")),
      (200, realtimeRoomsBody(ids: [roomB])),
      (200, realtimePageBody(messages: [])),
      (200, realtimeReadBody(id: roomB))
    ], realtime: { fake })
    await state.reload()
    await waitForRealtimeIdle(state)
    #expect(fake.watchedRooms == [roomA])

    let org = try #require(state.options.first { $0.id == "org_1" })
    await state.switchRooms(option: org)
    await waitForRealtimeIdle(state)

    #expect(state.selectionId == "org_1")
    #expect(fake.slugs == ["acme"])
    #expect(fake.connectedSlug == nil)
    #expect(fake.membershipRooms.last == [roomB])
    #expect(fake.watchedRooms == [roomA, nil, roomB])
    #expect(state.selectedRoomId == roomB)
  }

  @Test func orgPresenceFollowsTheActiveOrganization() async throws {
    let fake = FakeRealtimeConnection()
    let (state, _, _) = try realtimeState([
      (200, workspacesBody()), (200, realtimeUserBody),
      (200, realtimeRoomsBody(ids: [roomA])),
      (200, realtimePageBody(messages: [])), (200, realtimeReadBody(id: roomA)),
      (200, preferredWorkspaceBody(preferring: "org_1")),
      (200, realtimeRoomsBody(ids: [])),
      (200, preferredWorkspaceBody()),
      (200, realtimeRoomsBody(ids: []))
    ], realtime: { fake })
    await state.reload()
    await waitForRealtimeIdle(state)
    // Personal workspace: nothing to enter, nothing to publish, DTO fallback wins.
    #expect(fake.presenceOrganizations.isEmpty)
    #expect(fake.publishedPresence.isEmpty)
    #expect(state.presence(forUser: "alice", fallback: .afk) == .afk)

    let org = try #require(state.options.first { $0.id == "org_1" })
    await state.switchRooms(option: org)
    await waitForRealtimeIdle(state)
    #expect(fake.presenceOrganizations == ["org_1"])
    #expect(fake.publishedPresence.count == 1)
    #expect(fake.publishedPresence.last?.visible == true)

    let alice = ChatPresenceMember(clientId: "alice:inst_00000001", data: ChatPresenceMemberData(lastActiveAt: Date(), visible: true))
    let bob = ChatPresenceMember(clientId: "bob:inst_00000001", data: ChatPresenceMemberData(lastActiveAt: Date(), visible: false))
    fake.deliver(.presenceRoster(organizationId: "org_2", members: [alice]))
    fake.deliver(.presenceRoster(organizationId: "org_1", members: [alice, bob]))
    for _ in 0 ..< 1000 where state.presence.byUserId.isEmpty {
      await Task.yield()
    }
    #expect(state.presence(forUser: "alice", fallback: .offline) == .online)
    #expect(state.presence(forUser: "bob", fallback: .offline) == .afk)
    #expect(state.presence(forUser: "carol", fallback: .offline) == .offline)
    let human = try #require(ChatParticipantProfile(sender: .case1(.init(_type: .user, user: .init(id: "carol", name: "Carol", email: "carol@example.com", presence: .afk)))))
    #expect(state.presence(for: human) == .afk)
    let coworker = try #require(ChatParticipantProfile(sender: .case2(.init(_type: .coworker, coworker: .init(id: "cw", name: "Helper", slug: "helper", presence: .offline)))))
    #expect(state.presence(for: coworker) == .online)

    let personal = try #require(state.options.first { $0.workspace == .personal })
    await state.switchRooms(option: personal)
    await waitForRealtimeIdle(state)
    #expect(fake.presenceOrganizations == ["org_1", nil])
    #expect(state.presence.byUserId.isEmpty)
    #expect(fake.publishedPresence.count == 1)
  }

  @Test func presencePublishesOnVisibilityAndThrottlesActivity() async throws {
    let fake = FakeRealtimeConnection()
    let (state, _, _) = try realtimeState([
      (200, workspacesBody(preferring: "org_1")), (200, realtimeUserBody),
      (200, realtimeRoomsBody(ids: []))
    ], realtime: { fake })
    await state.reload()
    await waitForRealtimeIdle(state)
    #expect(fake.presenceOrganizations == ["org_1"])
    #expect(fake.publishedPresence.count == 1)

    state.recordPresenceActivity()
    state.recordPresenceActivity()
    #expect(fake.publishedPresence.count == 1)
    #expect(state.presence.selfPresence == .online)

    state.setWindowVisible(false, window: realtimeWindow)
    #expect(fake.publishedPresence.count == 2)
    #expect(fake.publishedPresence.last?.visible == false)
    #expect(state.presence.selfPresence == .afk)
    state.setWindowVisible(false, window: UUID())
    #expect(fake.publishedPresence.count == 2)
    state.setWindowVisible(true, window: realtimeWindow)
    #expect(fake.publishedPresence.count == 3)
    #expect(fake.publishedPresence.last?.visible == true)
    #expect(state.presence.selfPresence == .online)

    // Self reads offline only after the socket was up once.
    fake.deliver(.connectionHealth(healthy: false))
    fake.deliver(.connectionHealth(healthy: true))
    fake.deliver(.connectionHealth(healthy: false))
    // A following roster is a visible barrier for the ordered event stream.
    fake.deliver(.presenceRoster(organizationId: "org_1", members: [.init(clientId: "alice:inst_00000001", data: nil)]))
    for _ in 0 ..< 1000 where state.presence.byUserId.isEmpty {
      await Task.yield()
    }
    #expect(state.presence.selfPresence == .offline)

    state.reset()
    #expect(fake.disconnectCount == 1)
    #expect(state.presence.organizationId == nil)
    #expect(state.presence.selfPresence == .online)
    #expect(fake.publishedPresence.count == 3)
  }

  @Test func notificationBannersFollowFocusPermissionAndReads() async throws {
    let fake = FakeRealtimeConnection()
    let presenter = FakeNotificationPresenter()
    let (state, _, _) = try realtimeState(notificationLoadScript, realtime: { fake }, presenter: presenter)
    await state.reload()
    await waitForRealtimeIdle(state)
    let arrival = ChatNotificationEvent(id: "n1", roomId: roomB, messageKey: "Notifications.Chat.mentioned", authorName: "Ada", roomName: "design",
                                        createdAt: Date(timeIntervalSince1970: 100))
    // Frontmost with an active chat window is web's focused tab: no banner.
    state.applyRealtimeNotification(arrival)
    #expect(presenter.shown.isEmpty)
    // Frontmost without an active chat window (Settings is key) and a background app both count as unfocused.
    state.setWindowVisible(false, window: realtimeWindow)
    state.applyRealtimeNotification(arrival)
    presenter.isAppActive = false
    state.setWindowVisible(true, window: realtimeWindow)
    var second = arrival
    second.groupCount = 2
    // The socket path: the transport resolves the delivery and the stream applies it.
    fake.deliver(.notification(second))
    while presenter.shown.count < 2 {
      await Task.yield()
    }
    #expect(presenter.shown.map(\.identifier) == ["sokosumi-room:\(roomB)", "sokosumi-room:\(roomB)"])
    #expect(presenter.shown[1].title == "Sokosumi" && presenter.shown[1].body == "2 messages in channel design")
    presenter.authorization = .denied
    state.applyRealtimeNotification(arrival)
    #expect(presenter.shown.count == 2)
    // Read elsewhere: the banner comes down whatever the gates say.
    var read = second
    read.isRead = true
    read.osBanner = false
    state.applyRealtimeNotification(read)
    #expect(presenter.dismissed == ["sokosumi-room:\(roomB)"])
    state.reset()
    #expect(presenter.dismissAllCount == 1)
  }

  @Test func openingANotificationNavigatesEvenWhenMarkReadFails() async throws {
    let presenter = FakeNotificationPresenter()
    let (state, _, transport) = try realtimeState(notificationLoadScript + [
      (500, realtimeErrorBody),
      (200, realtimePageBody(messages: [])), (200, realtimeReadBody(id: roomB))
    ], presenter: presenter)
    await state.reload()
    await waitForRealtimeIdle(state)
    #expect(state.selectedRoomId == roomA)
    let result = try await state.openNotification(.init(id: "n1", roomId: roomB))
    await waitForRealtimeIdle(state)
    #expect(result == .opened && state.selectedRoomId == roomB && state.transcriptRoomId == roomB)
    #expect(presenter.dismissed == ["sokosumi-room:\(roomB)"])
    #expect(transport.operationIDs.contains("patch/notifications/{id}/read"))
    #expect(transport.requests.contains { $0.path == "/notifications/n1/read" })
  }

  @Test func openingANotificationDismissesEvenWhenUnavailable() async throws {
    let presenter = FakeNotificationPresenter()
    let (state, _, _) = try realtimeState(notificationLoadScript, presenter: presenter)
    let result = try await state.openNotification(.init(id: "n1", roomId: roomB))
    #expect(result == .unavailable && presenter.dismissed == ["sokosumi-room:\(roomB)"])
  }

  @Test func openingANotificationSwitchesToItsWorkspace() async throws {
    let (state, _, transport) = try realtimeState(notificationLoadScript + [
      (200, realtimeReadBody(id: roomA)),
      (200, preferredWorkspaceBody(preferring: "org_1")),
      (200, preferredWorkspaceBody(preferring: "org_1")),
      (200, realtimeRoomsBody(ids: ["550e8400-e29b-41d4-a716-446655440702"])),
      (200, realtimePageBody(messages: [])), (200, realtimeReadBody(id: "550e8400-e29b-41d4-a716-446655440702"))
    ])
    await state.reload()
    await waitForRealtimeIdle(state)
    let orgRoom = "550e8400-e29b-41d4-a716-446655440702"
    let result = try await state.openNotification(.init(id: "n2", roomId: orgRoom, workspaceId: "11111111-1111-7111-8111-111111111111"))
    await waitForRealtimeIdle(state)
    #expect(result == .opened && state.selectionId == "org_1" && state.selectedRoomId == orgRoom)
    let operations = transport.operationIDs
    let read = try #require(operations.firstIndex(of: "patch/notifications/{id}/read"))
    let lookup = try #require(operations.firstIndex(of: "get/workspaces/{id}"))
    #expect(read < lookup)
  }

  /// A room-list read that started before the notification's room was joined cannot list it; opening waits that read
  /// out and reads again.
  @Test func openingANotificationRereadsPastARoomListAlreadyInFlight() async throws {
    let (state, _, transport) = try realtimeState([
      (200, workspacesBody()), (200, realtimeUserBody),
      (200, realtimeRoomsBody(ids: [roomA])),
      (200, realtimePageBody(messages: [])), (200, realtimeReadBody(id: roomA)),
      (200, realtimeRoomsBody(ids: [roomA])),
      (500, realtimeErrorBody),
      (200, realtimeRoomsBody(ids: [roomA, roomB])),
      (200, realtimePageBody(messages: [])), (200, realtimeReadBody(id: roomB))
    ])
    await state.reload()
    await waitForRealtimeIdle(state)
    let opening = try await whileARoomListReadIsInFlight(state, transport, until: "patch/notifications/{id}/read") {
      try await state.openNotification(.init(id: "n1", roomId: roomB))
    }
    await waitForRealtimeIdle(state)
    #expect(opening == .opened && state.selectedRoomId == roomB)
    #expect(transport.operationIDs.filter { $0 == "get/chats/rooms" }.count == 3)
    state.reset()
  }

  /// The Self Direct Send to yourself just created is not in a room-list read that started before it.
  @Test func sendToSelfRereadsPastARoomListAlreadyInFlight() async throws {
    let source = try #require(await decodeRealtimeMessages([realtimeMessageJSON(id: "source", roomId: roomA, content: "Keep")]).first)
    let (state, _, transport) = try realtimeState([
      (200, workspacesBody()), (200, realtimeUserBody),
      (200, realtimeRoomsBody(ids: [roomA])),
      (200, realtimePageBody(messages: [])), (200, realtimeReadBody(id: roomA)),
      (200, realtimeRoomsBody(ids: [roomA])),
      (201, realtimeCreatedBody(id: "saved", roomId: roomB, content: "")),
      (200, realtimeRoomsBody(ids: [roomA, roomB]))
    ])
    await state.reload()
    await waitForRealtimeIdle(state)
    let saved = try await whileARoomListReadIsInFlight(state, transport, until: "post/chats/rooms/{id}/messages/{messageId}/send-to-self") {
      try await state.sendMessageToSelf(source)
    }
    #expect(saved.roomId == roomB)
    #expect(state.rooms.map(\.id) == [roomA, roomB])
    #expect(state.selectedRoomId == roomA)
    state.reset()
  }

  /// Row 36a, ADR 0033: the room composer announces on the open room's typing channel, throttled,
  /// and stops on send, on blur and on leaving, in that order on the wire.
  @Test func typingAnnouncesFromTheOpenRoomAndStopsOnSendBlurAndLeaving() async throws {
    let fake = FakeRealtimeConnection()
    let (state, _, _) = try realtimeState(notificationLoadScript + [
      (201, realtimeCreatedBody(id: "550e8400-e29b-41d4-a716-446655440740", roomId: roomA, content: "hello")),
      (200, realtimePageBody(messages: [])), (200, realtimeReadBody(id: roomB))
    ], realtime: { fake })
    await state.reload()
    await waitForRealtimeIdle(state)
    #expect(fake.typingLog == ["watch \(roomA)"])
    #expect(state.typing.roomId == roomA)

    // Before the channel answers, an edit reaches nobody and opens no throttle window.
    state.composerEdited(roomId: roomA, hasText: true, now: typingOrigin)
    #expect(fake.typingLog == ["watch \(roomA)"])
    state.applyTypingChannel(roomId: roomA, canPublish: true)
    state.composerEdited(roomId: roomA, hasText: true, now: typingOrigin.addingTimeInterval(1))
    state.composerEdited(roomId: roomA, hasText: true, now: typingOrigin.addingTimeInterval(5))
    // Only the open room's composer announces.
    state.composerEdited(roomId: roomB, hasText: true, now: typingOrigin.addingTimeInterval(6))
    state.composerEdited(roomId: roomA, hasText: true, now: typingOrigin.addingTimeInterval(11))
    #expect(fake.typingLog == ["watch \(roomA)", "started \(roomA)", "started \(roomA)"])

    state.composerEdited(roomId: roomA, hasText: false, now: typingOrigin.addingTimeInterval(12))
    state.composerStoppedTyping(roomId: roomA)
    #expect(fake.typingLog.suffix(1) == ["stopped \(roomA)"] && fake.typingLog.count == 4)

    state.composerEdited(roomId: roomA, hasText: true, now: typingOrigin.addingTimeInterval(13))
    state.composerStoppedTyping(roomId: roomB)
    state.composerStoppedTyping(roomId: roomA)
    state.composerStoppedTyping(roomId: roomA)
    #expect(fake.typingLog.suffix(2) == ["started \(roomA)", "stopped \(roomA)"] && fake.typingLog.count == 6)

    state.composerEdited(roomId: roomA, hasText: true, now: typingOrigin.addingTimeInterval(14))
    #expect(state.sendMessage("hello"))
    await waitForRealtimeIdle(state)
    #expect(fake.typingLog.suffix(2) == ["started \(roomA)", "stopped \(roomA)"] && fake.typingLog.count == 8)

    // Leaving tells the room before its channel goes; the next room starts unannounced.
    state.composerEdited(roomId: roomA, hasText: true, now: typingOrigin.addingTimeInterval(15))
    state.selectRoom(roomB)
    await waitForRealtimeIdle(state)
    #expect(fake.typingLog.suffix(3) == ["started \(roomA)", "stopped \(roomA)", "watch \(roomB)"])
    state.composerEdited(roomId: roomB, hasText: true, now: typingOrigin.addingTimeInterval(16))
    state.applyTypingChannel(roomId: roomB, canPublish: true)
    state.composerEdited(roomId: roomB, hasText: true, now: typingOrigin.addingTimeInterval(17))
    state.reset()
    #expect(fake.typingLog.suffix(3) == ["started \(roomB)", "stopped \(roomB)", "disconnect"])
    #expect(state.typing.roomId == nil)
  }

  @Test func aDelayedTypingSweepDropsEveryExpiredTypist() async throws {
    let (state, _, _) = try realtimeState([])
    state.watchRoom(roomA)
    // Simulate a paused reader: its scheduled deadline and both heartbeats are already
    // in the past when the task wakes. The first deadline is one second after the
    // second heartbeat, so this exercises the timer without waiting twelve seconds.
    let beforePause = Date().addingTimeInterval(-40)
    state.applyTyping(roomId: roomA, signal: .init(userId: "pat", state: .started), now: beforePause)
    state.applyTyping(roomId: roomA, signal: .init(userId: "kim", state: .started), now: beforePause.addingTimeInterval(11))
    #expect(state.typing.typistIds == ["pat", "kim"])
    for _ in 0 ..< 150 where !state.typing.typistIds.isEmpty {
      try await Task.sleep(for: .milliseconds(20))
    }
    #expect(state.typing.typistIds.isEmpty)
    state.reset()
  }

  @Test func typingLineFollowsTheOpenRoomsEventsAndExpiry() async throws {
    let fake = FakeRealtimeConnection()
    let (state, _, _) = try realtimeState(notificationLoadScript + [
      (200, realtimePageBody(messages: [])), (200, realtimeReadBody(id: roomB))
    ], realtime: { fake })
    await state.reload()
    await waitForRealtimeIdle(state)

    // Through the socket's ordered stream: another room's typist and the reader never show.
    fake.deliver(.typingChannel(roomId: roomA, canPublish: false))
    fake.deliver(.typing(roomId: roomB, signal: .init(userId: "stranger", state: .started)))
    fake.deliver(.typing(roomId: roomA, signal: .init(userId: "user_1", state: .started)))
    fake.deliver(.typing(roomId: roomA, signal: .init(userId: "pat", state: .started)))
    for _ in 0 ..< 1000 where state.typing.typistIds.isEmpty {
      await Task.yield()
    }
    #expect(state.typing.typistIds == ["pat"])
    // A subscribe-only token reads the room and stays quiet.
    state.composerEdited(roomId: roomA, hasText: true, now: typingOrigin)
    #expect(fake.typingLog == ["watch \(roomA)"])
    fake.deliver(.typing(roomId: roomA, signal: .init(userId: "pat", state: .stopped)))
    for _ in 0 ..< 1000 where !state.typing.typistIds.isEmpty {
      await Task.yield()
    }
    #expect(state.typing.typistIds.isEmpty)

    state.applyTyping(roomId: roomA, signal: .init(userId: "pat", state: .started), now: typingOrigin)
    state.applyTyping(roomId: roomA, signal: .init(userId: "kim", state: .started), now: typingOrigin.addingTimeInterval(4))
    state.sweepTyping(now: typingOrigin.addingTimeInterval(11.9))
    #expect(state.typing.typistIds == ["pat", "kim"])
    state.sweepTyping(now: typingOrigin.addingTimeInterval(12))
    #expect(state.typing.typistIds == ["kim"])
    // A token that no longer grants the channel shows nobody.
    state.applyTypingChannel(roomId: roomA, canPublish: nil)
    #expect(state.typing.typistIds.isEmpty)

    state.applyTyping(roomId: roomA, signal: .init(userId: "pat", state: .started), now: typingOrigin.addingTimeInterval(20))
    #expect(state.typing.typistIds == ["pat"])
    state.selectRoom(roomB)
    #expect(state.typing.typistIds.isEmpty && state.typing.roomId == roomB)
    await waitForRealtimeIdle(state)
    state.reset()
  }

  /// Row 31b1: the open room's Seen by reads the room payload's marks, takes live `chat_room_read` events
  /// through the ordered stream, never rewinds, ignores other rooms and starts over in the next room.
  @Test func seenByFollowsTheOpenRoomsReadEvents() async throws {
    let fake = FakeRealtimeConnection()
    let (state, _, _) = try realtimeState([
      (200, workspacesBody()), (200, realtimeUserBody),
      (200, realtimeRoomsBody(ids: [roomA, roomB], userMembers: seenByMembers)),
      (200, realtimePageBody(messages: [])), (200, realtimeReadBody(id: roomA)),
      (200, realtimePageBody(messages: [])), (200, realtimeReadBody(id: roomB))
    ], realtime: { fake })
    await state.reload()
    await waitForRealtimeIdle(state)

    // The payload is the floor; the viewer is never a reader of their own room.
    #expect(state.roomReadReceipts.readers.map(\.participant.id) == ["pat"])
    #expect(state.roomReadReceipts.nonReaders.map(\.id) == ["kim"])

    fake.deliver(.roomRead(.init(roomId: roomB, userId: "kim", lastReadAt: readAt(minutes: 20))))
    fake.deliver(.roomRead(.init(roomId: roomA, userId: "kim", lastReadAt: readAt(minutes: 10))))
    for _ in 0 ..< 1000 where state.roomReadReceipts.nonReaders.count == 1 {
      await Task.yield()
    }
    #expect(state.roomReadReceipts.readers.map(\.participant.id) == ["kim", "pat"])
    #expect(state.roomReadReceipts.readers.first?.lastReadAt == readAt(minutes: 10))
    // An older event cannot un-read the room.
    state.applyRoomRead(.init(roomId: roomA, userId: "kim", lastReadAt: readAt(minutes: 1)))
    #expect(state.roomReadReceipts.readers.first?.lastReadAt == readAt(minutes: 10))

    state.selectRoom(roomB)
    #expect(state.roomReads.roomId == roomB && state.roomReads.marks.isEmpty)
    await waitForRealtimeIdle(state)
    #expect(state.roomReadReceipts.readers.map(\.participant.id) == ["pat"])
    state.reset()
  }

  /// Row 31b2: the Members inspector reads its room through the same receipts, so a live `chat_room_read` moves a
  /// member out of "Not read yet" and up the list; another room's roster takes no live mark from the open one.
  @Test func membersInspectorFollowsTheOpenRoomsReadEvents() async throws {
    let fake = FakeRealtimeConnection()
    let (state, _, _) = try realtimeState([
      (200, workspacesBody()), (200, realtimeUserBody),
      (200, realtimeRoomsBody(ids: [roomA, roomB], userMembers: seenByMembers)),
      (200, realtimePageBody(messages: [])), (200, realtimeReadBody(id: roomA))
    ], realtime: { fake })
    await state.reload()
    await waitForRealtimeIdle(state)
    let open = try #require(state.rooms.first { $0.id == roomA })
    let other = try #require(state.rooms.first { $0.id == roomB })
    func roster(_ room: Components.Schemas.ChatRoom) -> RoomRosterGroups {
      RoomRoster.groups(in: room, currentUserId: state.currentUserId, receipts: state.readReceipts(for: room))
    }

    #expect(roster(open).people.map(\.id) == [.human("user_1"), .human("pat")])
    #expect(roster(open).neverRead.map(\.id) == [.human("kim")])

    fake.deliver(.roomRead(.init(roomId: roomA, userId: "kim", lastReadAt: readAt(minutes: 10))))
    for _ in 0 ..< 1000 where roster(open).neverRead.count == 1 {
      await Task.yield()
    }
    #expect(roster(open).people.map(\.id) == [.human("user_1"), .human("kim"), .human("pat")])
    #expect(roster(open).people.map(\.lastReadAt) == [nil, readAt(minutes: 10), readAt(minutes: 5)])
    #expect(roster(open).neverRead.isEmpty)
    #expect(roster(other).neverRead.map(\.id) == [.human("kim")])
    state.reset()
  }
}

private let typingOrigin = Date(timeIntervalSince1970: 1_800_000_000)

/// The viewer, a reader at 00:05 and a member who never opened the room; every room in the list carries them.
private let seenByMembers = """
[{"id":"user_1","name":"Me","email":"me@example.com","image":null,"presence":"online","lastReadAt":"2026-01-01T00:09:00.000Z"},\
{"id":"pat","name":"Pat","email":"pat@example.com","image":null,"presence":"offline","lastReadAt":"2026-01-01T00:05:00.000Z"},\
{"id":"kim","name":"Kim","email":"kim@example.com","image":null,"presence":"offline","lastReadAt":null}]
"""

private func readAt(minutes: Double) -> Date {
  Date(timeIntervalSince1970: 1_767_225_600 + minutes * 60)
}

private let notificationLoadScript: [(Int, String)] = [
  (200, workspacesBody()), (200, realtimeUserBody),
  (200, realtimeRoomsBody(ids: [roomA, roomB])),
  (200, realtimePageBody(messages: [])), (200, realtimeReadBody(id: roomA))
]

private let realtimeErrorBody = #"{"error":"Error","message":"Nope","meta":{"timestamp":"2026-01-01T00:00:00.000Z","requestId":"req-1","path":"/x","method":"PATCH"}}"#

@MainActor
private final class FakeNotificationPresenter: ChatNotificationPresenting {
  var authorization: ChatNotificationAuthorization = .authorized
  var isAppActive = true
  private(set) var shown: [ChatNotificationBanner] = []
  private(set) var dismissed: [String] = []
  private(set) var dismissAllCount = 0

  func requestAuthorization() async -> ChatNotificationAuthorization {
    authorization
  }

  func show(_ banner: ChatNotificationBanner) {
    shown.append(banner)
  }

  func dismiss(identifier: String) {
    dismissed.append(identifier)
  }

  func dismissAll() {
    dismissAllCount += 1
  }
}
