import Combine
import CoreAPI
import Foundation
import HTTPTypes
import OpenAPIRuntime
import SokosumiAuth
import SokosumiChat
@testable import SokosumiWorkspace
import Testing

private let timestamp = "2026-01-01T00:00:00.000Z"

@MainActor
private final class ScriptedTransport: ClientTransport {
  private(set) var operationIDs: [String] = []
  private(set) var paths: [String] = []
  private(set) var bodies: [Data] = []
  private var responses: [(Int, String)]
  var remainingStubs: Int {
    responses.count
  }

  var pauseDirect = false
  var pausePOST = false
  var pauseStream = false
  var pauseGET = false
  var pauseDELETE = false
  var pauseReaction = false
  var pauseUnfurl = false
  var pauseMentionRetry = false
  var pauseSokoBotFeedback = false
  var pauseStarredOrder = false
  /// Oldest first: requests for different emoji can wait at the same time.
  private var pauseWaiters: [CheckedContinuation<Void, Never>] = []
  /// Tests wait on `operationIDs` (appended before the body `await`). A
  /// release that arrives in that window must not be lost.
  private var requestReleased = false
  private var postCompleted = false
  private var postCompletionWaiter: CheckedContinuation<Void, Never>?

  init(_ responses: [(Int, String)]) {
    self.responses = responses
  }

  /// One pause flag per operation family; only message-scoped operations honour them.
  private func pausesMessageOperation(_ operationID: String) -> Bool {
    let pausedByFlag = (pauseGET && operationID.hasPrefix("get/"))
      || (pauseDELETE && operationID.hasPrefix("delete/"))
      || (pauseReaction && operationID.hasSuffix("/reactions/{emoji}"))
      || (pauseUnfurl && operationID.hasSuffix("/unfurls/remove"))
      || (pauseMentionRetry && operationID.hasSuffix("/mentions/{mentionId}/retry"))
      || (pauseSokoBotFeedback && operationID == "sendMySokoBotTurnFeedback")
    let pausableOperation = operationID.contains("/messages")
      || operationID == "get/chats/rooms/{id}/threads/{parentMessageId}"
      || operationID == "sendMySokoBotTurnFeedback"
    return pausedByFlag && pausableOperation
  }

  func send(
    _ request: HTTPRequest,
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
    paths.append(request.path ?? "")
    if let body, let bytes = try? await Array(collecting: body, upTo: 1_000_000) {
      bodies.append(Data(bytes))
    } else {
      bodies.append(Data())
    }
    if pauseDirect, ["post/chats/rooms", "post/chats/rooms/{id}/members/me", "post/chats/invitations/{id}/accept"].contains(operationID) {
      let next = responses.removeFirst()
      if !requestReleased {
        await withCheckedContinuation { pauseWaiters.append($0) }
      }
      requestReleased = false
      return (HTTPResponse(status: HTTPResponse.Status(code: next.0)), HTTPBody(next.1))
    }
    if pausePOST, operationID == "post/chats/rooms/{id}/messages" {
      if !requestReleased {
        await withCheckedContinuation { pauseWaiters.append($0) }
      }
      requestReleased = false
      try Task.checkCancellation()
    }
    if pauseStream, operationID == "post/chats/rooms/{id}/stream" || operationID == "get/chats/rooms/{id}/stream/active" {
      let next = responses.removeFirst()
      if !requestReleased {
        await withCheckedContinuation { pauseWaiters.append($0) }
      }
      requestReleased = false
      try Task.checkCancellation()
      return (HTTPResponse(status: HTTPResponse.Status(code: next.0)), HTTPBody(next.1))
    }
    if pausesMessageOperation(operationID) || (pauseStarredOrder && operationID == "put/chats/rooms/starred") {
      let next = responses.removeFirst()
      if !requestReleased {
        await withCheckedContinuation { pauseWaiters.append($0) }
      }
      requestReleased = false
      try Task.checkCancellation()
      return (HTTPResponse(status: HTTPResponse.Status(code: next.0)), HTTPBody(next.1))
    }
    let next = responses.removeFirst()
    return (HTTPResponse(status: HTTPResponse.Status(code: next.0)), HTTPBody(next.1))
  }

  func releasePausedRequest() {
    if pauseWaiters.isEmpty {
      requestReleased = true
    } else {
      pauseWaiters.removeFirst().resume()
    }
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

/// `pinned` stars every room one second apart, in the given order. `members`
/// gives each room its roster by name, for tests that read one.
private func roomsBody(names: [String], pinned: Bool = false, members: [String: [String]] = [:]) -> String {
  let rooms = names.enumerated().map { index, name in
    let starredAt = pinned ? "\"2026-01-01T00:00:0\(index).000Z\"" : "null"
    let roster = (members[name] ?? []).map {
      """
      {"id":"\($0)","name":"\($0)","email":"\($0)@example.com","image":null,"presence":"offline"}
      """
    }.joined(separator: ",")
    return """
    {"id":"550e8400-e29b-41d4-a716-44665544000\(index)","organizationId":null,"organizationName":null,"name":"\(name)","slug":null,"kind":"channel","isSelfDirect":false,"directKey":null,"isGroupDirect":false,"groupName":null,"topic":null,"discoverability":null,"createdByUserId":"user_1","createdAt":"\(timestamp)","updatedAt":"\(timestamp)","unreadCount":0,"unreadMentionCount":0,"starredAt":\(starredAt),"pinnedMessageCount":0,"mutedAt":null,"markedUnread":false,"myAccess":"member","peerInActiveOrganization":false,"userMembers":[\(roster)],"coworkerMembers":[],"sokoBotMembers":[]}
    """
  }.joined(separator: ",")
  return """
  {"data":[\(rooms)],"meta":{"timestamp":"\(timestamp)","requestId":"req-1","pagination":{"cursor":null,"limit":100,"total":\(names.count),"nextCursor":null}}}
  """
}

/// Org workspace with `general` open, then Core replies for: archived load (owner), archive, restore (+ transcript),
/// a rejected leave, leave, archive and delete.
@MainActor
private func lifecycleFixture(general: String, design: String) throws -> (WorkspaceState, AuthState, ScriptedTransport) { // swiftlint:disable:this large_tuple
  func envelope(_ data: String) -> String {
    #"{"data":\#(data),"meta":{"timestamp":"2026-01-01T00:00:00.000Z","requestId":"req-1"}}"#
  }
  let owner = envelope(#"{"id":"member-me","userId":"user_1","organizationId":"org_1","role":"owner","seatAssignedAt":null,"createdAt":"2026-01-01T00:00:00.000Z"}"#)
  let lastMember = #"{"error":"Bad Request","message":"You are the last member of this room.","meta":{"timestamp":"2026-01-01T00:00:00.000Z","requestId":"req-1","path":"/chats/rooms/x/members/me","method":"DELETE"}}"#
  let (state, auth, transport, _) = try ephemeralState([
    (200, accessBody(gate: "ready")), (200, orgsBody), (200, userBody),
    (200, #"{"data":{"organizationId":"org_1"},"meta":{"timestamp":"2026-01-01T00:00:00.000Z","requestId":"req-1"}}"#),
    (200, roomsBody(names: ["general", "design"])),
    (200, transcriptPageBody(messages: [], nextCursor: nil)),
    (200, owner), (200, roomsBody(names: [])),
    (200, envelope(#"{"id":"\#(design)","archivedAt":"2026-01-01T00:00:00.000Z"}"#)),
    (200, roomReadBody(id: design, unread: 0, name: "design")),
    (200, transcriptPageBody(messages: [], nextCursor: nil)),
    (400, lastMember),
    (200, envelope(#"{"id":"\#(design)","remainingUserMemberCount":1}"#)),
    (200, envelope(#"{"id":"\#(general)","archivedAt":"2026-01-01T00:00:00.000Z"}"#)),
    (204, "")
  ], visible: false)
  return (state, auth, transport)
}

/// One fixture bundle per test; a struct would churn every call site.
private func ephemeralState(
  _ responses: [(Int, String)],
  visible: Bool = true
) throws -> (WorkspaceState, AuthState, ScriptedTransport, UserDefaults) { // swiftlint:disable:this large_tuple
  let transport = ScriptedTransport(responses)
  // The app registers this middleware too; without it the create-link body cannot carry `expiresInDays`.
  let client = try Client.connecting(to: #require(URL(string: "https://core.example/v1")), transport: transport, middlewares: [GuestInviteLinkExpiryMiddleware()])
  let suite = "sokosumi-workspace-state-tests.\(UUID().uuidString)"
  let defaults = UserDefaults(suiteName: suite)!
  defaults.removePersistentDomain(forName: suite)
  let state = WorkspaceState(
    savedRoom: SavedRoomSelection(defaults: defaults)
  )
  state.readAttention.setVisible(visible, window: UUID())
  state.clientResolver = { client }
  return (state, AuthState(configuration: nil, store: InMemoryTokenStore(), browser: StubOAuthBrowser(), restoreSession: false), transport, defaults)
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
  @Test(arguments: ["stay", "leave", "reset"], [false, true])
  func channelMembershipRespectsNavigation(action: String, joining: Bool) async throws {
    let target = "550e8400-e29b-41d4-a716-446655440009"
    let (state, auth, transport, _) = try ephemeralState([
      (200, accessBody(gate: "ready")), (200, orgsBody), (200, userBody),
      (200, #"{"data":{"organizationId":"org_1"},"meta":{"timestamp":"2026-01-01T00:00:00.000Z","requestId":"req-1"}}"#),
      (200, roomsBody(names: ["general"])),
      (200, transcriptPageBody(messages: [], nextCursor: nil)),
      (joining ? 200 : 201, roomReadBody(id: target, unread: 0)),
      (200, transcriptPageBody(messages: [], nextCursor: nil))
    ], visible: false)
    await state.reload(auth: auth)
    await waitForTranscriptIdle(state)
    var draft = ChannelDraft()
    draft.setSlug("team")
    let roster = ChatRecipientRoster(targets: [])
    let context = state.compositionContext
    transport.pauseDirect = true
    let operation = joining ? "post/chats/rooms/{id}/members/me" : "post/chats/rooms"
    func submit() async throws -> Bool {
      if joining {
        return try await state.joinChannel(roomId: target, context: context, auth: auth)
      }
      return try await state.createChannel(draft, roster: roster, context: context, auth: auth)
    }
    let request = Task { try await submit() }
    for _ in 0 ..< 1000 where !transport.operationIDs.contains(operation) {
      await Task.yield()
    }
    #expect(joining ? state.joiningChannel : state.creatingChannel)
    #expect(try await submit() == false)
    if action == "reset" {
      state.reset()
    } else if action == "leave" {
      state.clearTranscript()
    }
    transport.releasePausedRequest()
    if action == "reset" {
      await #expect(throws: CancellationError.self) { try await request.value }
    } else {
      #expect(try await request.value)
    }
    await waitForTranscriptIdle(state)
    #expect(!state.creatingChannel && !state.joiningChannel)
    #expect(state.transcriptRoomId == (action == "stay" ? target : nil))
    #expect(state.rooms.contains { $0.id == target } == (action != "reset"))
    #expect(transport.operationIDs.filter { $0 == operation }.count == 1)
  }

  @Test func channelUpdateReplacesRoomWithoutNavigating() async throws {
    let edited = "550e8400-e29b-41d4-a716-446655440001"
    let (state, auth, transport, _) = try ephemeralState([
      (200, accessBody(gate: "ready")), (200, orgsBody), (200, userBody),
      (200, #"{"data":{"organizationId":"org_1"},"meta":{"timestamp":"2026-01-01T00:00:00.000Z","requestId":"req-1"}}"#),
      (200, roomsBody(names: ["general", "design"])),
      (200, transcriptPageBody(messages: [], nextCursor: nil)),
      (200, roomReadBody(id: edited, unread: 3, name: "Design renamed"))
    ], visible: false)
    await state.reload(auth: auth)
    await waitForTranscriptIdle(state)
    let opened = try #require(state.transcriptRoomId)
    #expect(opened != edited)
    let room = try #require(state.rooms.first { $0.id == edited })
    var draft = ChannelEditDraft(room: room)
    draft.setName("Design renamed")
    let permissions = ChannelEditPermissions(canEditMembers: true, canManageSettings: true)
    let context = state.compositionContext
    #expect(try await state.updateChannel(draft, roomId: edited, permissions: permissions, context: context, auth: auth))
    #expect(!state.updatingRoom)
    #expect(state.transcriptRoomId == opened)
    #expect(state.rooms.count == 2)
    #expect(state.rooms.first { $0.id == edited }?.name == "Design renamed")
    #expect(state.rooms.first { $0.id == edited }?.unreadCount == 3)
    #expect(transport.operationIDs.filter { $0 == "patch/chats/rooms/{id}" }.count == 1)
    #expect(try await state.updateChannel(draft, roomId: edited, permissions: permissions, context: UUID(), auth: auth) == false)
    #expect(transport.operationIDs.filter { $0 == "patch/chats/rooms/{id}" }.count == 1)
  }

  @Test func channelLifecycleMovesRoomsBetweenSidebarAndArchive() async throws {
    let general = "550e8400-e29b-41d4-a716-446655440000"
    let design = "550e8400-e29b-41d4-a716-446655440001"
    let (state, auth, transport) = try lifecycleFixture(general: general, design: design)
    await state.reload(auth: auth)
    await waitForTranscriptIdle(state)
    #expect(state.transcriptRoomId == general)
    let context = state.compositionContext

    await state.loadArchivedChannels(auth: auth)
    #expect(state.archivedChannels.rooms.isEmpty && state.archivedChannels.canDelete)

    // Archiving another room keeps the open transcript and lists it under Archived.
    #expect(try await state.archiveChannel(roomId: design, context: context, auth: auth))
    #expect(state.rooms.map(\.id) == [general])
    #expect(state.archivedChannels.rooms.map(\.id) == [design])
    #expect(state.transcriptRoomId == general)

    // Restoring puts the live room back and opens it, as web navigates to it.
    #expect(try await state.restoreChannel(roomId: design, context: context, auth: auth))
    await waitForTranscriptIdle(state)
    #expect(state.archivedChannels.rooms.isEmpty)
    #expect(Set(state.rooms.map(\.id)) == [general, design])
    #expect(state.transcriptRoomId == design)

    // Core's last-member rejection surfaces and leaves the room in place.
    await #expect(throws: ChatServiceError.unprocessable(statusCode: 400, message: "You are the last member of this room.")) {
      try await state.leaveChannel(roomId: design, context: context, auth: auth)
    }
    #expect(state.channelLifecycle == nil)
    #expect(state.transcriptRoomId == design)

    // Leaving the open room drops it like a revoke; nothing else is forced open.
    #expect(try await state.leaveChannel(roomId: design, context: context, auth: auth))
    #expect(state.rooms.map(\.id) == [general])
    #expect(state.transcriptRoomId == nil)
    #expect(state.archivedChannels.rooms.isEmpty)

    #expect(try await state.archiveChannel(roomId: general, context: context, auth: auth))
    #expect(state.rooms.isEmpty)
    #expect(try await state.deleteChannel(roomId: general, context: context, auth: auth))
    #expect(state.archivedChannels.rooms.isEmpty)
    #expect(transport.remainingStubs == 0)

    // A request from a previous workspace context never reaches Core.
    let sent = transport.operationIDs.count
    #expect(try await state.deleteChannel(roomId: general, context: UUID(), auth: auth) == false)
    #expect(try await state.leaveChannel(roomId: general, context: UUID(), auth: auth) == false)
    #expect(transport.operationIDs.count == sent)
    #expect(transport.operationIDs.suffix(9) == [
      "get/users/{id}/organizations/{organizationId}/member", "get/chats/rooms",
      "post/chats/rooms/{id}/archive", "post/chats/rooms/{id}/restore", "get/chats/rooms/{id}/messages",
      "delete/chats/rooms/{id}/members/me", "delete/chats/rooms/{id}/members/me",
      "post/chats/rooms/{id}/archive", "delete/chats/rooms/{id}"
    ])
    state.reset()
    #expect(!state.archivedChannels.canDelete)
  }

  @Test func channelLifecycleWaitsForOtherChannelMutations() async throws {
    let target = "550e8400-e29b-41d4-a716-446655440009"
    let general = "550e8400-e29b-41d4-a716-446655440000"
    let (state, auth, transport, _) = try ephemeralState([
      (200, accessBody(gate: "ready")), (200, orgsBody), (200, userBody),
      (200, #"{"data":{"organizationId":"org_1"},"meta":{"timestamp":"2026-01-01T00:00:00.000Z","requestId":"req-1"}}"#),
      (200, roomsBody(names: ["general"])),
      (200, transcriptPageBody(messages: [], nextCursor: nil)),
      (200, roomReadBody(id: target, unread: 0)),
      (200, transcriptPageBody(messages: [], nextCursor: nil))
    ], visible: false)
    await state.reload(auth: auth)
    await waitForTranscriptIdle(state)
    let context = state.compositionContext
    transport.pauseDirect = true
    let join = Task { try await state.joinChannel(roomId: target, context: context, auth: auth) }
    for _ in 0 ..< 1000 where !transport.operationIDs.contains("post/chats/rooms/{id}/members/me") {
      await Task.yield()
    }
    #expect(state.roomMutationInFlight)
    #expect(try await state.leaveChannel(roomId: general, context: context, auth: auth) == false)
    #expect(try await state.archiveChannel(roomId: general, context: context, auth: auth) == false)
    transport.releasePausedRequest()
    #expect(try await join.value)
    await waitForTranscriptIdle(state)
    #expect(!transport.operationIDs.contains { $0.contains("archive") || $0.hasPrefix("delete/") })
  }

  @Test(arguments: ["stay", "leave", "reset"], [true, false]) func participantDirectRespectsNavigation(action: String, fromPicker: Bool) async throws {
    let target = "550e8400-e29b-41d4-a716-446655440009"
    let (state, auth, transport, _) = try ephemeralState([
      (200, accessBody(gate: "ready")), (200, orgsBody), (200, userBody),
      (200, #"{"data":{"organizationId":null},"meta":{"timestamp":"2026-01-01T00:00:00.000Z","requestId":"req-1"}}"#),
      (200, roomsBody(names: ["general"])),
      (200, transcriptPageBody(messages: [], nextCursor: nil)),
      (201, roomReadBody(id: target, unread: 0).replacingOccurrences(of: "\"kind\":\"channel\"", with: "\"kind\":\"direct\"")),
      (200, transcriptPageBody(messages: [], nextCursor: nil))
    ], visible: false)
    await state.reload(auth: auth)
    await waitForTranscriptIdle(state)
    #expect(try await state.openParticipantDirect(.coworker("peer"), auth: auth) == false)
    state.rooms[0].coworkerMembers = [.init(id: "peer", name: "Peer", slug: "peer", caption: nil, image: nil, presence: .online)]
    transport.pauseDirect = true
    let context = state.compositionContext
    var recipients = DirectConversationSelection(hasOrganization: false)
    recipients.add(.coworker("peer"))
    let request = Task {
      if fromPicker {
        return try await state.openDirect(recipients, context: context, auth: auth)
      }
      return try await state.openParticipantDirect(.coworker("peer"), auth: auth)
    }
    for _ in 0 ..< 1000 where !transport.operationIDs.contains("post/chats/rooms") {
      await Task.yield()
    }
    #expect(state.openingDirect == .coworker("peer"))
    // A second click while opening must not create another request.
    #expect(try await state.openParticipantDirect(.coworker("peer"), auth: auth) == false)
    if action == "reset" {
      state.reset()
    } else if action == "leave" {
      state.clearTranscript()
    }
    transport.releasePausedRequest()
    #expect(try await request.value == (action != "reset"))
    #expect(state.openingDirect == nil)
    if action == "reset" {
      #expect(try await state.openDirect(recipients, context: context, auth: auth) == false)
    }
    await waitForTranscriptIdle(state)
    #expect(state.transcriptRoomId == (action == "stay" ? target : nil))
    #expect(state.rooms.contains { $0.id == target } == (action != "reset"))
    #expect(transport.operationIDs.filter { $0 == "post/chats/rooms" }.count == 1)
  }

  @Test func failedWorkspaceSwitchDiscardsPendingDirect() async throws {
    let target = "550e8400-e29b-41d4-a716-446655440009"
    let (state, auth, transport, _) = try ephemeralState([
      (200, accessBody(gate: "ready")), (200, orgsBody), (200, userBody),
      (200, #"{"data":{"organizationId":null},"meta":{"timestamp":"2026-01-01T00:00:00.000Z","requestId":"req-1"}}"#),
      (200, roomsBody(names: ["general"])),
      (200, transcriptPageBody(messages: [], nextCursor: nil)),
      (201, roomReadBody(id: target, unread: 0)),
      (500, """
      {"error":"Internal Server Error","message":"Try again","meta":{"timestamp":"\(timestamp)","requestId":"req-1","path":"/v1/users/me/preferred-organization","method":"PUT"}}
      """)
    ], visible: false)
    await state.reload(auth: auth)
    await waitForTranscriptIdle(state)
    let context = state.compositionContext
    var selection = DirectConversationSelection(hasOrganization: false)
    selection.add(.coworker("peer"))
    transport.pauseDirect = true
    let request = Task { try await state.openDirect(selection, context: context, auth: auth) }
    for _ in 0 ..< 1000 where transport.remainingStubs != 1 {
      await Task.yield()
    }
    #expect(transport.remainingStubs == 1)
    let organization = try #require(state.options.first { $0.id == "org_1" })
    await state.switchRooms(auth: auth, option: organization)
    #expect(state.selectionId == "personal")
    #expect(state.compositionContext != context)
    transport.releasePausedRequest()
    #expect(try await request.value == false)
    #expect(!state.rooms.contains { $0.id == target })
    #expect(state.openingDirect == nil)
    #expect(try await state.openDirect(selection, context: context, auth: auth) == false)
  }

  @Test func clientProviderReceivesCurrentAuthOnEveryResolution() throws {
    let auth = AuthState(configuration: nil, store: InMemoryTokenStore(), browser: StubOAuthBrowser(), restoreSession: false)
    let client = try Client.connecting(to: #require(URL(string: "https://core.example/v1")), transport: ScriptedTransport([]))
    var available = true
    var calls = 0
    let state = WorkspaceState(clientProvider: { currentAuth in
      #expect(currentAuth === auth)
      calls += 1
      return available ? client : nil
    })
    #expect(state.resolveClient(auth: auth) != nil)
    available = false
    #expect(state.resolveClient(auth: auth) == nil)
    #expect(calls == 2)
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

  /// Pinned reorder at the transport boundary: `fail` answers the PUT with that status.
  @Test(arguments: [nil, 500, 401] as [Int?])
  func pinnedReorderShowsAtOnceAndAFailureReloadsFromCore(fail: Int?) async throws {
    let ids = (0 ..< 3).map { "550e8400-e29b-41d4-a716-44665544000\($0)" }
    let moved = [ids[2], ids[0], ids[1]]
    let order = moved.enumerated().map { #"{"roomId":"\#($1)","starredAt":"2026-02-01T00:00:00.00\#($0)Z"}"# }.joined(separator: ",")
    let put: (Int, String) = if let fail {
      (fail, #"{"error":"Request failed","message":"Refused","meta":{"timestamp":"2026-01-01T00:00:00.000Z","requestId":"req-1","path":"/chats/rooms/starred","method":"PUT"}}"#)
    } else {
      (200, #"{"data":[\#(order)],"meta":{"timestamp":"2026-01-01T00:00:00.000Z","requestId":"req-1"}}"#)
    }
    let (state, auth, transport, _) = try ephemeralState([
      (200, accessBody(gate: "ready")), (200, orgsBody), (200, userBody),
      (200, #"{"data":{"organizationId":null},"meta":{"timestamp":"2026-01-01T00:00:00.000Z","requestId":"req-1"}}"#),
      (200, roomsBody(names: ["a", "b", "c"], pinned: true)),
      (200, transcriptPageBody(messages: [], nextCursor: nil)),
      put,
      (200, roomsBody(names: ["a", "b", "c"], pinned: true))
    ], visible: false)
    await state.reload(auth: auth)
    await waitForTranscriptIdle(state)
    #expect(state.sidebar.partitioned.pinned.map(\.id) == ids)
    let selected = state.selectedRoomId
    transport.pauseStarredOrder = true
    let task = Task { await state.reorderPinnedRooms(moved, auth: auth) }
    while transport.operationIDs.last != "put/chats/rooms/starred" {
      await Task.yield()
    }
    #expect(state.sidebar.partitioned.pinned.map(\.id) == moved)
    #expect(state.selectedRoomId == selected)
    transport.releasePausedRequest()
    await task.value
    let sent = try #require(transport.bodies.last { !$0.isEmpty })
    #expect(try JSONSerialization.jsonObject(with: sent) as? [String: [String]] == ["roomIds": moved])
    switch fail {
    case nil:
      #expect(state.sidebar.partitioned.pinned.map(\.id) == moved)
      #expect(state.sidebar.actionError == nil)
      #expect(transport.operationIDs.last == "put/chats/rooms/starred")
    case 500:
      // What Core holds is the truth: the error shows and the list is read again.
      #expect(state.sidebar.actionError == "Core rejected the request (500): Refused")
      #expect(transport.operationIDs.suffix(2) == ["put/chats/rooms/starred", "get/chats/rooms"])
      #expect(state.sidebar.partitioned.pinned.map(\.id) == ids)
    default:
      // The sign-in card takes over: no alert beside it and no reload with a dead session.
      #expect(state.sidebar.actionError == nil)
      #expect(transport.operationIDs.last == "put/chats/rooms/starred")
    }
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
    transport.releasePausedRequest()
    await transport.waitForPOSTCompletion()
    await waitForOutboundIdle(state)
    #expect(state.outboundShells.isEmpty)
    #expect(state.transcriptRoomId == secondID)
    #expect(transport.remainingStubs == 0)
  }

  @Test func missingThreadClientEndsInitialLoading() throws {
    let (state, _, _, _) = try ephemeralState([])
    let auth = AuthState(configuration: nil, store: InMemoryTokenStore(), browser: StubOAuthBrowser(), restoreSession: false)
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
    transport.releasePausedRequest()
    await waitForOutboundIdle(state)
    #expect(state.outboundShells.isEmpty)
    #expect(state.displayedTranscript.map(\.content) == ["hello"])
    #expect(state.transcriptMessages.map(\.id) == [confirmedID])
    #expect(transport.operationIDs.last == "post/chats/rooms/{id}/messages")
  }

  @Test func failedSendRetryReusesTurnAndRemoveDropsShell() async throws {
    let roomID = "550e8400-e29b-41d4-a716-446655440000"
    let confirmedID = "550e8400-e29b-41d4-a716-446655440502"
    let roster = roomsBody(names: ["general"]).replacingOccurrences(of: "\"userMembers\":[]", with: #""userMembers":[{"id":"peer","name":"Peer","email":"peer@example.com","presence":"online"}]"#)
    let (state, auth, transport, _) = try ephemeralState([
      (200, accessBody(gate: "ready")),
      (200, orgsBody),
      (200, userBody),
      (200, #"{"data":{"organizationId":null},"meta":{"timestamp":"2026-01-01T00:00:00.000Z","requestId":"req-1"}}"#),
      (200, roster),
      (200, transcriptPageBody(messages: [], nextCursor: nil)),
      (200, roomReadBody(id: roomID, unread: 0)),
      (500, """
      {"error":"Internal Server Error","message":"boom","meta":{"timestamp":"\(timestamp)","requestId":"req-1","path":"/v1/chats/rooms/\(roomID)/messages","method":"POST"}}
      """),
      (201, createdMessageBody(id: confirmedID, roomId: roomID, content: "@peer:peer"))
    ])
    await state.reload(auth: auth)
    await waitForTranscriptIdle(state)
    state.sendMessage("@peer:peer", auth: auth)
    await waitForOutboundIdle(state)
    #expect(state.outboundShells.count == 1)
    #expect(state.outboundShells[0].status == .failed)
    #expect(state.displayedTranscript.map(\.content) == ["@peer:peer"])
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
    #expect(posts[0]["mentionedUserIds"] as? [String] == ["peer"])
    #expect(posts[1]["mentionedUserIds"] as? [String] == ["peer"])
    #expect(posts[0]["clientMessageId"] as? String == turnId)
    #expect(posts[1]["clientMessageId"] as? String == turnId)
    #expect(posts[0]["content"] as? String == "@peer:peer")
    #expect(posts[1]["content"] as? String == "@peer:peer")
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
    transport.releasePausedRequest()
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
    transport.releasePausedRequest()
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
    let room = Components.Schemas.ChatRoom(id: roomId, name: "Coworker", kind: .direct, isSelfDirect: false, isGroupDirect: false, createdByUserId: "me", createdAt: Date(), updatedAt: Date(), unreadCount: 0, unreadMentionCount: 0, markedUnread: false, myAccess: .member, userMembers: [sender], coworkerMembers: [.init(id: "coworker", name: "Coworker", slug: "coworker", presence: .online)], sokoBotMembers: [])
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
    // Row 19a: the deleted root stays in state and as the open thread's tombstone, not in the room transcript.
    #expect(state.displayedTranscript.map(\.id) == ["persisted"])
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
    let room = Components.Schemas.ChatRoom(id: roomId, name: "Coworker", kind: .direct, isSelfDirect: false, isGroupDirect: false, createdByUserId: "me", createdAt: Date(), updatedAt: Date(), unreadCount: 0, unreadMentionCount: 0, markedUnread: false, myAccess: .member, userMembers: [sender], coworkerMembers: [.init(id: "coworker", name: "Coworker", slug: "coworker", presence: .online)], sokoBotMembers: [])
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
    let room = Components.Schemas.ChatRoom(id: roomId, name: "Coworker", kind: .direct, isSelfDirect: false, isGroupDirect: false, createdByUserId: "me", createdAt: Date(), updatedAt: Date(), unreadCount: 0, unreadMentionCount: 0, markedUnread: false, myAccess: .member, userMembers: [sender], coworkerMembers: [.init(id: "coworker", name: "Coworker", slug: "coworker", presence: .online)], sokoBotMembers: [])
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
    transport.releasePausedRequest()
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
    let room = Components.Schemas.ChatRoom(id: roomId, name: "Coworker", kind: .direct, isSelfDirect: false, isGroupDirect: false, createdByUserId: "me", createdAt: Date(), updatedAt: Date(), unreadCount: 0, unreadMentionCount: 0, markedUnread: false, myAccess: .member, userMembers: [sender], coworkerMembers: [.init(id: "coworker", name: "Coworker", slug: "coworker", presence: .online)], sokoBotMembers: [])
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
    transport.releasePausedRequest()
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
    prepared.transport.releasePausedRequest()
    await waitWhile { prepared.transport.threadGets == 0 }
    prepared.state.openThread(parent, auth: prepared.auth)
    prepared.transport.releasePausedRequest()
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
    prepared.transport.releasePausedRequest()
    await waitWhile { prepared.transport.messageGets < 3 }
    #expect(prepared.state.streamingThreadToOpen?.id == "root")
    prepared.transport.releasePausedRequest()
    await waitWhile { prepared.transport.threadGets == 0 }
    prepared.transport.releasePausedRequest()
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
    id: roomId, name: "Coworker", kind: .direct, isSelfDirect: false, isGroupDirect: false, createdByUserId: "me", createdAt: Date(), updatedAt: Date(),
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
  {"data":[{"id":"\(id)","organizationId":null,"organizationName":null,"name":"general","slug":null,"kind":"channel","isSelfDirect":false,"directKey":null,"isGroupDirect":false,"groupName":null,"topic":null,"discoverability":null,"createdByUserId":"user_1","createdAt":"\(timestamp)","updatedAt":"\(timestamp)","unreadCount":\(unread),"unreadMentionCount":0,"starredAt":null,"pinnedMessageCount":0,"mutedAt":null,"markedUnread":false,"myAccess":"member","peerInActiveOrganization":false,"userMembers":[],"coworkerMembers":[],"sokoBotMembers":[]}],"meta":{"timestamp":"\(timestamp)","requestId":"req-1","pagination":{"cursor":null,"limit":100,"total":1,"nextCursor":null}}}
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
  {"id":"\(id)","organizationId":null,"organizationName":null,"name":"\(name)","slug":null,"kind":"channel","isSelfDirect":false,"directKey":null,"isGroupDirect":false,"groupName":null,"topic":null,"discoverability":null,"createdByUserId":"user_1","createdAt":"\(timestamp)","updatedAt":"\(timestamp)","unreadCount":\(unread),"unreadMentionCount":0,"starredAt":null,"pinnedMessageCount":0,"mutedAt":null,"markedUnread":false,"myAccess":"member","peerInActiveOrganization":false,"userMembers":[],"coworkerMembers":[],"sokoBotMembers":[]}
  """
  return """
  {"data":\(room),"meta":{"timestamp":"\(timestamp)","requestId":"req-1"}}
  """
}

extension WorkspaceStateTests {
  @Test(arguments: [false, true])
  func savedEditUpdatesRoomParentOrThreadReply(reply: Bool) async throws {
    let roomId = "550e8400-e29b-41d4-a716-446655440000"
    let messageId = "550e8400-e29b-41d4-a716-446655440123"
    let response = createdMessageBody(id: messageId, roomId: roomId, content: "Changed")
      .replacingOccurrences(of: "\"editedAt\":null", with: "\"editedAt\":\"2026-01-02T00:00:00.000Z\"")
      .replacingOccurrences(of: "\"parentMessageId\":null", with: reply ? "\"parentMessageId\":\"parent\"" : "\"parentMessageId\":null")
    let (state, auth, _, _) = try ephemeralState([(200, response)], visible: false)
    var source = chatRoomMessage(from: .init(clientTurnId: "edit", roomId: roomId, content: "Original",
                                             sender: .init(id: "user_1", name: "Me", email: "me@example.com", presence: .online)))
    source.id = messageId
    state.timeline.reset(roomId: roomId)
    if reply {
      var parent = source
      parent.id = "parent"
      state.timeline.messages = [parent]
      state.thread.open(parent)
      source.parentMessageId = parent.id
      state.thread.timeline.messages = [source]
    } else {
      state.timeline.messages = [source]
      state.thread.open(source)
    }
    state.messageEditing.start(source, userId: "user_1")
    state.messageEditing.draft = "Changed"
    await state.saveMessageEdit(auth: auth)
    #expect(state.messageEditing.source == nil)
    if reply {
      #expect(state.thread.timeline.messages.first?.content == "Changed")
      #expect(state.timeline.messages.first?.content == "Original")
    } else {
      #expect(state.timeline.messages.first?.content == "Changed")
      #expect(state.thread.parent?.content == "Changed")
    }
    #expect((reply ? state.thread.timeline.messages.first : state.timeline.messages.first)?.editedAt != nil)
  }
}

extension WorkspaceStateTests {
  @Test
  func editingKeystrokesDoNotInvalidateConversation() throws {
    let (state, _, _, _) = try ephemeralState([], visible: false)
    var source = chatRoomMessage(from: .init(clientTurnId: "edit", roomId: "room", content: "Original",
                                             sender: .init(id: "user_1", name: "Me", email: "me@example.com", presence: .online)))
    source.id = "persisted-message"
    var conversationUpdates = 0
    var editorUpdates = 0
    let conversationObservation = state.objectWillChange.sink { conversationUpdates += 1 }
    let editorObservation = state.messageEditing.objectWillChange.sink { editorUpdates += 1 }
    defer {
      conversationObservation.cancel()
      editorObservation.cancel()
    }
    state.messageEditing.start(source, userId: "user_1")
    #expect(conversationUpdates > 0)
    conversationUpdates = 0
    editorUpdates = 0
    for character in " typing an updated message" {
      state.messageEditing.draft.append(character)
    }
    #expect(editorUpdates == 26)
    #expect(conversationUpdates == 0)
    state.messageEditing.cancel()
    #expect(conversationUpdates > 0)
    #expect(state.messageEditing.source == nil)
  }
}

extension WorkspaceStateTests {
  @Test(arguments: [false, true])
  func deletionDropsTheRowAndKeepsTheThreadRootTombstone(reply: Bool) async throws {
    let roomId = "550e8400-e29b-41d4-a716-446655440000"
    let messageId = "550e8400-e29b-41d4-a716-446655440123"
    let response = createdMessageBody(id: messageId, roomId: roomId, content: "")
      .replacingOccurrences(of: "\"deletedAt\":null", with: "\"deletedAt\":\"2026-01-02T00:00:00.000Z\"")
      .replacingOccurrences(of: "\"parentMessageId\":null", with: reply ? "\"parentMessageId\":\"parent\"" : "\"parentMessageId\":null")
    let (state, auth, _, _) = try ephemeralState([(200, response)], visible: false)
    var source = chatRoomMessage(from: .init(clientTurnId: "delete", roomId: roomId, content: "Original",
                                             sender: .init(id: "user_1", name: "Me", email: "me@example.com", presence: .online)))
    source.id = messageId
    state.timeline.reset(roomId: roomId)
    if reply {
      var parent = source
      parent.id = "parent"
      parent.threadReplyCount = 1
      parent.threadLastReplyAt = Date()
      state.timeline.messages = [parent]
      state.thread.open(parent)
      source.parentMessageId = parent.id
      state.thread.timeline.messages = [source]
    } else {
      state.timeline.messages = [source]
      state.thread.open(source)
    }
    state.messageEditing.start(source, userId: "user_1")
    try await state.deleteMessage(source, auth: auth)
    #expect(state.messageEditing.source == nil)
    #expect(state.thread.parent != nil)
    if reply {
      #expect(state.thread.timeline.messages.first?.deletedAt != nil)
      #expect(state.displayedThreadReplies.isEmpty)
      #expect(state.displayedTranscript.map(\.id) == ["parent"])
      #expect(state.timeline.messages.first?.content == "Original")
      #expect(state.timeline.messages.first?.threadReplyCount == 0)
      #expect(state.thread.parent?.threadReplyCount == 0)
      #expect(state.thread.parent?.threadLastReplyAt == nil)
    } else {
      #expect(state.timeline.messages.first?.deletedAt != nil)
      #expect(state.displayedTranscript.isEmpty)
      // Web renders the deleted parent above the divider as "This message was deleted".
      #expect(state.thread.parent?.deletedAt != nil)
    }
  }

  @Test func failedDeletionLeavesMessageAndDraftIntact() async throws {
    let (state, auth, _, _) = try ephemeralState([(403, "{\"message\":\"Deletion denied\"}")], visible: false)
    var source = chatRoomMessage(from: .init(clientTurnId: "delete", roomId: "room", content: "Original",
                                             sender: .init(id: "user_1", name: "Me", email: "me@example.com", presence: .online)))
    source.id = "message"
    state.timeline.reset(roomId: "room")
    state.timeline.messages = [source]
    state.messageEditing.start(source, userId: "user_1")
    state.messageEditing.draft = "Unsaved"
    #expect(state.displayedTranscript.map(\.id) == ["message"])
    await #expect(throws: (any Error).self) { try await state.deleteMessage(source, auth: auth) }
    // Deletion is not optimistic (web awaits the server action too): a refusal leaves the row on screen.
    #expect(state.displayedTranscript.map(\.id) == ["message"])
    #expect(state.timeline.messages.first?.content == "Original")
    #expect(state.timeline.messages.first?.deletedAt == nil)
    #expect(state.messageEditing.draft == "Unsaved")
  }

  @Test(arguments: [false, true])
  func deletionResponseRespectsRoomGenerationAndRealtimeParent(roomChanged: Bool) async throws {
    let response = createdMessageBody(id: "reply", roomId: "room", content: "")
      .replacingOccurrences(of: "\"deletedAt\":null", with: "\"deletedAt\":\"2026-01-02T00:00:00.000Z\"")
      .replacingOccurrences(of: "\"parentMessageId\":null", with: "\"parentMessageId\":\"parent\"")
    let (state, auth, transport, _) = try ephemeralState([(200, response)], visible: false)
    var parent = chatRoomMessage(from: .init(clientTurnId: "parent", roomId: "room", content: "Parent",
                                             sender: .init(id: "user_1", name: "Me", email: "me@example.com", presence: .online)))
    parent.id = "parent"
    parent.threadReplyCount = 2
    var reply = parent
    reply.id = "reply"
    reply.parentMessageId = parent.id
    state.timeline.reset(roomId: "room")
    state.timeline.messages = [parent]
    state.thread.open(parent)
    state.thread.timeline.messages = [reply]
    transport.pauseDELETE = true
    let deletion = Task { try await state.deleteMessage(reply, auth: auth) }
    while transport.operationIDs.isEmpty {
      await Task.yield()
    }
    if roomChanged {
      state.timeline.reset(roomId: "other")
      state.thread.close()
    } else {
      parent.threadReplyCount = 1
      state.timeline.messages = [parent]
      state.thread.apply(eventType: .update, message: parent)
    }
    transport.releasePausedRequest()
    try await deletion.value
    if roomChanged {
      #expect(state.timeline.messages.isEmpty)
      #expect(state.thread.parent == nil)
    } else {
      #expect(state.timeline.messages.first?.threadReplyCount == 1)
      #expect(state.thread.parent?.threadReplyCount == 1)
      #expect(state.thread.timeline.messages.first?.deletedAt != nil)
    }
  }
}

extension WorkspaceStateTests {
  private func reactionBody(_ reactions: String, reply: Bool = false) -> String {
    createdMessageBody(id: "message", roomId: "room", content: "Old content")
      .replacingOccurrences(of: "\"reactions\":[]", with: "\"reactions\":[\(reactions)]")
      .replacingOccurrences(of: "\"parentMessageId\":null", with: reply ? "\"parentMessageId\":\"parent\"" : "\"parentMessageId\":null")
  }

  private var ownThumbs: String {
    "{\"emoji\":\"👍\",\"count\":1,\"reactedByCurrentUser\":true,\"reactors\":[]}"
  }

  private func reactionSource() -> Components.Schemas.ChatRoomMessage {
    var source = chatRoomMessage(from: .init(clientTurnId: "reaction", roomId: "room", content: "New content",
                                             sender: .init(id: "user_1", name: "Me", email: "me@example.com", presence: .online)))
    source.id = "message"
    return source
  }

  private func waitForRequests(_ count: Int, _ transport: ScriptedTransport) async {
    while transport.operationIDs.count < count {
      await Task.yield()
    }
  }

  @Test(arguments: [false, true])
  func reactionShowsBeforeCoreAnswersAndPreservesNewerContent(reply: Bool) async throws {
    let (state, auth, transport, _) = try ephemeralState([(200, reactionBody(ownThumbs, reply: reply))], visible: false)
    var source = reactionSource()
    state.timeline.reset(roomId: "room")
    if reply {
      var parent = source
      parent.id = "parent"
      state.timeline.messages = [parent]
      state.thread.open(parent)
      source.parentMessageId = parent.id
      state.thread.timeline.messages = [source]
    } else {
      state.timeline.messages = [source]
      state.thread.open(source)
    }
    transport.pauseReaction = true
    let toggle = Task { try await state.toggleReaction(source, emoji: "👍", auth: auth) }
    await waitForRequests(1, transport)
    let shown = reply ? state.displayedThreadReplies.first : state.displayedTranscript.first
    #expect(shown?.reactions.first?.count == 1)
    #expect(shown?.reactions.first?.reactedByCurrentUser == true)
    // Confirmed rows stay untouched until Core answers.
    #expect((reply ? state.thread.timeline.messages.first : state.timeline.messages.first)?.reactions.isEmpty == true)
    if !reply {
      #expect(state.displayedThreadParent?.reactions.first?.reactedByCurrentUser == true)
    }
    transport.releasePausedRequest()
    #expect(try await toggle.value)
    #expect(transport.operationIDs == ["put/chats/rooms/{id}/messages/{messageId}/reactions/{emoji}"])
    let updated = reply ? state.thread.timeline.messages.first : state.timeline.messages.first
    #expect(updated?.content == "New content")
    #expect(updated?.reactions.first?.count == 1)
    #expect(updated?.reactions.first?.reactedByCurrentUser == true)
    #expect(state.pendingReactions.intents.isEmpty)
    #expect((reply ? state.displayedThreadReplies.first : state.displayedTranscript.first) == updated)
    if !reply {
      #expect(state.thread.parent?.reactions.first?.count == 1)
    }
  }

  @Test func lastReactionTapWinsWithOneRequestAtATime() async throws {
    let (state, auth, transport, _) = try ephemeralState([(200, reactionBody(ownThumbs)), (200, reactionBody(""))], visible: false)
    let source = reactionSource()
    state.timeline.reset(roomId: "room")
    state.timeline.messages = [source]
    transport.pauseReaction = true
    let toggle = Task { try await state.toggleReaction(source, emoji: "👍", auth: auth) }
    await waitForRequests(1, transport)
    // On, off, on, off while the PUT is out: every tap shows at once and none sends.
    for expected in [false, true, false] {
      #expect(try await state.toggleReaction(source, emoji: "👍", auth: auth) == false)
      #expect(state.displayedTranscript.first?.reactions.isEmpty == !expected)
    }
    #expect(transport.operationIDs.count == 1)
    transport.releasePausedRequest()
    await waitForRequests(2, transport)
    // The PUT is confirmed underneath, yet the row still shows the newest intent.
    #expect(state.timeline.messages.first?.reactions.first?.reactedByCurrentUser == true)
    #expect(state.displayedTranscript.first?.reactions.isEmpty == true)
    transport.releasePausedRequest()
    #expect(try await toggle.value == false)
    #expect(transport.operationIDs == [
      "put/chats/rooms/{id}/messages/{messageId}/reactions/{emoji}",
      "delete/chats/rooms/{id}/messages/{messageId}/reactions/{emoji}"
    ])
    #expect(state.timeline.messages.first?.reactions.isEmpty == true)
    #expect(state.pendingReactions.intents.isEmpty)
  }

  @Test func reversedTapsEndingOnTheSentIntentSendNothingMore() async throws {
    let (state, auth, transport, _) = try ephemeralState([(200, reactionBody(ownThumbs))], visible: false)
    let source = reactionSource()
    state.timeline.reset(roomId: "room")
    state.timeline.messages = [source]
    transport.pauseReaction = true
    let toggle = Task { try await state.toggleReaction(source, emoji: "👍", auth: auth) }
    await waitForRequests(1, transport)
    try await state.toggleReaction(source, emoji: "👍", auth: auth)
    try await state.toggleReaction(source, emoji: "👍", auth: auth)
    transport.releasePausedRequest()
    #expect(try await toggle.value)
    #expect(transport.operationIDs.count == 1)
    #expect(state.displayedTranscript.first?.reactions.first?.reactedByCurrentUser == true)
  }

  @Test func pendingReactionStaysOnTopOfRealtimePatchAndFailureRollsBackOnlyThatEmoji() async throws {
    let (state, auth, transport, _) = try ephemeralState([(500, "{\"message\":\"Could not update reaction.\"}"), (200, reactionBody(""))], visible: false)
    var source = reactionSource()
    source.reactions = [.init(emoji: "🎉", count: 1, reactedByCurrentUser: true, reactors: [])]
    state.timeline.reset(roomId: "room")
    state.timeline.messages = [source]
    transport.pauseReaction = true
    let failing = Task { try await state.toggleReaction(source, emoji: "👍", auth: auth) }
    await waitForRequests(1, transport)
    // A second emoji on the same message has its own request.
    let removing = Task { try await state.toggleReaction(source, emoji: "🎉", auth: auth) }
    await waitForRequests(2, transport)
    let heart = Components.Schemas.ChatRoomMessageReaction(emoji: "❤️", count: 1, reactedByCurrentUser: false, reactors: [.init(id: "user_2", name: "Ada")])
    state.applyRealtimeMessagePatch(.init(roomId: "room", messageId: "message", parentMessageId: nil,
                                          value: .reactions([heart, source.reactions[0]])))
    #expect(state.timeline.messages.first?.reactions.map(\.emoji) == ["❤️", "🎉"])
    #expect(state.displayedTranscript.first?.reactions.map(\.emoji) == ["❤️", "👍"])
    transport.releasePausedRequest()
    await #expect(throws: (any Error).self) { try await failing.value }
    // Only 👍 rolled back: the 🎉 removal is still shown, and confirmed rows never moved.
    #expect(state.pendingReactions.intents == [.init(messageId: "message", emoji: "🎉", reacted: false)])
    #expect(state.displayedTranscript.first?.reactions == [heart])
    #expect(state.timeline.messages.first?.reactions.map(\.emoji) == ["❤️", "🎉"])
    #expect(state.timeline.messages.first?.content == "New content")
    transport.releasePausedRequest()
    #expect(try await removing.value == false)
    #expect(state.timeline.messages.first?.reactions == [heart])
    #expect(state.pendingReactions.intents.isEmpty)
  }

  @Test func reactionRequestOutlivesLeavingTheRoom() async throws {
    let (state, auth, transport, _) = try ephemeralState([(200, reactionBody(ownThumbs))], visible: false)
    let source = reactionSource()
    state.timeline.reset(roomId: "room")
    state.timeline.messages = [source]
    transport.pauseReaction = true
    let toggle = Task { try await state.toggleReaction(source, emoji: "👍", auth: auth) }
    await waitForRequests(1, transport)
    state.timeline.reset(roomId: "other")
    #expect(state.displayedTranscript.isEmpty)
    // Back mid-request: the refreshed page predates the reaction, the intent still shows.
    state.timeline.reset(roomId: "room")
    state.timeline.messages = [source]
    #expect(state.displayedTranscript.first?.reactions.first?.reactedByCurrentUser == true)
    transport.releasePausedRequest()
    #expect(try await toggle.value)
    #expect(state.pendingReactions.intents.isEmpty)
    #expect(state.timeline.messages.first?.reactions.first?.reactedByCurrentUser == true)
  }

  @Test func failedReactionAfterLeavingTheRoomStillReportsAndClears() async throws {
    let (state, auth, transport, _) = try ephemeralState([(403, "{\"message\":\"Denied\"}")], visible: false)
    let source = reactionSource()
    state.timeline.reset(roomId: "room")
    state.timeline.messages = [source]
    transport.pauseReaction = true
    let toggle = Task { try await state.toggleReaction(source, emoji: "👍", auth: auth) }
    await waitForRequests(1, transport)
    state.timeline.reset(roomId: "other")
    transport.releasePausedRequest()
    await #expect(throws: (any Error).self) { try await toggle.value }
    #expect(state.timeline.messages.isEmpty)
    #expect(state.pendingReactions.intents.isEmpty)
  }
}

extension WorkspaceStateTests {
  @Test func messagePinStatusDoesNotDependOnLoadedPinPages() async throws {
    let body = transcriptMessage(id: "pin", roomId: "room", content: "Pinned")
      .replacingOccurrences(of: "\"editedAt\":null", with: "\"editedAt\":null,\"pinnedAt\":\"\(timestamp)\"")
    let (state, auth, transport, _) = try ephemeralState([
      (200, transcriptPageBody(messages: [body], nextCursor: nil))
    ], visible: false)
    state.timeline.reset(roomId: "room")
    try await state.timeline.loadPage(.initial, client: #require(state.resolveClient(auth: auth)),
                                      organizationSlug: nil, generation: state.timeline.generation)
    var message = try #require(state.timeline.messages.first)
    #expect(message.pinnedAt != nil)
    #expect(transport.operationIDs == ["get/chats/rooms/{id}/messages"])
    #expect(state.pins.items.isEmpty)
    #expect(state.isPinned(message))
    state.timeline.applyPin(roomId: "room", messageId: message.id, isPinned: false)
    #expect(!state.isPinned(message))
    message.pinnedAt = nil
    state.timeline.applyPin(roomId: "room", messageId: message.id, isPinned: true)
    #expect(state.isPinned(message))
    state.applyRealtimeEnvelope(.init(eventType: .delete, messageId: message.id, roomId: "room"))
    let deletedMessage = try #require(state.timeline.messages.first)
    #expect(deletedMessage.deletedAt != nil)
    #expect(!state.isPinned(deletedMessage))
    #expect(state.pins.items.isEmpty)
    state.timeline.reset(roomId: "other")
    #expect(!state.isPinned(message))
  }

  @Test func pinMutationsUpdateOnlyAfterSuccess() async throws {
    let (state, auth, transport, _) = try ephemeralState([
      (200, roomsBody(names: ["general"])),
      (200, #"{"data":{"messageId":"message","pinnedMessageCount":1},"meta":{"timestamp":"2026-01-01T00:00:00.000Z","requestId":"req"}}"#),
      (403, #"{"message":"Denied"}"#)
    ], visible: false)
    state.rooms = try await ChatService().listRooms(client: #require(state.resolveClient(auth: auth)), organizationSlug: nil)
    let room = try #require(state.rooms.first)
    state.timeline.reset(roomId: room.id)
    state.pins.reset(roomId: room.id)
    var message = chatRoomMessage(from: .init(clientTurnId: "pin", roomId: room.id, content: "Pinned",
                                              sender: .init(id: "user_1", name: "Me", email: "me@example.com", presence: .online)))
    message.id = "message"
    try await state.setPinned(true, messageId: "message", auth: auth)
    #expect(state.isPinned(message))
    #expect(state.rooms.first?.pinnedMessageCount == 1)
    await #expect(throws: (any Error).self) { try await state.setPinned(false, messageId: "message", auth: auth) }
    #expect(state.isPinned(message))
    #expect(!state.isUpdatingPin("message"))
    #expect(transport.operationIDs.last == "delete/chats/rooms/{id}/messages/{messageId}/pin")
  }

  @Test func oldPinMutationCannotUpdateNewRoom() async throws {
    let (state, auth, transport, _) = try ephemeralState([
      (200, roomsBody(names: ["general"])),
      (200, #"{"data":{"messageId":"message","pinnedMessageCount":0},"meta":{"timestamp":"2026-01-01T00:00:00.000Z","requestId":"req"}}"#)
    ], visible: false)
    state.rooms = try await ChatService().listRooms(client: #require(state.resolveClient(auth: auth)), organizationSlug: nil)
    let room = try #require(state.rooms.first)
    state.timeline.reset(roomId: room.id)
    state.pins.reset(roomId: room.id)
    transport.pauseDELETE = true
    let request = Task { try await state.setPinned(false, messageId: "message", auth: auth) }
    while transport.operationIDs.count < 2 {
      await Task.yield()
    }
    #expect(state.isUpdatingPin("message"))
    state.clearTranscript()
    state.timeline.reset(roomId: "other")
    transport.releasePausedRequest()
    try await request.value
    #expect(state.timeline.pinOverrides.isEmpty)
    #expect(!state.isUpdatingPin("message"))
  }

  @Test func historicalWindowRetainsLiveHeadWithoutMarkingRead() async throws {
    let (state, auth, _, _) = try ephemeralState([
      (200, transcriptPageBody(messages: [transcriptMessage(id: "old", roomId: "room", content: "Old")], nextCursor: nil))
    ], visible: false)
    state.timeline.reset(roomId: "room")
    #expect(try await state.jumpToMessage("old", auth: auth))
    #expect(!state.roomHistoryReadable)
    var live = try #require(state.timeline.messages.first)
    live.id = "new"
    state.applyRealtimeMessage(roomId: "room", eventType: .create, message: live)
    #expect(Set(state.displayedTranscript.map(\.id)) == ["old", "new"])
    live.id = "old"
    live.content = "Edited live"
    state.applyRealtimeMessage(roomId: "room", eventType: .update, message: live)
    #expect(state.displayedTranscript.first(where: { $0.id == "old" })?.content == "Edited live")
  }

  @Test func directSendFromHistoryReturnsToLatestBeforeStreaming() async throws {
    let room = coworkerDirect(roomId: "room")
    let (state, auth, transport, _) = try ephemeralState([
      (200, transcriptPageBody(messages: [transcriptMessage(id: "old", roomId: room.id, content: "Old")], nextCursor: nil)),
      (500, #"{"message":"Unavailable"}"#),
      (500, #"{"message":"Unavailable"}"#)
    ], visible: false)
    state.rooms = [room]
    state.timeline.reset(roomId: room.id)
    state.directStream.reset(room: room)
    #expect(try await state.jumpToMessage("old", auth: auth))
    #expect(state.sendMessage("New message", auth: auth))
    #expect(state.timeline.historicalAnchor == nil)
    #expect(state.directStream.isBusy)
    #expect(state.outboundShells.isEmpty)
    await waitForTranscriptIdle(state)
    await state.directStream.task?.value
    #expect(!transport.operationIDs.contains("post/chats/rooms/{id}/messages"))
  }

  @Test func sendingFromHistoryPreservesLoadedRowsAndPendingPinMutation() async throws {
    let roomId = "550e8400-e29b-41d4-a716-446655440000"
    let (state, auth, transport, _) = try ephemeralState([
      (200, roomsBody(names: ["general"])),
      (200, transcriptPageBody(messages: [transcriptMessage(id: "old", roomId: roomId, content: "Old")], nextCursor: nil)),
      (200, #"{"data":{"messageId":"old","pinnedMessageCount":0},"meta":{"timestamp":"2026-01-01T00:00:00.000Z","requestId":"req"}}"#),
      (500, #"{"message":"Unavailable"}"#),
      (500, #"{"message":"Unavailable"}"#)
    ], visible: false)
    state.rooms = try await ChatService().listRooms(client: #require(state.resolveClient(auth: auth)), organizationSlug: nil)
    state.timeline.reset(roomId: roomId)
    state.pins.reset(roomId: roomId)
    #expect(try await state.jumpToMessage("old", auth: auth))
    transport.pauseDELETE = true
    let unpin = Task { try await state.setPinned(false, messageId: "old", auth: auth) }
    while transport.operationIDs.count < 3 {
      await Task.yield()
    }
    let revision = state.pins.revision
    #expect(state.sendMessage("New message", auth: auth))
    #expect(state.timeline.historicalAnchor == nil)
    #expect(state.isUpdatingPin("old"))
    #expect(state.pins.revision == revision)
    #expect(state.timeline.messages.map(\.id) == ["old"])
    transport.releasePausedRequest()
    try await unpin.value
    #expect(!state.isUpdatingPin("old"))
    await waitForTranscriptIdle(state)
    await waitForOutboundIdle(state)
    #expect(state.outboundShells.first?.content == "New message")
  }
}

extension WorkspaceStateTests {
  @Test(arguments: ["success", "failure", "switch"])
  func unfurlRemovalPreservesCurrentMessage(outcome: String) async throws {
    let response = transcriptMessage(id: "message", roomId: "room", content: "Old content")
    let (state, auth, transport, _) = try ephemeralState([
      (200, accessBody(gate: "ready")), (200, orgsBody), (200, userBody),
      (200, #"{"data":{"organizationId":null},"meta":{"timestamp":"2026-01-01T00:00:00.000Z","requestId":"req"}}"#),
      (200, roomsBody(names: [])),
      (outcome == "failure" ? 403 : 200, outcome == "failure" ? #"{"message":"Denied"}"# : "{\"data\":\(response),\"meta\":{\"timestamp\":\"\(timestamp)\",\"requestId\":\"req\"}}")
    ], visible: false)
    await state.reload(auth: auth)
    await waitForTranscriptIdle(state)
    state.timeline.reset(roomId: "room")
    var message = chatRoomMessage(from: .init(clientTurnId: "preview", roomId: "room", content: "New edit https://example.com", sender: .init(id: "user_1", name: "Me", email: "me@example.com", presence: .offline)))
    message.id = "message"
    message.unfurls = [.init(url: "https://example.com", title: "Example", description: "Preview")]
    state.timeline.messages = [message]
    #expect(state.thread.open(message))
    transport.pauseUnfurl = true
    let request = Task { try await state.removeUnfurl(message, url: "https://example.com", auth: auth) }
    while transport.operationIDs.last != "post/chats/rooms/{id}/messages/{messageId}/unfurls/remove" {
      await Task.yield()
    }
    #expect(state.timeline.messages.first?.unfurls?.count == 1)
    if outcome == "switch" {
      state.timeline.reset(roomId: "other")
    }
    transport.releasePausedRequest()
    if outcome == "failure" {
      await #expect(throws: (any Error).self) { try await request.value }
    } else {
      try await request.value
    }
    let requestBody = try #require(transport.bodies.last)
    #expect(try JSONDecoder().decode([String: String].self, from: requestBody) == ["url": "https://example.com"])
    if outcome == "switch" {
      #expect(state.timeline.messages.isEmpty)
    } else {
      #expect(state.timeline.messages.first?.content == message.content)
      #expect(state.timeline.messages.first?.unfurls?.count == (outcome == "failure" ? 1 : 0))
      #expect(state.thread.parent?.unfurls?.count == (outcome == "failure" ? 1 : 0))
    }
  }
}

@MainActor
extension WorkspaceStateTests {
  @Test func searchWithoutClientReportsFailureForTheSubmittedQuery() async {
    let state = WorkspaceState(clientProvider: { _ in nil })
    let auth = AuthState(configuration: nil, store: InMemoryTokenStore(), browser: StubOAuthBrowser(), restoreSession: false)
    state.timeline.reset(roomId: "room")
    let search = RoomSearch()
    await state.searchMessages("  matching  ", roomId: "room", search: search, auth: auth)
    #expect(search.query == "matching", "The view must show this failure instead of treating the query as pending.")
    #expect(search.errorMessage != nil)
    #expect(!search.isLoading)
  }

  @Test func searchReplyLoadsContextWithoutReplacingRecentReplies() async throws {
    let parentRow = transcriptMessage(id: "parent", roomId: "room", content: "Parent")
    let recent = transcriptMessage(id: "recent", roomId: "room", content: "Recent").replacingOccurrences(of: "\"parentMessageId\":null", with: "\"parentMessageId\":\"parent\"")
    let older = transcriptMessage(id: "old", roomId: "room", content: "Old").replacingOccurrences(of: "\"parentMessageId\":null", with: "\"parentMessageId\":\"parent\"")
    let (state, auth, transport, _) = try ephemeralState([
      (200, transcriptPageBody(messages: [parentRow], nextCursor: nil)),
      (200, transcriptPageBody(messages: [recent], nextCursor: "before-recent")),
      (200, transcriptPageBody(messages: [older], nextCursor: "before-old"))
    ], visible: false)
    defer { state.reset() }
    state.timeline.reset(roomId: "room")
    #expect(try await state.jumpToMessage("parent", auth: auth))
    var hit = try #require(state.transcriptMessages.first)
    hit.id = "old"
    hit.parentMessageId = "parent"
    #expect(try await state.openMessageReply(hit, auth: auth) == .opened)
    #expect(state.thread.parent?.id == "parent")
    #expect(state.thread.jumpTarget?.messageId == "old")
    #expect(Set(state.thread.timeline.messages.map(\.id)) == ["old", "recent"])
    #expect(state.thread.timeline.historyGapMessageIds == ["recent"])
    #expect(transport.operationIDs.filter { $0 == "get/chats/rooms/{id}/threads/{parentMessageId}/messages" }.count == 2)
  }

  /// Row 19a: the search hit still carries its old body, so the loaded thread row decides.
  @Test func searchReplyDeletedSinceTheSearchIsUnavailable() async throws {
    let parentRow = transcriptMessage(id: "parent", roomId: "room", content: "Parent")
    let deleted = transcriptMessage(id: "old", roomId: "room", content: "")
      .replacingOccurrences(of: "\"parentMessageId\":null", with: "\"parentMessageId\":\"parent\"")
      .replacingOccurrences(of: "\"deletedAt\":null", with: "\"deletedAt\":\"2026-01-02T00:00:00.000Z\"")
    let (state, auth, transport, _) = try ephemeralState([
      (200, transcriptPageBody(messages: [parentRow], nextCursor: nil)),
      (200, transcriptPageBody(messages: [deleted], nextCursor: nil))
    ], visible: false)
    defer { state.reset() }
    state.timeline.reset(roomId: "room")
    #expect(try await state.jumpToMessage("parent", auth: auth))
    var hit = try #require(state.transcriptMessages.first)
    hit.id = "old"
    hit.content = "Old"
    hit.parentMessageId = "parent"
    #expect(try await state.openMessageReply(hit, auth: auth) == .unavailable)
    let loaded = try #require(state.thread.timeline.messages.first { $0.id == "old" })
    #expect(!shouldKeepPersistedMessage(loaded))
    #expect(state.thread.jumpTarget == nil)
    #expect(state.displayedThreadReplies.isEmpty)
    #expect(transport.operationIDs.filter { $0 == "get/chats/rooms/{id}/threads/{parentMessageId}/messages" }.count == 1)
  }

  @Test func searchReplyCannotOpenAfterRoomSwitch() async throws {
    let (state, auth, transport, _) = try ephemeralState([
      (200, transcriptPageBody(messages: [transcriptMessage(id: "parent", roomId: "room", content: "Parent")], nextCursor: nil)),
      (200, """
      {"data":{"parentMessage":\(transcriptMessage(id: "parent", roomId: "room", content: "Parent")),"replyCount":1,"lastReplyAt":"\(timestamp)","unreadReplyCount":0,"lastUnreadReplyAt":null,"hasLooked":true},"meta":{"timestamp":"\(timestamp)","requestId":"test"}}
      """)
    ], visible: false)
    defer { state.reset() }
    state.timeline.reset(roomId: "room")
    #expect(try await state.jumpToMessage("parent", auth: auth))
    var hit = try #require(state.transcriptMessages.first)
    hit.id = "reply"
    hit.parentMessageId = "parent"
    state.timeline.reset(roomId: "room")
    transport.pauseGET = true
    let request = Task { try await state.openMessageReply(hit, auth: auth) }
    while transport.operationIDs.count < 2 {
      await Task.yield()
    }
    state.clearTranscript()
    state.timeline.reset(roomId: "other")
    transport.releasePausedRequest()
    #expect(try await request.value == .superseded)
    #expect(state.thread.parent == nil)
    #expect(state.thread.jumpTarget == nil)
  }

  @Test func messageLinkLoadsRoomContextAndRequestsHighlight() async throws {
    let (state, auth, _, _) = try ephemeralState([
      (200, createdMessageBody(id: "old", roomId: "room", content: "Old")),
      (200, transcriptPageBody(messages: [transcriptMessage(id: "old", roomId: "room", content: "Old")], nextCursor: nil))
    ], visible: false)
    defer { state.reset() }
    state.timeline.reset(roomId: "room")
    #expect(try await state.openMessage("old", auth: auth) == .opened)
    #expect(state.messageJump?.messageId == "old")
    #expect(state.messageJump?.roomId == "room")
    let first = state.messageJump?.requestId
    #expect(try await state.openMessage("old", auth: auth) == .opened)
    #expect(first != state.messageJump?.requestId)
  }

  @Test func messageLinkDoesNotNavigateAfterRoomSwitch() async throws {
    let (state, auth, transport, _) = try ephemeralState([
      (200, createdMessageBody(id: "old", roomId: "room", content: "Old"))
    ], visible: false)
    defer { state.reset() }
    state.timeline.reset(roomId: "room")
    transport.pauseGET = true
    let request = Task { try await state.openMessage("old", auth: auth) }
    while transport.operationIDs.isEmpty {
      await Task.yield()
    }
    state.clearTranscript()
    state.timeline.reset(roomId: "other")
    transport.releasePausedRequest()
    #expect(try await request.value == .superseded)
    #expect(state.messageJump == nil)
  }

  @Test(arguments: [403, 404]) func unreadableMessageLinkStopsWithoutContextRequest(status: Int) async throws {
    let (state, auth, transport, _) = try ephemeralState([
      (status, #"{"error":"Not Found","message":"Not found","meta":{"timestamp":"2026-01-01T00:00:00.000Z","requestId":"req-1","path":"/messages","method":"GET"}}"#)
    ], visible: false)
    defer { state.reset() }
    state.timeline.reset(roomId: "room")
    #expect(try await state.openMessage("missing", auth: auth) == .unavailable)
    #expect(state.messageJump == nil)
    #expect(transport.operationIDs.count == 1)
  }

  /// Row 19a: a quote or link to a deleted message has no row to land on, so it stops before the context load.
  @Test func deletedMessageLinkIsUnavailableWithoutContextRequest() async throws {
    let deleted = createdMessageBody(id: "gone", roomId: "room", content: "")
      .replacingOccurrences(of: "\"deletedAt\":null", with: "\"deletedAt\":\"2026-01-02T00:00:00.000Z\"")
    let (state, auth, transport, _) = try ephemeralState([(200, deleted)], visible: false)
    defer { state.reset() }
    state.timeline.reset(roomId: "room")
    #expect(try await state.openMessage("gone", auth: auth) == .unavailable)
    #expect(state.messageJump == nil)
    #expect(transport.operationIDs.count == 1)
  }

  @Test func realtimeDeleteDropsTheOpenRoomRow() throws {
    let (state, _, _, _) = try ephemeralState([], visible: false)
    defer { state.reset() }
    var first = chatRoomMessage(from: .init(clientTurnId: "first", roomId: "room", content: "First",
                                            sender: .init(id: "user_2", name: "Ada", email: "ada@example.com", presence: .online)))
    first.id = "first"
    var target = first
    target.id = "target"
    state.timeline.reset(roomId: "room")
    state.timeline.messages = [first, target]
    #expect(state.displayedTranscript.map(\.id) == ["first", "target"])
    state.applyRealtimeMessage(roomId: "room", eventType: .delete, message: tombstoneTranscriptMessage(target, now: Date(timeIntervalSince1970: 1_700_000_000)))
    #expect(state.displayedTranscript.map(\.id) == ["first"])
    #expect(state.transcriptMessages.map(\.id) == ["first", "target"])
  }

  @Test func messageLinkResolvesReplyOutsideLoadedHistory() async throws {
    let parent = transcriptMessage(id: "parent", roomId: "room", content: "Parent")
    let reply = transcriptMessage(id: "reply", roomId: "room", content: "Reply").replacingOccurrences(of: "\"parentMessageId\":null", with: "\"parentMessageId\":\"parent\"")
    let lookup = createdMessageBody(id: "reply", roomId: "room", content: "Reply").replacingOccurrences(of: "\"parentMessageId\":null", with: "\"parentMessageId\":\"parent\"")
    let (state, auth, _, _) = try ephemeralState([
      (200, transcriptPageBody(messages: [parent], nextCursor: nil)),
      (200, lookup),
      (200, transcriptPageBody(messages: [reply], nextCursor: nil))
    ], visible: false)
    defer { state.reset() }
    state.timeline.reset(roomId: "room")
    #expect(try await state.jumpToMessage("parent", auth: auth))
    #expect(try await state.openMessage("reply", auth: auth) == .opened)
    #expect(state.thread.parent?.id == "parent")
    #expect(state.thread.jumpTarget?.messageId == "reply")
  }

  @Test func newerMessageTargetWinsOverPausedLookup() async throws {
    let (state, auth, transport, _) = try ephemeralState([
      (200, transcriptPageBody(messages: [transcriptMessage(id: "new", roomId: "room", content: "New")], nextCursor: nil)),
      (200, createdMessageBody(id: "old", roomId: "room", content: "Old"))
    ], visible: false)
    defer { state.reset() }
    state.timeline.reset(roomId: "room")
    #expect(try await state.jumpToMessage("new", auth: auth))
    transport.pauseGET = true
    let old = Task { try await state.openMessage("old", auth: auth) }
    while transport.operationIDs.count < 2 {
      await Task.yield()
    }
    #expect(try await state.openMessage("new", auth: auth) == .opened)
    transport.releasePausedRequest()
    #expect(try await old.value == .superseded)
    #expect(state.messageJump?.messageId == "new")
    let request = try #require(state.messageJump?.requestId)
    state.consumeMessageJump(request)
    #expect(state.messageJump == nil)
  }

  @Test func unknownRoomLinkDoesNotChangeSelectionOrLoadHistory() async throws {
    let (state, auth, transport, _) = try ephemeralState([], visible: false)
    defer { state.reset() }
    let base = try #require(URL(string: "https://example.com"))
    let url = try #require(URL(string: "https://example.com/chat/rooms/unknown?message=old"))
    guard case let .room(roomId, messageId) = try #require(ChatLink(url: url, webBaseURL: base)) else { return }
    #expect(try await state.openRoomLink(roomId: roomId, messageId: messageId, auth: auth) == .unavailable)
    #expect(state.selectedRoomId == nil)
    #expect(transport.operationIDs.isEmpty)
  }

  @Test func chatLinkSelectsRoomAndWaitsForInitialHistory() async throws {
    let (state, auth, transport, _) = try ephemeralState([
      (200, transcriptPageBody(messages: [transcriptMessage(id: "target", roomId: "destination", content: "Target")], nextCursor: nil))
    ], visible: false)
    defer { state.reset() }
    var room = coworkerDirect(roomId: "destination")
    room.kind = .channel
    state.rooms = [room]
    let base = try #require(URL(string: "https://example.com"))
    let url = try #require(URL(string: "https://example.com/chat/rooms/destination?message=target"))
    guard case let .room(roomId, messageId) = try #require(ChatLink(url: url, webBaseURL: base)) else { return }
    #expect(try await state.openRoomLink(roomId: roomId, messageId: messageId, auth: auth) == .opened)
    #expect(state.selectedRoomId == "destination")
    #expect(state.messageJump?.messageId == "target")
    #expect(transport.operationIDs == ["get/chats/rooms/{id}/messages"])
  }

  @Test func chatLinkRoomSwitchIsSupersededNotUnavailable() async throws {
    let (state, auth, transport, _) = try ephemeralState([
      (200, transcriptPageBody(messages: [transcriptMessage(id: "target", roomId: "destination", content: "Target")], nextCursor: nil))
    ], visible: false)
    defer { state.reset() }
    var room = coworkerDirect(roomId: "destination")
    room.kind = .channel
    state.rooms = [room]
    let base = try #require(URL(string: "https://example.com"))
    let url = try #require(URL(string: "https://example.com/chat/rooms/destination?message=target"))
    guard case let .room(roomId, messageId) = try #require(ChatLink(url: url, webBaseURL: base)) else { return }
    transport.pauseGET = true
    let request = Task { try await state.openRoomLink(roomId: roomId, messageId: messageId, auth: auth) }
    while transport.operationIDs.isEmpty {
      await Task.yield()
    }
    state.clearTranscript()
    state.timeline.reset(roomId: "other")
    transport.releasePausedRequest()
    #expect(try await request.value == .superseded)
    #expect(state.messageJump == nil)
  }

  @Test func transientMessageLookupFallsBackToRoomContext() async throws {
    let (state, auth, _, _) = try ephemeralState([
      (500, #"{"error":"Internal Server Error","message":"Unavailable","meta":{"timestamp":"2026-01-01T00:00:00.000Z","requestId":"req-1","path":"/messages","method":"GET"}}"#),
      (200, transcriptPageBody(messages: [transcriptMessage(id: "target", roomId: "room", content: "Target")], nextCursor: nil))
    ], visible: false)
    defer { state.reset() }
    state.timeline.reset(roomId: "room")
    #expect(try await state.openMessage("target", auth: auth) == .opened)
    #expect(state.messageJump?.messageId == "target")
  }
}

private func invitationBody(id: String, roomId: String, status: String = "pending") -> String {
  """
  {"id":"\(id)","roomId":"\(roomId)","roomName":"Partners","organizationId":"org_2","organizationName":"Acme Partners","email":"me@example.com","status":"\(status)","inviter":{"id":"host","name":"Hannah"},"expiresAt":"\(timestamp)","createdAt":"\(timestamp)"}
  """
}

private func invitationEnvelope(_ data: String) -> String {
  """
  {"data":\(data),"meta":{"timestamp":"\(timestamp)","requestId":"req-1"}}
  """
}

extension WorkspaceStateTests {
  /// Web drops the pending row, re-lists rooms (the accept response carries no room) and navigates to the joined room.
  @Test func invitationAcceptListsRoomsAndOpensJoinedRoom() async throws {
    let general = "550e8400-e29b-41d4-a716-446655440000"
    let partners = "550e8400-e29b-41d4-a716-446655440001"
    let (state, auth, transport, _) = try ephemeralState([
      (200, accessBody(gate: "ready")), (200, orgsBody), (200, userBody),
      (200, #"{"data":{"organizationId":null},"meta":{"timestamp":"2026-01-01T00:00:00.000Z","requestId":"req-1"}}"#),
      (200, roomsBody(names: ["general"])),
      (200, transcriptPageBody(messages: [], nextCursor: nil)),
      (200, invitationEnvelope("[\(invitationBody(id: "inv-1", roomId: partners)),\(invitationBody(id: "inv-2", roomId: partners))]")),
      (404, #"{"error":"Not Found","message":"Invitation not found","meta":{"timestamp":"2026-01-01T00:00:00.000Z","requestId":"req-1","path":"/chats/invitations/x/accept","method":"POST"}}"#),
      (200, invitationEnvelope(invitationBody(id: "inv-1", roomId: partners, status: "accepted"))),
      (200, roomsBody(names: ["general", "partners"])),
      (200, transcriptPageBody(messages: [], nextCursor: nil)),
      (200, invitationEnvelope(invitationBody(id: "inv-2", roomId: partners, status: "declined")))
    ], visible: false)
    await state.reload(auth: auth)
    await waitForTranscriptIdle(state)
    #expect(state.transcriptRoomId == general)
    let context = state.compositionContext

    await state.loadPendingInvitations(auth: auth)
    #expect(state.pendingInvitations.invitations.map(\.id) == ["inv-1", "inv-2"])

    // Core's rejection surfaces and keeps the row; the response flag clears.
    await #expect(throws: ChatServiceError.unprocessable(statusCode: 404, message: "Invitation not found")) {
      try await state.acceptInvitation(id: "inv-1", context: context, auth: auth)
    }
    #expect(state.invitationResponse == nil && state.pendingInvitations.invitations.count == 2)

    #expect(try await state.acceptInvitation(id: "inv-1", context: context, auth: auth))
    await waitForTranscriptIdle(state)
    #expect(state.pendingInvitations.invitations.map(\.id) == ["inv-2"])
    #expect(state.rooms.map(\.id) == [general, partners])
    #expect(state.transcriptRoomId == partners)
    #expect(state.invitationResponse == nil)

    #expect(try await state.declineInvitation(id: "inv-2", context: context, auth: auth))
    #expect(state.pendingInvitations.invitations.isEmpty)
    #expect(state.transcriptRoomId == partners)
    #expect(transport.remainingStubs == 0)

    // A request from a previous workspace context never reaches Core.
    let sent = transport.operationIDs.count
    #expect(try await state.acceptInvitation(id: "inv-2", context: UUID(), auth: auth) == false)
    #expect(try await state.declineInvitation(id: "inv-2", context: UUID(), auth: auth) == false)
    #expect(transport.operationIDs.count == sent)
    #expect(transport.operationIDs.suffix(6) == [
      "get/chats/invitations", "post/chats/invitations/{id}/accept", "post/chats/invitations/{id}/accept",
      "get/chats/rooms", "get/chats/rooms/{id}/messages", "post/chats/invitations/{id}/decline"
    ])
    state.reset()
    #expect(state.pendingInvitations.invitations.isEmpty)
  }

  /// "Open channel" on an already-accepted card re-lists only when the room is missing locally, then opens it.
  @Test func invitationOpenChannelReListsMissingRoom() async throws {
    let general = "550e8400-e29b-41d4-a716-446655440000"
    let partners = "550e8400-e29b-41d4-a716-446655440001"
    let (state, auth, transport, _) = try ephemeralState([
      (200, accessBody(gate: "ready")), (200, orgsBody), (200, userBody),
      (200, #"{"data":{"organizationId":null},"meta":{"timestamp":"2026-01-01T00:00:00.000Z","requestId":"req-1"}}"#),
      (200, roomsBody(names: ["general"])),
      (200, transcriptPageBody(messages: [], nextCursor: nil)),
      (200, roomsBody(names: ["general", "partners"])),
      (200, transcriptPageBody(messages: [], nextCursor: nil)),
      (200, transcriptPageBody(messages: [], nextCursor: nil))
    ], visible: false)
    await state.reload(auth: auth)
    await waitForTranscriptIdle(state)
    #expect(state.transcriptRoomId == general)
    let context = state.compositionContext

    // A stale context never lists or navigates.
    let sent = transport.operationIDs.count
    await state.openInvitedRoom(partners, context: UUID(), auth: auth)
    #expect(transport.operationIDs.count == sent && state.transcriptRoomId == general)

    await state.openInvitedRoom(partners, context: context, auth: auth)
    await waitForTranscriptIdle(state)
    #expect(state.rooms.map(\.id) == [general, partners])
    #expect(state.transcriptRoomId == partners)

    // A listed room opens without another list request.
    await state.openInvitedRoom(general, context: context, auth: auth)
    await waitForTranscriptIdle(state)
    #expect(state.transcriptRoomId == general)
    #expect(transport.operationIDs.suffix(3) == ["get/chats/rooms", "get/chats/rooms/{id}/messages", "get/chats/rooms/{id}/messages"])
    #expect(transport.remainingStubs == 0)
  }

  /// Accepting from the invite sheet while the user already moved to another room must not pull them back.
  @Test func invitationAcceptRespectsNavigation() async throws {
    let general = "550e8400-e29b-41d4-a716-446655440000"
    let partners = "550e8400-e29b-41d4-a716-446655440001"
    let (state, auth, transport, _) = try ephemeralState([
      (200, accessBody(gate: "ready")), (200, orgsBody), (200, userBody),
      (200, #"{"data":{"organizationId":null},"meta":{"timestamp":"2026-01-01T00:00:00.000Z","requestId":"req-1"}}"#),
      (200, roomsBody(names: ["general", "design"])),
      (200, transcriptPageBody(messages: [], nextCursor: nil)),
      (200, invitationEnvelope(invitationBody(id: "inv-1", roomId: partners, status: "accepted"))),
      (200, transcriptPageBody(messages: [], nextCursor: nil)),
      (200, roomsBody(names: ["general", "design", "partners"]))
    ], visible: false)
    await state.reload(auth: auth)
    await waitForTranscriptIdle(state)
    #expect(state.transcriptRoomId == general)
    let context = state.compositionContext
    transport.pauseDirect = true
    let accept = Task { try await state.acceptInvitation(id: "inv-1", context: context, auth: auth) }
    for _ in 0 ..< 1000 where !transport.operationIDs.contains("post/chats/invitations/{id}/accept") {
      await Task.yield()
    }
    #expect(state.roomMutationInFlight)
    state.selectRoom("550e8400-e29b-41d4-a716-446655440001", auth: auth)
    await waitForTranscriptIdle(state)
    transport.releasePausedRequest()
    #expect(try await accept.value)
    await waitForTranscriptIdle(state)
    #expect(state.rooms.count == 3)
    #expect(state.transcriptRoomId == "550e8400-e29b-41d4-a716-446655440001")
    #expect(!state.roomMutationInFlight)
    #expect(transport.operationIDs.suffix(3) == ["post/chats/invitations/{id}/accept", "get/chats/rooms/{id}/messages", "get/chats/rooms"])
  }

  @Test func invitationResponseWaitsForOtherChannelMutations() async throws {
    let target = "550e8400-e29b-41d4-a716-446655440009"
    let (state, auth, transport, _) = try ephemeralState([
      (200, accessBody(gate: "ready")), (200, orgsBody), (200, userBody),
      (200, #"{"data":{"organizationId":"org_1"},"meta":{"timestamp":"2026-01-01T00:00:00.000Z","requestId":"req-1"}}"#),
      (200, roomsBody(names: ["general"])),
      (200, transcriptPageBody(messages: [], nextCursor: nil)),
      (200, roomReadBody(id: target, unread: 0)),
      (200, transcriptPageBody(messages: [], nextCursor: nil))
    ], visible: false)
    await state.reload(auth: auth)
    await waitForTranscriptIdle(state)
    let context = state.compositionContext
    transport.pauseDirect = true
    let join = Task { try await state.joinChannel(roomId: target, context: context, auth: auth) }
    for _ in 0 ..< 1000 where !transport.operationIDs.contains("post/chats/rooms/{id}/members/me") {
      await Task.yield()
    }
    #expect(try await state.acceptInvitation(id: "inv", context: context, auth: auth) == false)
    #expect(try await state.declineInvitation(id: "inv", context: context, auth: auth) == false)
    #expect(try await state.acceptGuestInviteLink(token: "tok", context: context, auth: auth) == false)
    transport.releasePausedRequest()
    #expect(try await join.value)
    await waitForTranscriptIdle(state)
    #expect(!transport.operationIDs.contains { $0.contains("invitations") || $0.contains("invite-links") })
  }

  /// Web's join page: a public preview, then a guest join that re-lists rooms and opens the room.
  @Test func guestLinkJoinOpensRoom() async throws {
    let general = "550e8400-e29b-41d4-a716-446655440000"
    let partners = "550e8400-e29b-41d4-a716-446655440001"
    let (state, auth, transport, _) = try ephemeralState([
      (200, accessBody(gate: "ready")), (200, orgsBody), (200, userBody),
      (200, #"{"data":{"organizationId":"org_1"},"meta":{"timestamp":"2026-01-01T00:00:00.000Z","requestId":"req-1"}}"#),
      (200, roomsBody(names: ["general"])),
      (200, transcriptPageBody(messages: [], nextCursor: nil)),
      (200, invitationEnvelope(#"{"status":"valid","room":{"id":"\#(partners)","name":"Partners","organizationId":"org_2","organizationName":"Acme Partners"}}"#)),
      (400, #"{"error":"Bad Request","message":"This invite link has expired.","meta":{"timestamp":"2026-01-01T00:00:00.000Z","requestId":"req-1","path":"/chat-room-invite-links/tok/accept","method":"POST"}}"#),
      (200, invitationEnvelope(#"{"status":"joined","roomId":"\#(partners)","roomName":"Partners"}"#)),
      (200, roomsBody(names: ["general", "partners"])),
      (200, transcriptPageBody(messages: [], nextCursor: nil))
    ], visible: false)
    await state.reload(auth: auth)
    await waitForTranscriptIdle(state)
    #expect(state.transcriptRoomId == general)
    let context = state.compositionContext
    let preview = try await state.resolveGuestInviteLink(token: "tok", context: context, auth: auth)
    #expect(preview.room?.name == "Partners")
    await #expect(throws: ChatServiceError.unprocessable(statusCode: 400, message: "This invite link has expired.")) {
      try await state.acceptGuestInviteLink(token: "tok", context: context, auth: auth)
    }
    #expect(state.invitationResponse == nil)
    #expect(try await state.acceptGuestInviteLink(token: "tok", context: context, auth: auth))
    await waitForTranscriptIdle(state)
    #expect(state.rooms.map(\.id) == [general, partners])
    #expect(state.transcriptRoomId == partners)
    #expect(transport.remainingStubs == 0)
    #expect(transport.operationIDs.suffix(5) == [
      "get/chat-room-invite-links/{token}", "post/chat-room-invite-links/{token}/accept", "post/chat-room-invite-links/{token}/accept",
      "get/chats/rooms", "get/chats/rooms/{id}/messages"
    ])
  }
}

private func externalRoomsBody(general: String, partners: String) -> String {
  let members = """
  [{"id":"user_1","name":"Me","email":"me@example.com","image":null,"presence":"online","access":"member"},{"id":"user_guest","name":"Guest","email":"guest@example.com","image":null,"presence":"offline","access":"guest"}]
  """
  func room(_ id: String, name: String, discoverability: String, members: String) -> String {
    """
    {"id":"\(id)","organizationId":"org_1","organizationName":"Acme","name":"\(name)","slug":"\(name)","kind":"channel","isSelfDirect":false,"directKey":null,"isGroupDirect":false,"groupName":null,"topic":null,"discoverability":"\(discoverability)","createdByUserId":"user_1","createdAt":"\(timestamp)","updatedAt":"\(timestamp)","unreadCount":0,"unreadMentionCount":0,"starredAt":null,"pinnedMessageCount":0,"mutedAt":null,"markedUnread":false,"myAccess":"member","peerInActiveOrganization":false,"userMembers":\(members),"coworkerMembers":[],"sokoBotMembers":[]}
    """
  }
  return """
  {"data":[\(room(general, name: "general", discoverability: "public", members: "[]")),\(room(partners, name: "partners", discoverability: "external", members: members))],"meta":{"timestamp":"\(timestamp)","requestId":"req-1","pagination":{"cursor":null,"limit":100,"total":2,"nextCursor":null}}}
  """
}

extension WorkspaceStateTests {
  /// Web's guest section lives in the channel settings dialog: invitations and links are room sub-resources under the
  /// organization header; removing a guest edits the room DTO in place without navigating.
  @Test func guestAccessOperationsUseOrganizationAndRemoveGuestInPlace() async throws {
    let general = "550e8400-e29b-41d4-a716-446655440000"
    let partners = "550e8400-e29b-41d4-a716-446655440001"
    let invitation = invitationEnvelope(#"{"id":"inv-1","roomId":"\#(partners)","roomName":"partners","organizationId":"org_1","organizationName":"Acme","email":"guest2@example.com","status":"pending","inviter":{"id":"user_1","name":"Me"},"expiresAt":"\#(timestamp)","createdAt":"\#(timestamp)"}"#)
    let link = invitationEnvelope(#"{"token":"tok","url":"https://app.sokosumi.com/chat/join/tok","roomId":"\#(partners)","createdAt":"\#(timestamp)","expiresAt":null,"revokedAt":null,"maxUses":null,"useCount":0}"#)
    let (state, auth, transport, _) = try ephemeralState([
      (200, accessBody(gate: "ready")), (200, orgsBody), (200, userBody),
      (200, #"{"data":{"organizationId":"org_1"},"meta":{"timestamp":"2026-01-01T00:00:00.000Z","requestId":"req-1"}}"#),
      (200, externalRoomsBody(general: general, partners: partners)),
      (200, transcriptPageBody(messages: [], nextCursor: nil)),
      (200, invitationEnvelope("[]")), (200, invitationEnvelope("[]")),
      (201, invitation),
      (204, ""),
      (201, link),
      (200, invitationEnvelope(#"{"ok":true}"#)),
      (200, invitationEnvelope(#"{"id":"\#(partners)","remainingUserMemberCount":1}"#))
    ], visible: false)
    await state.reload(auth: auth)
    await waitForTranscriptIdle(state)
    #expect(state.transcriptRoomId == general)
    let context = state.compositionContext

    let snapshot = try await state.loadGuestAccess(roomId: partners, context: context, auth: auth)
    #expect(snapshot.invitations.isEmpty && snapshot.links.isEmpty)
    #expect(try await state.inviteGuest(roomId: partners, email: "guest2@example.com", context: context, auth: auth).id == "inv-1")
    try await state.revokeGuestInvitation(roomId: partners, invitationId: "inv-1", context: context, auth: auth)
    #expect(try await state.createGuestInviteLink(roomId: partners, options: .init(expiresInDays: nil), context: context, auth: auth).token == "tok")
    try await state.revokeGuestInviteLink(roomId: partners, token: "tok", context: context, auth: auth)
    // "No expiry" reaches Core as an explicit null through the middleware the app also registers.
    let linkBodyData = try #require(transport.bodies.last(where: { !$0.isEmpty }))
    let linkBody = try #require(JSONSerialization.jsonObject(with: linkBodyData) as? [String: Any])
    #expect(linkBody.count == 1 && linkBody["expiresInDays"] is NSNull)

    #expect(try await state.removeGuest(roomId: partners, userId: "user_guest", context: UUID(), auth: auth) == false)
    #expect(try await state.removeGuest(roomId: partners, userId: "user_guest", context: context, auth: auth))
    #expect(!state.updatingRoom && state.transcriptRoomId == general)
    #expect(state.rooms.first { $0.id == partners }?.userMembers.map(\.id) == ["user_1"])
    #expect(transport.operationIDs.suffix(7) == [
      "get/chats/rooms/{id}/invitations", "get/chats/rooms/{id}/invite-links", "post/chats/rooms/{id}/invitations",
      "delete/chats/rooms/{id}/invitations/{invitationId}", "post/chats/rooms/{id}/invite-links",
      "delete/chats/rooms/{id}/invite-links/{token}", "delete/chats/rooms/{id}/members/{userId}"
    ])
    #expect(transport.remainingStubs == 0)
  }
}

// MARK: - Coworker mention retry (slice 37)

private let mentionRoomId = "550e8400-e29b-41d4-a716-446655440000"
private let mentionRetryOperation = "post/chats/rooms/{id}/messages/{messageId}/mentions/{mentionId}/retry"

private func mentionSourceJSON(id: String, senderId: String, status: String = "failed") -> String {
  """
  {"id":"\(id)","roomId":"\(mentionRoomId)","parentMessageId":null,"content":"@Elena hi","createdAt":"\(timestamp)","deletedAt":null,"editedAt":null,"sender":{"type":"user","user":{"id":"\(senderId)","name":"Me","email":"me@example.com","presence":"offline"}},"mentions":[{"id":"mention_1","coworkerId":"cow_1","sokoBotId":null,"status":"\(status)","responseMessageId":"shell"}],"reactions":[],"threadReplyCount":0,"threadLastReplyAt":null,"metadata":null,"quote":null,"membership":null,"unfurls":null}
  """
}

private func mentionShellJSON(id: String, parentMessageId: String?, metadata: String) -> String {
  let parentJSON = parentMessageId.map { "\"\($0)\"" } ?? "null"
  return """
  {"id":"\(id)","roomId":"\(mentionRoomId)","parentMessageId":\(parentJSON),"content":"","createdAt":"2026-01-01T00:00:01.000Z","deletedAt":null,"editedAt":null,"sender":{"type":"coworker","coworker":{"id":"cow_1","name":"Elena","slug":"elena","caption":null,"image":null,"presence":"online"}},"mentions":[],"reactions":[],"threadReplyCount":0,"threadLastReplyAt":null,"metadata":\(metadata),"quote":null,"membership":null,"unfurls":null}
  """
}

private let failedShellMetadata = #"{"mention_id":"mention_1","mention_failed":true,"in_reply_to_message_id":"source"}"#

private func coreRejection(status: String, message: String) -> String {
  #"{"error":"\#(status)","message":"\#(message)","meta":{"timestamp":"\#(timestamp)","requestId":"req-1","path":"/chats/rooms/x/messages/source/mentions/mention_1/retry","method":"POST"}}"#
}

private func envelope(_ data: String) -> String {
  #"{"data":\#(data),"meta":{"timestamp":"\#(timestamp)","requestId":"req-1"}}"#
}

/// Signed-in personal workspace with `general` open on `[source, shell]`, plus the retry replies.
@MainActor
private func mentionRetryFixture(sourceSenderId: String = "user_1", retryResponses: [(Int, String)]) async throws -> (WorkspaceState, AuthState, ScriptedTransport) { // swiftlint:disable:this large_tuple
  let (state, auth, transport, _) = try ephemeralState([
    (200, accessBody(gate: "ready")), (200, orgsBody), (200, userBody),
    (200, #"{"data":{"organizationId":null},"meta":{"timestamp":"2026-01-01T00:00:00.000Z","requestId":"req-1"}}"#),
    (200, roomsBody(names: ["general"])),
    (200, transcriptPageBody(messages: [mentionSourceJSON(id: "source", senderId: sourceSenderId), mentionShellJSON(id: "shell", parentMessageId: nil, metadata: failedShellMetadata)], nextCursor: nil))
  ] + retryResponses, visible: false)
  await state.reload(auth: auth)
  await waitForTranscriptIdle(state)
  #expect(state.transcriptRoomId == mentionRoomId)
  #expect(state.timeline.messages.map(\.id) == ["source", "shell"])
  return (state, auth, transport)
}

extension WorkspaceStateTests {
  @Test func retryEligibilityRejectsRowsWithoutAFailedMentionSource() async throws {
    let (state, _, _) = try await mentionRetryFixture(retryResponses: [])
    defer { state.reset() }
    let source = try #require(state.timeline.messages.first)
    let shell = try #require(state.timeline.messages.last)
    #expect(!state.canRetryMention(source))
    #expect(!state.canRetryMention(CoworkerMentionShell.retrying(shell, startedAt: source.createdAt)))

    var orphan = shell
    orphan.metadata = try .init(additionalProperties: ["mention_id": .init(unvalidatedValue: "mention_1"), "mention_failed": .init(unvalidatedValue: true)])
    #expect(!state.canRetryMention(orphan))
    state.timeline.messages = [shell]
    #expect(!state.canRetryMention(shell))
  }

  @Test(arguments: [false, true])
  func retryEligibilityFindsSourceOnlyInOpenThread(reply: Bool) async throws {
    let (state, _, _) = try await mentionRetryFixture(retryResponses: [])
    defer { state.reset() }
    var source = try #require(state.timeline.messages.first)
    let shell = try #require(state.timeline.messages.last)
    state.timeline.messages = [shell]
    var parent = source
    if reply {
      parent.id = "thread-parent"
      source.parentMessageId = parent.id
    }
    state.thread.open(parent)
    if reply {
      state.thread.timeline.messages = [source]
    }
    #expect(state.canRetryMention(shell))
    state.thread.close()
    #expect(!state.canRetryMention(shell))
  }

  @Test(arguments: [false, true])
  func retryMentionFlipsTheShellThenMergesTheSource(reply: Bool) async throws {
    let (state, auth, transport) = try await mentionRetryFixture(retryResponses: [(200, envelope(mentionSourceJSON(id: "source", senderId: "user_1", status: "pending")))])
    let source = try #require(state.timeline.messages.first)
    var shell = try #require(state.timeline.messages.last)
    if reply {
      // A shell under a thread parent: the parent is the mention source.
      state.thread.open(source)
      shell.parentMessageId = source.id
      state.thread.timeline.messages = [shell]
    }
    #expect(state.canRetryMention(shell))
    #expect(CoworkerMentionShell(message: shell) == .failed(mentionId: "mention_1", sourceMessageId: "source"))

    transport.pauseMentionRetry = true
    let now = Date(timeIntervalSince1970: 1_700_000_123.456)
    let retry = Task { try await state.retryMention(shell, auth: auth, now: now) }
    while !transport.operationIDs.contains(mentionRetryOperation) {
      await Task.yield()
    }
    let inFlight = reply ? state.thread.timeline.messages.first : state.timeline.messages.last
    #expect(try CoworkerMentionShell(message: #require(inFlight)) == .thinking(startedAt: now))
    #expect(try !canQuoteMessage(#require(inFlight)))
    #expect(state.pendingMentionRetries.count == 1)
    // A second click while the POST is in flight must not send another request.
    try await state.retryMention(shell, auth: auth)
    #expect(transport.operationIDs.filter { $0 == mentionRetryOperation }.count == 1)
    #expect(transport.operationIDs.last?.hasSuffix("/retry") == true)

    transport.releasePausedRequest()
    try await retry.value
    #expect(state.pendingMentionRetries.isEmpty)
    #expect(state.timeline.messages.first?.mentions.first?.status == .pending)
    if reply {
      #expect(state.thread.parent?.mentions.first?.status == .pending)
      #expect(try CoworkerMentionShell(message: #require(state.thread.timeline.messages.first))?.isThinking == true)
    } else {
      #expect(try CoworkerMentionShell(message: #require(state.timeline.messages.last))?.isThinking == true)
    }
    #expect(transport.remainingStubs == 0)
  }

  @Test func rejectedRetryRestoresTheFailedShellWithCoreReason() async throws {
    let (state, auth, transport) = try await mentionRetryFixture(retryResponses: [(409, coreRejection(status: "Conflict", message: "Mention is not failed"))])
    let shell = try #require(state.timeline.messages.last)
    transport.pauseMentionRetry = true
    let retry = Task { try await state.retryMention(shell, auth: auth) }
    while !transport.operationIDs.contains(mentionRetryOperation) {
      await Task.yield()
    }
    #expect(try CoworkerMentionShell(message: #require(state.timeline.messages.last))?.isThinking == true)
    transport.releasePausedRequest()
    let error = await #expect(throws: ChatServiceError.self) { try await retry.value }
    #expect(error == .unprocessable(statusCode: 409, message: "Mention is not failed"))
    #expect(try friendlyMessage(for: #require(error)) == "Core rejected the request (409): Mention is not failed")
    #expect(try CoworkerMentionShell(message: #require(state.timeline.messages.last)) == .failed(mentionId: "mention_1", sourceMessageId: "source"))
    #expect(state.pendingMentionRetries.isEmpty)
    #expect(state.canRetryMention(shell))
  }

  @Test func retryResultAfterRoomChangeIsDropped() async throws {
    let (state, auth, transport) = try await mentionRetryFixture(retryResponses: [(403, coreRejection(status: "Forbidden", message: "You can only retry mentions you authored"))])
    let shell = try #require(state.timeline.messages.last)
    transport.pauseMentionRetry = true
    let retry = Task { try await state.retryMention(shell, auth: auth) }
    while !transport.operationIDs.contains(mentionRetryOperation) {
      await Task.yield()
    }
    state.timeline.reset(roomId: "other")
    transport.releasePausedRequest()
    try await retry.value
    #expect(state.timeline.messages.isEmpty)
    #expect(state.pendingMentionRetries.isEmpty)
    #expect(!state.canRetryMention(shell))
  }

  @Test func retryIsHiddenFromOtherMembers() async throws {
    let (state, auth, transport) = try await mentionRetryFixture(sourceSenderId: "user_2", retryResponses: [])
    let shell = try #require(state.timeline.messages.last)
    #expect(!state.canRetryMention(shell))
    #expect(CoworkerMentionShell(message: shell) == .failed(mentionId: "mention_1", sourceMessageId: "source"))
    // The coordinator still refuses a source it cannot see, without a request.
    var orphan = shell
    orphan.metadata = try .init(additionalProperties: ["mention_id": .init(unvalidatedValue: "mention_1"), "mention_failed": .init(unvalidatedValue: true)])
    try await state.retryMention(orphan, auth: auth)
    #expect(!transport.operationIDs.contains(mentionRetryOperation))
  }
}

extension WorkspaceStateTests {
  @Test func canSendToSelfHidesInsideSelfDirectAndOnLocalRows() throws {
    let (state, _, _, _) = try ephemeralState([])
    defer { state.reset() }
    let roomId = "550e8400-e29b-41d4-a716-446655440000"
    var room = coworkerDirect(roomId: roomId)
    state.rooms = [room]
    #expect(state.canSendToSelf(durableRoomMessage(roomId: roomId)))
    room.isSelfDirect = true
    state.rooms = [room]
    #expect(!state.canSendToSelf(durableRoomMessage(roomId: roomId)))
    room.isSelfDirect = false
    state.rooms = [room]
    var stream = durableRoomMessage(roomId: roomId)
    stream.id = "stream:turn"
    #expect(!state.canSendToSelf(stream))
  }

  @Test func sendToSelfListsANewlyCreatedSelfDirectWithoutLeavingTheSourceRoom() async throws {
    let general = "550e8400-e29b-41d4-a716-446655440000"
    let you = "550e8400-e29b-41d4-a716-446655440001"
    let (state, auth, transport, _) = try ephemeralState([
      (200, accessBody(gate: "ready")),
      (200, orgsBody),
      (200, userBody),
      (200, #"{"data":{"organizationId":null},"meta":{"timestamp":"2026-01-01T00:00:00.000Z","requestId":"req-1"}}"#),
      (200, roomsBody(names: ["general"])),
      (200, transcriptPageBody(messages: [], nextCursor: nil)),
      (201, createdMessageBody(id: "saved", roomId: you, content: "")),
      (200, roomsBody(names: ["general", "You"])),
      // A send-to-self row has no body by design; its quote is what keeps it in the transcript (row 19a).
      (200, transcriptPageBody(messages: [
        transcriptMessage(id: "saved", roomId: you, content: "")
          .replacingOccurrences(of: "\"quote\":null", with: #""quote":{"messageId":"source","authorName":"Ada","snippet":"Keep","roomId":"550e8400-e29b-41d4-a716-446655440000"}"#)
      ], nextCursor: nil))
    ], visible: false)
    defer { state.reset() }
    await state.reload(auth: auth)
    await waitForTranscriptIdle(state)
    #expect(state.rooms.map(\.id) == [general])
    let saved = try await state.sendMessageToSelf(durableRoomMessage(roomId: general), auth: auth)
    #expect(saved.roomId == you)
    #expect(state.rooms.map(\.id) == [general, you])
    #expect(state.selectedRoomId == general)
    #expect(try await state.openRoomLink(roomId: you, messageId: saved.id, auth: auth) == .opened)
    #expect(transport.operationIDs.suffix(3) == [
      "post/chats/rooms/{id}/messages/{messageId}/send-to-self",
      "get/chats/rooms",
      "get/chats/rooms/{id}/messages"
    ])
  }

  @Test func sendToSelfSkipsRoomRefreshWhenSelfDirectIsAlreadyListed() async throws {
    let general = "550e8400-e29b-41d4-a716-446655440000"
    let you = "550e8400-e29b-41d4-a716-446655440001"
    let (state, auth, transport, _) = try ephemeralState([
      (200, accessBody(gate: "ready")),
      (200, orgsBody),
      (200, userBody),
      (200, #"{"data":{"organizationId":null},"meta":{"timestamp":"2026-01-01T00:00:00.000Z","requestId":"req-1"}}"#),
      (200, roomsBody(names: ["general", "You"])),
      (200, transcriptPageBody(messages: [], nextCursor: nil)),
      (201, createdMessageBody(id: "saved", roomId: you, content: ""))
    ], visible: false)
    defer { state.reset() }
    await state.reload(auth: auth)
    await waitForTranscriptIdle(state)
    _ = try await state.sendMessageToSelf(durableRoomMessage(roomId: general), auth: auth)
    #expect(state.rooms.map(\.id) == [general, you])
    #expect(state.selectedRoomId == general)
    #expect(transport.operationIDs.last == "post/chats/rooms/{id}/messages/{messageId}/send-to-self")
    #expect(transport.remainingStubs == 0)
  }
}

private func durableRoomMessage(roomId: String) -> Components.Schemas.ChatRoomMessage {
  var message = chatRoomMessage(from: .init(
    clientTurnId: "turn",
    roomId: roomId,
    content: "Keep this",
    sender: .init(id: "user_1", name: "Me", email: "me@example.com", presence: .online)
  ))
  message.id = "550e8400-e29b-41d4-a716-446655440123"
  return message
}

private let sokoBotFeedbackOperation = "sendMySokoBotTurnFeedback"
private let sokoBotTurnId = "550e8400-e29b-41d4-a716-446655440777"

/// Signed-in personal workspace with no rooms, plus the feedback replies.
@MainActor
private func sokoBotFeedbackFixture(_ responses: [(Int, String)]) async throws -> (WorkspaceState, AuthState, ScriptedTransport) { // swiftlint:disable:this large_tuple
  let (state, auth, transport, _) = try ephemeralState([
    (200, accessBody(gate: "ready")), (200, orgsBody), (200, userBody),
    (200, #"{"data":{"organizationId":null},"meta":{"timestamp":"2026-01-01T00:00:00.000Z","requestId":"req-1"}}"#),
    (200, roomsBody(names: []))
  ] + responses, visible: false)
  await state.reload(auth: auth)
  #expect(state.currentUserId == "user_1")
  return (state, auth, transport)
}

extension WorkspaceStateTests {
  @Test(arguments: [true, false])
  func sokoBotFeedbackIsSentOncePerTurn(useful: Bool) async throws {
    let (state, auth, transport) = try await sokoBotFeedbackFixture([(200, envelope(#"{"useful":\#(useful)}"#))])
    #expect(state.sokoBotFeedback(forTurn: sokoBotTurnId) == nil)
    transport.pauseSokoBotFeedback = true
    let send = Task { try await state.sendSokoBotFeedback(turnId: sokoBotTurnId, useful: useful, auth: auth) }
    while !transport.operationIDs.contains(sokoBotFeedbackOperation) {
      await Task.yield()
    }
    #expect(state.isSendingSokoBotFeedback(forTurn: sokoBotTurnId))
    // A second tap while the POST is in flight sends nothing.
    try await state.sendSokoBotFeedback(turnId: sokoBotTurnId, useful: !useful, auth: auth)
    #expect(transport.operationIDs.filter { $0 == sokoBotFeedbackOperation }.count == 1)
    transport.releasePausedRequest()
    try await send.value
    let bodyIndex = try #require(transport.operationIDs.firstIndex(of: sokoBotFeedbackOperation))
    #expect(try JSONSerialization.jsonObject(with: transport.bodies[bodyIndex]) as? [String: Bool] == ["useful": useful])
    #expect(!state.isSendingSokoBotFeedback(forTurn: sokoBotTurnId))
    #expect(state.sokoBotFeedback(forTurn: sokoBotTurnId) == useful)
    // Rated turns stay rated: web hides the thumbs after one answer.
    try await state.sendSokoBotFeedback(turnId: sokoBotTurnId, useful: !useful, auth: auth)
    #expect(transport.operationIDs.filter { $0 == sokoBotFeedbackOperation }.count == 1)
    #expect(state.sokoBotFeedback(forTurn: sokoBotTurnId) == useful)
    #expect(transport.remainingStubs == 0)
    state.reset()
    #expect(state.sokoBotFeedback(forTurn: sokoBotTurnId) == nil)
  }

  @Test func rejectedSokoBotFeedbackLeavesTheTurnUnrated() async throws {
    let (state, auth, transport) = try await sokoBotFeedbackFixture([
      (404, #"{"error":"Not Found","message":"Turn not found","meta":{"timestamp":"\#(timestamp)","requestId":"req-1","path":"/soko-bots/me/turns/x/feedback","method":"POST"}}"#),
      (200, envelope(#"{"useful":true}"#))
    ])
    let error = await #expect(throws: ChatServiceError.self) {
      try await state.sendSokoBotFeedback(turnId: sokoBotTurnId, useful: true, auth: auth)
    }
    #expect(error == .unprocessable(statusCode: 404, message: "Turn not found"))
    #expect(state.sokoBotFeedback(forTurn: sokoBotTurnId) == nil)
    #expect(!state.isSendingSokoBotFeedback(forTurn: sokoBotTurnId))
    // The thumbs come back, so the owner can try again.
    try await state.sendSokoBotFeedback(turnId: sokoBotTurnId, useful: true, auth: auth)
    #expect(state.sokoBotFeedback(forTurn: sokoBotTurnId) == true)
    #expect(transport.operationIDs.filter { $0 == sokoBotFeedbackOperation }.count == 2)
    #expect(transport.remainingStubs == 0)
  }

  @Test func sokoBotFeedbackResultAfterSignOutIsDropped() async throws {
    let (state, auth, transport) = try await sokoBotFeedbackFixture([(200, envelope(#"{"useful":true}"#))])
    transport.pauseSokoBotFeedback = true
    let send = Task { try await state.sendSokoBotFeedback(turnId: sokoBotTurnId, useful: true, auth: auth) }
    while !transport.operationIDs.contains(sokoBotFeedbackOperation) {
      await Task.yield()
    }
    state.reset()
    transport.releasePausedRequest()
    try await send.value
    #expect(state.sokoBotFeedback(forTurn: sokoBotTurnId) == nil)
    #expect(!state.isSendingSokoBotFeedback(forTurn: sokoBotTurnId))
  }
}

private let preferencesReadOperation = "get/users/{id}/preferences"
private let preferencesWriteOperation = "patch/users/{id}/preferences"

private func chatDisplayBody(showRoomUnreadCount: Bool) -> String {
  envelope(#"{"marketingOptIn":false,"notificationsOptIn":false,"pushOptIn":false,"showRoomUnreadCount":\#(showRoomUnreadCount),"notificationPreferences":[]}"#)
}

private func chatDisplayError(status: String, message: String) -> String {
  #"{"error":"\#(status)","message":"\#(message)","meta":{"timestamp":"\#(timestamp)","requestId":"req-1","path":"/users/me/preferences","method":"PATCH"}}"#
}

extension WorkspaceStateTests {
  @Test func chatDisplayPreferenceLoadsWritesAndClearsOnReset() async throws {
    let (state, auth, transport) = try await sokoBotFeedbackFixture([
      (200, chatDisplayBody(showRoomUnreadCount: false)),
      (200, chatDisplayBody(showRoomUnreadCount: true)),
      (200, chatDisplayBody(showRoomUnreadCount: true))
    ])
    await state.refreshChatDisplayPreferences(auth: auth)
    #expect(!state.chatDisplay.showsRoomUnreadCount)
    try await state.setShowsRoomUnreadCount(true, auth: auth)
    #expect(state.chatDisplay.showsRoomUnreadCount && !state.chatDisplay.isSaving)
    let bodyIndex = try #require(transport.operationIDs.firstIndex(of: preferencesWriteOperation))
    #expect(try JSONSerialization.jsonObject(with: transport.bodies[bodyIndex]) as? [String: Bool] == ["showRoomUnreadCount": true])
    // A later read (room open, Settings) keeps following Core.
    await state.refreshChatDisplayPreferences(auth: auth)
    #expect(state.chatDisplay.showsRoomUnreadCount)
    #expect(transport.operationIDs.filter { $0 == preferencesReadOperation }.count == 2)
    #expect(transport.remainingStubs == 0)
    state.reset()
    #expect(!state.chatDisplay.showsRoomUnreadCount)
  }

  @Test func rejectedChatDisplayWriteRollsBackAndRethrows() async throws {
    let (state, auth, transport) = try await sokoBotFeedbackFixture([
      (200, chatDisplayBody(showRoomUnreadCount: true)),
      (403, chatDisplayError(status: "Forbidden", message: "Not allowed"))
    ])
    await state.refreshChatDisplayPreferences(auth: auth)
    let error = await #expect(throws: ChatServiceError.self) {
      try await state.setShowsRoomUnreadCount(false, auth: auth)
    }
    #expect(error == .unprocessable(statusCode: 403, message: "Not allowed"))
    #expect(state.chatDisplay.showsRoomUnreadCount && !state.chatDisplay.isSaving)
    #expect(transport.remainingStubs == 0)
  }

  @Test func failedChatDisplayReadKeepsTheLastValue() async throws {
    let (state, auth, _) = try await sokoBotFeedbackFixture([
      (200, chatDisplayBody(showRoomUnreadCount: true)),
      (500, chatDisplayError(status: "Internal Server Error", message: "Boom"))
    ])
    await state.refreshChatDisplayPreferences(auth: auth)
    await state.refreshChatDisplayPreferences(auth: auth)
    #expect(state.chatDisplay.showsRoomUnreadCount)
  }
}

extension WorkspaceStateTests {
  /// A pasted Message link from another room becomes the quote, and the send
  /// carries its source room with no body of its own.
  @MainActor
  @Test func pastedMessageLinkQuotesAcrossRoomsAndSendsWithoutABody() async throws {
    let target = "550e8400-e29b-41d4-a716-446655440000"
    let source = "550e8400-e29b-41d4-a716-446655440001"
    let quoted = "550e8400-e29b-41d4-a716-446655440123"
    let (state, auth, transport, _) = try ephemeralState([
      (200, accessBody(gate: "ready")),
      (200, orgsBody),
      (200, userBody),
      (200, #"{"data":{"organizationId":null},"meta":{"timestamp":"2026-01-01T00:00:00.000Z","requestId":"req-1"}}"#),
      // Everyone in the target room also reads the source room, so the quote
      // may cross; "outsider" is in neither.
      (200, roomsBody(names: ["general", "random"], members: ["general": ["user_1"], "random": ["user_1", "peer"]])),
      (200, transcriptPageBody(messages: [], nextCursor: nil)),
      (200, roomReadBody(id: target, unread: 0)),
      (200, createdMessageBody(id: quoted, roomId: source, content: "Keep this")),
      (201, createdMessageBody(id: "550e8400-e29b-41d4-a716-446655440505", roomId: target, content: ""))
    ])
    await state.reload(auth: auth)
    await waitForTranscriptIdle(state)
    #expect(state.transcriptRoomId == target)

    let base = try #require(URL(string: "https://app.sokosumi.com"))
    let quote = try await #require(state.messageLinkQuote(
      pasted: "https://app.sokosumi.com/chat/rooms/\(source)?message=\(quoted)", roomId: target, webBaseURL: base, auth: auth
    ))
    #expect(quote.roomId == source)
    #expect(transport.operationIDs.contains("get/chats/rooms/{id}/messages/{messageId}"))

    #expect(state.sendMessage("", quote: quote, auth: auth))
    await waitForOutboundIdle(state)
    let body = try #require(transport.bodies.last)
    let json = try #require(try JSONSerialization.jsonObject(with: body) as? [String: Any])
    #expect((json["content"] as? String)?.isEmpty == true)
    #expect(json["quote"] as? [String: String] == ["messageId": quoted, "roomId": source])
  }

  /// The same link stays plain when the target room holds a reader who cannot
  /// follow it, so nothing is read and no quote is offered.
  @MainActor
  @Test func pastedMessageLinkStaysPlainForAReaderOutsideTheSourceRoom() async throws {
    let target = "550e8400-e29b-41d4-a716-446655440000"
    let source = "550e8400-e29b-41d4-a716-446655440001"
    let (state, auth, transport, _) = try ephemeralState([
      (200, accessBody(gate: "ready")),
      (200, orgsBody),
      (200, userBody),
      (200, #"{"data":{"organizationId":null},"meta":{"timestamp":"2026-01-01T00:00:00.000Z","requestId":"req-1"}}"#),
      (200, roomsBody(names: ["general", "random"], members: ["general": ["user_1", "outsider"], "random": ["user_1", "peer"]])),
      (200, transcriptPageBody(messages: [], nextCursor: nil)),
      (200, roomReadBody(id: target, unread: 0))
    ])
    await state.reload(auth: auth)
    await waitForTranscriptIdle(state)
    let base = try #require(URL(string: "https://app.sokosumi.com"))
    let link = "https://app.sokosumi.com/chat/rooms/\(source)?message=550e8400-e29b-41d4-a716-446655440123"
    #expect(await state.messageLinkQuote(pasted: link, roomId: target, webBaseURL: base, auth: auth) == nil)
    #expect(!transport.operationIDs.contains("get/chats/rooms/{id}/messages/{messageId}"))
  }

  /// Plain text is not a link, so nothing is read and the paste stays as typed.
  @MainActor
  @Test func plainTextPasteNeverReadsAMessage() async throws {
    let target = "550e8400-e29b-41d4-a716-446655440000"
    let (state, auth, transport, _) = try ephemeralState([
      (200, accessBody(gate: "ready")),
      (200, orgsBody),
      (200, userBody),
      (200, #"{"data":{"organizationId":null},"meta":{"timestamp":"2026-01-01T00:00:00.000Z","requestId":"req-1"}}"#),
      (200, roomsBody(names: ["general"])),
      (200, transcriptPageBody(messages: [], nextCursor: nil)),
      (200, roomReadBody(id: target, unread: 0))
    ])
    await state.reload(auth: auth)
    await waitForTranscriptIdle(state)
    let base = try #require(URL(string: "https://app.sokosumi.com"))
    #expect(await state.messageLinkQuote(pasted: "just words", roomId: target, webBaseURL: base, auth: auth) == nil)
    #expect(!transport.operationIDs.contains("get/chats/rooms/{id}/messages/{messageId}"))
  }
}

/// Row 04a: the history gap row loads itself once it is in view, keeps a failure on the row and reloads on Try again.
@MainActor
extension WorkspaceStateTests {
  private static let latestPage = (200, transcriptPageBody(messages: [transcriptMessage(id: "z", roomId: "room", content: "Latest")], nextCursor: "z"))
  private static let jumpWindow = (200, transcriptPageBody(messages: [transcriptMessage(id: "a", roomId: "room", content: "Pinned")], nextCursor: "a"))

  /// The latest page and a jump window with the history between them missing: one gap, on `z`.
  private func stateWithGap(_ responses: [(Int, String)]) async throws -> (WorkspaceState, AuthState, ScriptedTransport) { // swiftlint:disable:this large_tuple
    let (state, auth, transport, _) = try ephemeralState([Self.latestPage, Self.jumpWindow] + responses, visible: false)
    state.timeline.reset(roomId: "room")
    let client = try #require(state.resolveClient(auth: auth))
    try await state.timeline.loadPage(.initial, client: client, organizationSlug: nil, generation: state.timeline.generation)
    #expect(try await state.jumpToMessage("a", auth: auth))
    #expect(state.timeline.historyGapMessageIds == ["z"])
    return (state, auth, transport)
  }

  private func gapPages(_ transport: ScriptedTransport) -> [String] {
    transport.paths.filter { $0.contains("cursor=") }.compactMap { path in
      path.split(separator: "?").last?.split(separator: "&").first { $0.hasPrefix("cursor=") }.map(String.init)
    }
  }

  @Test func aVisibleHistoryGapLoadsItselfOnceAndAgainWhenItMoves() async throws {
    let (state, auth, transport) = try await stateWithGap([
      (200, transcriptPageBody(messages: [transcriptMessage(id: "m", roomId: "room", content: "Between")], nextCursor: "m")),
      (200, transcriptPageBody(messages: [transcriptMessage(id: "a", roomId: "room", content: "Pinned"), transcriptMessage(id: "b", roomId: "room", content: "After")], nextCursor: "a"))
    ])
    defer { state.reset() }
    state.setHistoryGapVisible(before: "z", true, auth: auth)
    #expect(state.timeline.boundaryLoads.status(of: "z") == .loading)
    state.setHistoryGapVisible(before: "z", true, auth: auth)
    await state.historyGapTask?.value
    #expect(gapPages(transport) == ["cursor=z"], "Once per arming, and never twice for one in-flight request.")
    #expect(state.timeline.historyGapMessageIds == ["m"], "The page stopped short of the jump window, so the gap moved to its oldest row.")
    #expect(state.timeline.boundaryLoads.status(of: "z") == .idle)
    #expect(state.transcriptError == nil)

    state.setHistoryGapVisible(before: "m", true, auth: auth)
    await state.historyGapTask?.value
    #expect(gapPages(transport) == ["cursor=z", "cursor=m"])
    #expect(state.timeline.historyGapMessageIds.isEmpty)
    #expect(state.timeline.boundaryLoads == TranscriptBoundaryLoads())
    #expect(state.historyGapTask == nil)
  }

  @Test func aFailedHistoryGapWaitsForTryAgainWithoutATranscriptError() async throws {
    let (state, auth, transport) = try await stateWithGap([
      (500, "{}"),
      (200, transcriptPageBody(messages: [transcriptMessage(id: "a", roomId: "room", content: "Pinned"), transcriptMessage(id: "m", roomId: "room", content: "Between")], nextCursor: "a"))
    ])
    defer { state.reset() }
    state.setHistoryGapVisible(before: "z", true, auth: auth)
    await state.historyGapTask?.value
    #expect(state.timeline.boundaryLoads.status(of: "z") == .failed)
    #expect(state.transcriptError == nil, "No banner above the transcript and nothing for an alert to show.")
    #expect(state.timeline.failedPage == nil)
    #expect(state.timeline.historyGapMessageIds == ["z"])
    #expect(state.transcriptMessages.map(\.id) == ["a", "z"])

    state.setHistoryGapVisible(before: "z", false, auth: auth)
    state.setHistoryGapVisible(before: "z", true, auth: auth)
    await state.historyGapTask?.value
    #expect(gapPages(transport) == ["cursor=z"], "A failed row does not load itself again.")

    state.loadHistoryGap(before: "z", auth: auth)
    #expect(state.timeline.boundaryLoads.status(of: "z") == .loading)
    await state.historyGapTask?.value
    #expect(gapPages(transport) == ["cursor=z", "cursor=z"])
    #expect(state.timeline.historyGapMessageIds.isEmpty)
    #expect(state.transcriptMessages.map(\.id) == ["a", "m", "z"])
    #expect(state.timeline.boundaryLoads.status(of: "z") == .idle)
  }

  @Test func twoVisibleGapsLoadOneAfterTheOther() async throws {
    let (state, auth, transport) = try await stateWithGap([
      (200, transcriptPageBody(messages: [transcriptMessage(id: "m", roomId: "room", content: "Middle")], nextCursor: "m")),
      (200, transcriptPageBody(messages: [transcriptMessage(id: "a", roomId: "room", content: "Pinned"), transcriptMessage(id: "b", roomId: "room", content: "After")], nextCursor: "a")),
      (200, transcriptPageBody(messages: [transcriptMessage(id: "m", roomId: "room", content: "Middle"), transcriptMessage(id: "n", roomId: "room", content: "Later")], nextCursor: "m"))
    ])
    defer { state.reset() }
    #expect(try await state.jumpToMessage("m", auth: auth))
    #expect(state.timeline.historyGapMessageIds == ["m", "z"])
    state.setHistoryGapVisible(before: "m", true, auth: auth)
    state.setHistoryGapVisible(before: "z", true, auth: auth)
    #expect(state.timeline.boundaryLoads.status(of: "m") == .loading)
    #expect(state.timeline.boundaryLoads.status(of: "z") == .idle, "The second gap waits; the timeline admits one page at a time.")
    await state.historyGapTask?.value
    await state.historyGapTask?.value
    #expect(gapPages(transport) == ["cursor=m", "cursor=z"])
    #expect(state.timeline.historyGapMessageIds.isEmpty)
    #expect(state.transcriptMessages.map(\.id) == ["a", "b", "m", "n", "z"])
  }

  @Test func leavingTheRoomForgetsTheGapRows() async throws {
    let (state, auth, _) = try await stateWithGap([(500, "{}")])
    defer { state.reset() }
    state.setHistoryGapVisible(before: "z", true, auth: auth)
    await state.historyGapTask?.value
    #expect(state.timeline.boundaryLoads.status(of: "z") == .failed)
    state.clearTranscript()
    #expect(state.timeline.boundaryLoads == TranscriptBoundaryLoads())
    #expect(state.historyGapTask == nil)
    state.setHistoryGapVisible(before: "z", true, auth: auth)
    #expect(state.timeline.boundaryLoads == TranscriptBoundaryLoads(), "No transcript, no gap rows.")
  }
}

/// Row 24b: the open thread reads its mute, a toggle writes it, and a written mute re-counts the Threads
/// trigger and re-reads the room's attention, as web's `onMuteChanged` does.
extension WorkspaceStateTests {
  private static let muteRoomId = "550e8400-e29b-41d4-a716-446655440000"
  private static let muteRootId = "550e8400-e29b-41d4-a716-446655440034"

  private static func threadBody(mutedAt: String?) -> String {
    let parent = transcriptMessage(id: muteRootId, roomId: muteRoomId, content: "Parent")
    let muted = mutedAt.map { "\"\($0)\"" } ?? "null"
    return """
    {"data":{"parentMessage":\(parent),"replyCount":1,"lastReplyAt":"\(timestamp)","unreadReplyCount":0,"lastUnreadReplyAt":null,"hasLooked":true,"mutedAt":\(muted)},"meta":{"timestamp":"\(timestamp)","requestId":"req-1"}}
    """
  }

  /// A signed-in room with its thread open and looked, then `extra` for the mute calls.
  private static func openMuteThread(_ extra: [(Int, String)]) async throws -> (WorkspaceState, AuthState, ScriptedTransport) { // swiftlint:disable:this large_tuple
    let root = transcriptMessage(id: muteRootId, roomId: muteRoomId, content: "Parent")
    let reply = transcriptMessage(id: "550e8400-e29b-41d4-a716-446655440035", roomId: muteRoomId, content: "Reply")
      .replacingOccurrences(of: "\"parentMessageId\":null", with: "\"parentMessageId\":\"\(muteRootId)\"")
    let (state, auth, transport, _) = try ephemeralState([
      (200, accessBody(gate: "ready")), (200, orgsBody), (200, userBody),
      (200, #"{"data":{"organizationId":null},"meta":{"timestamp":"2026-01-01T00:00:00.000Z","requestId":"req-1"}}"#),
      (200, roomsBody(names: ["general"])),
      (200, transcriptPageBody(messages: [root], nextCursor: nil)),
      (200, roomReadBody(id: muteRoomId, unread: 3)),
      (200, #"{"data":{"parentMessageId":"\#(muteRootId)","lastReadAt":"\#(timestamp)"},"meta":{"timestamp":"\#(timestamp)","requestId":"test"}}"#),
      (200, roomReadBody(id: muteRoomId, unread: 2)),
      (200, transcriptPageBody(messages: [reply], nextCursor: nil))
    ] + extra)
    await state.reload(auth: auth)
    await waitForTranscriptIdle(state)
    try state.openThread(#require(state.transcriptMessages.first), auth: auth)
    await state.thread.loadTask?.value
    return (state, auth, transport)
  }

  @Test(arguments: [false, true])
  func theOpenThreadReadsItsMuteOnceAndAToggleRefreshesAttention(muted: Bool) async throws {
    let (state, auth, transport) = try await Self.openMuteThread([
      (200, Self.threadBody(mutedAt: muted ? timestamp : nil)),
      (200, Self.threadBody(mutedAt: muted ? nil : timestamp)),
      (200, roomReadBody(id: Self.muteRoomId, unread: 1))
    ])
    #expect(state.thread.mute?.isMuted == nil, "No control before Core answers.")
    await state.readThreadMuteIfNeeded(auth: auth)
    await state.readThreadMuteIfNeeded(auth: auth)
    #expect(state.thread.mute?.isMuted == muted)
    let revision = state.threadAttentionRevision
    await state.toggleThreadMute(auth: auth)
    #expect(state.thread.mute?.isMuted == !muted)
    #expect(state.thread.mute?.isPending == false)
    #expect(state.threadAttentionRevision == revision + 1, "The Threads trigger counts again.")
    #expect(state.rooms.first?.unreadCount == 1, "The room row takes Core's answer to the room read.")
    #expect(transport.operationIDs.suffix(3) == [
      "get/chats/rooms/{id}/threads/{parentMessageId}",
      "\(muted ? "delete" : "post")/chats/rooms/{id}/threads/{parentMessageId}/mute",
      "post/chats/rooms/{id}/read"
    ])
    #expect(transport.remainingStubs == 0)
    state.thread.close()
  }

  @Test func aFailedToggleRevertsWithoutTouchingAttention() async throws {
    let (state, auth, transport) = try await Self.openMuteThread([
      (200, Self.threadBody(mutedAt: nil)),
      (500, #"{"error":"Internal Server Error","message":"boom","meta":{"timestamp":"2026-01-01T00:00:00.000Z","requestId":"req-1","path":"/chats/rooms/x/threads/y/mute","method":"POST"}}"#)
    ])
    await state.readThreadMuteIfNeeded(auth: auth)
    let revision = state.threadAttentionRevision
    await state.toggleThreadMute(auth: auth)
    #expect(state.thread.mute?.isMuted == false)
    #expect(state.thread.mute?.failure == .mute)
    #expect(state.threadAttentionRevision == revision)
    #expect(state.rooms.first?.unreadCount == 2)
    #expect(transport.operationIDs.last == "post/chats/rooms/{id}/threads/{parentMessageId}/mute")
    #expect(transport.remainingStubs == 0)
    state.thread.close()
  }
}

/// Row 24c: every Look re-counts the Threads trigger, the automatic one included, and Mark all posts the
/// room read and re-counts before it reloads the list, as web's `onThreadLooked` and `onAllThreadsLooked` do.
extension WorkspaceStateTests {
  private static let lookBody = """
  {"data":{"parentMessageId":"\(muteRootId)","lastReadAt":"\(timestamp)"},"meta":{"timestamp":"\(timestamp)","requestId":"test"}}
  """
  private static let markAllBody = #"{"data":{"markedCount":1},"meta":{"timestamp":"2026-01-01T00:00:00.000Z","requestId":"test"}}"#

  private static func threadsPage(unread: Int) -> String {
    let parent = transcriptMessage(id: muteRootId, roomId: muteRoomId, content: "Parent")
    return transcriptPageBody(messages: ["""
    {"parentMessage":\(parent),"replyCount":2,"lastReplyAt":"\(timestamp)","unreadReplyCount":\(unread),"lastUnreadReplyAt":null,"hasLooked":true,"mutedAt":null}
    """], nextCursor: nil)
  }

  /// A signed-in room with the Threads overview loaded, then `extra` for Mark all.
  private static func openOverview(_ extra: [(Int, String)]) async throws -> (WorkspaceState, AuthState, ScriptedTransport) { // swiftlint:disable:this large_tuple
    let (state, auth, transport, _) = try ephemeralState([
      (200, accessBody(gate: "ready")), (200, orgsBody), (200, userBody),
      (200, #"{"data":{"organizationId":null},"meta":{"timestamp":"2026-01-01T00:00:00.000Z","requestId":"req-1"}}"#),
      (200, roomsBody(names: ["general"])),
      (200, transcriptPageBody(messages: [transcriptMessage(id: muteRootId, roomId: muteRoomId, content: "Parent")], nextCursor: nil)),
      (200, roomReadBody(id: muteRoomId, unread: 3)),
      (200, threadsPage(unread: 2))
    ] + extra)
    await state.reload(auth: auth)
    await waitForTranscriptIdle(state)
    await state.updateThreadOverview(.load, roomId: muteRoomId, auth: auth)
    return (state, auth, transport)
  }

  /// `ChatRootView` runs `syncReadAttention` when the window becomes active and whenever the read content
  /// changes; with a thread open that writes a Look, which lowers the room's unread-thread count.
  @Test func anAutomaticLookReCountsTheThreadsTrigger() async throws {
    let (state, auth, transport) = try await Self.openMuteThread([
      (200, Self.lookBody), (200, roomReadBody(id: Self.muteRoomId, unread: 1))
    ])
    let revision = state.threadAttentionRevision
    await state.syncReadAttention(auth: auth)
    #expect(state.threadAttentionRevision == revision + 1, "The Threads trigger counts again.")
    #expect(transport.operationIDs.suffix(2) == ["post/chats/rooms/{id}/threads/{parentMessageId}/read", "post/chats/rooms/{id}/read"])
    #expect(state.rooms.first?.unreadCount == 1)
    await state.syncReadAttention(auth: auth)
    #expect(state.threadAttentionRevision == revision + 1, "Unchanged content writes no second Look.")
    #expect(transport.remainingStubs == 0)
    state.thread.close()
  }

  @Test func markAllReadPostsTheRoomReadAndReCountsBeforeReloading() async throws {
    let (state, auth, transport) = try await Self.openOverview([
      (200, Self.markAllBody), (200, roomReadBody(id: Self.muteRoomId, unread: 0)), (200, Self.threadsPage(unread: 0))
    ])
    let revision = state.threadAttentionRevision
    await state.updateThreadOverview(.markAllRead, roomId: Self.muteRoomId, auth: auth)
    #expect(transport.operationIDs.suffix(4) == [
      "get/chats/rooms/{id}/threads", "post/chats/rooms/{id}/threads/read",
      "post/chats/rooms/{id}/read", "get/chats/rooms/{id}/threads"
    ])
    #expect(state.threadAttentionRevision == revision + 1, "The Threads trigger counts again.")
    #expect(state.rooms.first?.unreadCount == 0, "The room row takes Core's answer to the room read.")
    #expect(state.threadOverview.items.first?.unreadReplyCount == 0)
    let pages = zip(transport.operationIDs, transport.paths).filter { $0.0 == "get/chats/rooms/{id}/threads" }
    #expect(pages.count == 2 && pages.allSatisfy { $0.1.contains("limit=50") }, "Both loads ask for web's page size.")
    #expect(transport.remainingStubs == 0)
  }

  @Test func aRefusedMarkAllTouchesNeitherTheTriggerNorTheRoom() async throws {
    let (state, auth, transport) = try await Self.openOverview([
      (500, #"{"error":"Internal Server Error","message":"boom","meta":{"timestamp":"2026-01-01T00:00:00.000Z","requestId":"req-1","path":"/chats/rooms/x/threads/read","method":"POST"}}"#)
    ])
    let revision = state.threadAttentionRevision
    await state.updateThreadOverview(.markAllRead, roomId: Self.muteRoomId, auth: auth)
    #expect(transport.operationIDs.last == "post/chats/rooms/{id}/threads/read")
    #expect(state.threadAttentionRevision == revision)
    #expect(state.rooms.first?.unreadCount == 3)
    #expect(state.threadOverview.items.first?.unreadReplyCount == 2 && state.threadOverview.failureMessage != nil)
    #expect(transport.remainingStubs == 0)
  }
}
