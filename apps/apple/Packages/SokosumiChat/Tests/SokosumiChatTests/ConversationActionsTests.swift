import CoreAPI
import Foundation
import HTTPTypes
import OpenAPIRuntime
import SokosumiChat
import Testing

private let peerRoomId = "550e8400-e29b-41d4-a716-446655440101"

private func actionRoomJSON(
  id: String = testRoomId,
  name: String = "general",
  pinned: Bool = false,
  muted: Bool = false
) -> String {
  let pin = pinned ? "\"\(testTimestamp)\"" : "null"
  let mute = muted ? "\"\(testTimestamp)\"" : "null"
  return """
  {"id":"\(id)","organizationId":null,"organizationName":null,"name":"\(name)","slug":null,"kind":"channel","isSelfDirect":false,"directKey":null,"isGroupDirect":false,"groupName":null,"topic":null,"discoverability":null,"createdByUserId":"user_1","createdAt":"\(testTimestamp)","updatedAt":"\(testTimestamp)","unreadCount":4,"unreadMentionCount":1,"starredAt":\(pin),"pinnedMessageCount":0,"mutedAt":\(mute),"markedUnread":false,"myAccess":"member","peerInActiveOrganization":false,"userMembers":[],"coworkerMembers":[],"sokoBotMembers":[]}
  """
}

private func actionBody(pinned: Bool = false, muted: Bool = false) -> String {
  """
  {"data":\(actionRoomJSON(pinned: pinned, muted: muted)),"meta":{"timestamp":"\(testTimestamp)","requestId":"action"}}
  """
}

private let actionFailureBody = """
{"error":"Request failed","message":"Refused","meta":{"timestamp":"\(testTimestamp)","requestId":"action","path":"/chats/rooms/room/star","method":"POST"}}
"""

private actor PausedSidebarTransport: ClientTransport {
  let status: Int
  let response: String
  private var waiter: CheckedContinuation<Void, Never>?
  private var observer: CheckedContinuation<Void, Never>?

  init(status: Int = 200, response: String = actionBody(pinned: true)) {
    self.status = status
    self.response = response
  }

  func waitForRequest() async {
    if waiter == nil {
      await withCheckedContinuation { observer = $0 }
    }
  }

  func release() {
    waiter?.resume()
    waiter = nil
  }

  func send(_: HTTPRequest, body _: HTTPBody?, baseURL _: URL, operationID _: String) async throws -> (HTTPResponse, HTTPBody?) {
    await withCheckedContinuation {
      waiter = $0
      observer?.resume()
      observer = nil
    }
    return (HTTPResponse(status: .init(code: status)), HTTPBody(response))
  }
}

@MainActor
struct ConversationActionsTests {
  private func sidebar(pinned: Bool = false, muted: Bool = false) async throws -> ConversationSidebar {
    let sidebar = ConversationSidebar()
    let transport = TestTransport([(200, testMessagesPageBody(messages: [actionRoomJSON(pinned: pinned, muted: muted)], nextCursor: nil))])
    try await sidebar.refresh(client: makeTestClient(transport), organizationSlug: nil)
    return sidebar
  }

  private func twoRoomSidebar() async throws -> ConversationSidebar {
    let sidebar = ConversationSidebar()
    let transport = TestTransport([(200, testMessagesPageBody(messages: [
      actionRoomJSON(id: testRoomId, name: "target"),
      actionRoomJSON(id: peerRoomId, name: "peer")
    ], nextCursor: nil))])
    try await sidebar.refresh(client: makeTestClient(transport), organizationSlug: nil)
    return sidebar
  }

  @Test(arguments: [nil, "acme"] as [String?])
  func actionsUseExistingRoutesAndPreserveNewerAttention(organizationSlug: String?) async throws {
    let state = try await sidebar()
    let transport = TestTransport([
      (200, actionBody(pinned: true)), (200, actionBody()),
      (200, actionBody(muted: true)), (200, actionBody())
    ])
    let client = try makeTestClient(transport)
    state.rooms[0].unreadCount = 9
    for action: ConversationSidebar.Action in [.pin, .unpin, .mute, .unmute] {
      try await state.perform(action, roomId: testRoomId, client: client, organizationSlug: organizationSlug)
      #expect(state.rooms[0].unreadCount == 9)
    }
    #expect(transport.requests.map(\.operationID) == [
      "post/chats/rooms/{id}/star", "delete/chats/rooms/{id}/star",
      "post/chats/rooms/{id}/mute", "delete/chats/rooms/{id}/mute"
    ])
    #expect(transport.requests.allSatisfy { testOrgSlugHeader($0.request) == organizationSlug })
    #expect(state.rooms[0].starredAt == nil)
    #expect(state.rooms[0].mutedAt == nil)
  }

  /// Web's open room: selecting it is not a read (ADR 0026), so the row resolves to the same
  /// bold, badge and count as before the selection, and Mark unread stays off. Row 24g1 corrects
  /// row 05a: leftover Thread unread no longer keeps the open row bold (ADR 0037).
  @Test func openRoomKeepsItsAttention() async throws {
    let state = try await sidebar()
    func attention(showUnreadCount: Bool = true) -> RoomAttention {
      resolveRoomAttention(state.rooms[0], showUnreadCount: showUnreadCount)
    }
    // One number per row (SOK-1147): the badge stands alone.
    let closed = attention()
    #expect(closed == .init(bold: true, badgeCount: 1))
    state.selectedRoomId = testRoomId
    #expect(attention() == closed)
    #expect(attention(showUnreadCount: false) == closed)
    #expect(!state.canPerform(.markUnread, roomId: testRoomId))
    // Four new messages and nothing addressed to the reader: bold and the count.
    state.rooms[0].unreadMentionCount = 0
    #expect(attention() == .init(bold: true, badgeCount: 0, unreadTextCount: 4))
    // Was "bold and · 1" on one leftover Participant thread reply (ADR 0013). A read that leaves one
    // behind now leaves the row quiet: the reply is Thread unread, which the Thread shows.
    state.rooms[0] = roomAttentionAfterRead(state.rooms[0])
    state.rooms[0].unreadCount = 1
    state.rooms[0].threadUnreadCount = 1
    #expect(attention() == .init(bold: false, badgeCount: 0))
    // Genuinely read, then marked unread elsewhere: quiet, then bold without a number.
    state.rooms[0].unreadCount = 0
    #expect(attention() == .init(bold: false, badgeCount: 0))
    state.rooms[0].markedUnread = true
    #expect(attention() == .init(bold: true, badgeCount: 0))
    // Muting the open room silences it, and Mark unread stays off for muted rooms.
    state.rooms[0].unreadCount = 250
    state.rooms[0].unreadMentionCount = 250
    #expect(attention().badgeLabel == "99+")
    state.rooms[0].mutedAt = Date(timeIntervalSince1970: 0)
    #expect(attention() == .init(bold: false, badgeCount: 0))
    state.selectedRoomId = nil
    #expect(!state.canPerform(.markUnread, roomId: testRoomId))
  }

  @Test func availabilityMatchesWeb() async throws {
    let state = try await sidebar()
    #expect(state.canPerform(.pin, roomId: testRoomId))
    #expect(state.canPerform(.mute, roomId: testRoomId))
    state.selectedRoomId = testRoomId
    #expect(!state.canPerform(.markUnread, roomId: testRoomId))
    state.selectedRoomId = nil
    state.rooms[0].mutedAt = Date()
    #expect(!state.canPerform(.pin, roomId: testRoomId))
    #expect(!state.canPerform(.markUnread, roomId: testRoomId))
    #expect(state.canPerform(.unmute, roomId: testRoomId))
    state.rooms[0].mutedAt = nil
    state.rooms[0].starredAt = Date()
    #expect(!state.canPerform(.mute, roomId: testRoomId))
    #expect(state.canPerform(.unpin, roomId: testRoomId))
    #expect(state.canPerform(.markUnread, roomId: testRoomId))
    #expect(!state.canPerform(.pin, roomId: "missing"))
  }

  @Test func pendingPinSurvivesRefreshAndPreventsOtherActions() async throws {
    let state = try await sidebar()
    let transport = PausedSidebarTransport()
    let client = try Client.connecting(to: #require(URL(string: "https://core.example/v1")), transport: transport)
    let task = Task { try await state.perform(.pin, roomId: testRoomId, client: client, organizationSlug: nil) }
    await transport.waitForRequest()
    #expect(state.rooms[0].starredAt != nil)
    for action: ConversationSidebar.Action in [.pin, .unpin, .mute, .unmute, .markUnread] {
      #expect(!state.canPerform(action, roomId: testRoomId))
    }
    let refresh = TestTransport([(200, testMessagesPageBody(messages: [actionRoomJSON()], nextCursor: nil))])
    try await state.refresh(client: makeTestClient(refresh), organizationSlug: nil)
    #expect(state.rooms[0].starredAt != nil)
    state.rooms[0].name = "Renamed during pin"
    await transport.release()
    try await task.value
    #expect(state.rooms[0].name == "Renamed during pin")
    #expect(state.canPerform(.unpin, roomId: testRoomId))
  }

  @Test(arguments: [401, 403, 404, 422, 500])
  func failedPinRollsBackOnlyPin(status: Int) async throws {
    let state = try await sidebar()
    let transport = PausedSidebarTransport(status: status, response: actionFailureBody)
    let client = try Client.connecting(to: #require(URL(string: "https://core.example/v1")), transport: transport)
    let task = Task { try await state.perform(.pin, roomId: testRoomId, client: client, organizationSlug: nil) }
    await transport.waitForRequest()
    state.rooms[0].unreadCount = 8
    await transport.release()
    let expected: ChatServiceError = status == 401 ? .unauthorized("Refused") : .unprocessable(statusCode: status, message: "Refused")
    await #expect(throws: expected) { try await task.value }
    #expect(state.rooms[0].starredAt == nil)
    #expect(state.rooms[0].unreadCount == 8)
    #expect(state.actionError != nil)
    #expect(state.canPerform(.pin, roomId: testRoomId))
  }

  @Test(arguments: [200, 401])
  func workspaceResetDiscardsOldAction(status: Int) async throws {
    let state = try await sidebar()
    let transport = PausedSidebarTransport(status: status, response: status == 200 ? actionBody(pinned: true) : actionFailureBody)
    let client = try Client.connecting(to: #require(URL(string: "https://core.example/v1")), transport: transport)
    let task = Task { try await state.perform(.pin, roomId: testRoomId, client: client, organizationSlug: nil) }
    await transport.waitForRequest()
    let original = try #require(state.rooms.first)
    state.reset()
    var replacement = original
    replacement.starredAt = nil
    state.rooms = [replacement]
    await transport.release()
    try await task.value
    #expect(state.rooms[0].starredAt == nil)
    #expect(state.actionError == nil)
  }

  @Test func markUnreadUsesSharedOverlayAndRestoresOnFailure() async throws {
    let state = try await sidebar()
    let transport = PausedSidebarTransport(status: 403, response: actionFailureBody)
    let client = try Client.connecting(to: #require(URL(string: "https://core.example/v1")), transport: transport)
    let task = Task { try await state.perform(.markUnread, roomId: testRoomId, client: client, organizationSlug: nil) }
    await transport.waitForRequest()
    #expect(state.partitioned.channels.first?.markedUnread == true)
    #expect(!state.canPerform(.pin, roomId: testRoomId))
    await transport.release()
    await #expect(throws: ChatServiceError.self) { try await task.value }
    #expect(state.partitioned.channels.first?.markedUnread == false)
    #expect(state.readAttention.errorMessage != nil)
    #expect(state.actionError == nil)
  }

  @Test func failedWorkspaceSwitchKeepsInFlightPin() async throws {
    let state = try await sidebar()
    let transport = PausedSidebarTransport()
    let client = try Client.connecting(to: #require(URL(string: "https://core.example/v1")), transport: transport)
    let task = Task { try await state.perform(.pin, roomId: testRoomId, client: client, organizationSlug: nil) }
    await transport.waitForRequest()
    state.invalidateRefresh()
    #expect(state.isPending(roomId: testRoomId))
    #expect(state.rooms[0].starredAt != nil)
    await transport.release()
    try await task.value
    #expect(state.rooms[0].starredAt != nil)
    #expect(state.canPerform(.unpin, roomId: testRoomId))
  }

  @Test func otherRoomRevokeKeepsInFlightPin() async throws {
    let state = try await twoRoomSidebar()
    let transport = PausedSidebarTransport()
    let client = try Client.connecting(to: #require(URL(string: "https://core.example/v1")), transport: transport)
    let task = Task { try await state.perform(.pin, roomId: testRoomId, client: client, organizationSlug: nil) }
    await transport.waitForRequest()
    state.rollbackPendingAction(roomId: peerRoomId)
    #expect(state.isPending(roomId: testRoomId))
    #expect(state.rooms[0].starredAt != nil)
    await transport.release()
    try await task.value
    #expect(state.rooms[0].starredAt != nil)
    #expect(state.canPerform(.unpin, roomId: testRoomId))
  }

  @Test func optimisticPinAndMuteReorderPartitioned() async throws {
    let pinned = try await twoRoomSidebar()
    #expect(pinned.partitioned.channels.map(\.id) == [testRoomId, peerRoomId])
    let pinTransport = PausedSidebarTransport()
    let pinClient = try Client.connecting(to: #require(URL(string: "https://core.example/v1")), transport: pinTransport)
    let pinTask = Task { try await pinned.perform(.pin, roomId: peerRoomId, client: pinClient, organizationSlug: nil) }
    await pinTransport.waitForRequest()
    #expect(pinned.partitioned.pinned.map(\.id) == [peerRoomId])
    #expect(pinned.partitioned.channels.map(\.id) == [testRoomId])
    await pinTransport.release()
    try await pinTask.value
    #expect(pinned.partitioned.pinned.map(\.id) == [peerRoomId])
    #expect(pinned.partitioned.channels.map(\.id) == [testRoomId])

    let muted = try await twoRoomSidebar()
    let muteTransport = PausedSidebarTransport(response: actionBody(muted: true))
    let muteClient = try Client.connecting(to: #require(URL(string: "https://core.example/v1")), transport: muteTransport)
    let muteTask = Task { try await muted.perform(.mute, roomId: testRoomId, client: muteClient, organizationSlug: nil) }
    await muteTransport.waitForRequest()
    #expect(muted.partitioned.channels.map(\.id) == [peerRoomId, testRoomId])
    await muteTransport.release()
    try await muteTask.value
    #expect(muted.partitioned.channels.map(\.id) == [peerRoomId, testRoomId])
  }

  @Test func optimisticPinUsesInjectedNow() async throws {
    let state = try await sidebar()
    let now = Date(timeIntervalSince1970: 1_788_868_800)
    let token = try #require(UUID(uuidString: "550e8400-e29b-41d4-a716-446655440999"))
    let transport = PausedSidebarTransport()
    let client = try Client.connecting(to: #require(URL(string: "https://core.example/v1")), transport: transport)
    let task = Task {
      try await state.perform(
        .pin, roomId: testRoomId, client: client, organizationSlug: nil, now: now, makeId: { token }
      )
    }
    await transport.waitForRequest()
    #expect(state.rooms[0].starredAt == now)
    await transport.release()
    try await task.value
  }

  @Test func actionSettlementDoesNotEndWorkspaceSwitchLoading() async throws {
    let state = try await sidebar()
    let transport = PausedSidebarTransport()
    let client = try Client.connecting(to: #require(URL(string: "https://core.example/v1")), transport: transport)
    let task = Task { try await state.perform(.pin, roomId: testRoomId, client: client, organizationSlug: nil) }
    await transport.waitForRequest()
    state.invalidateRefresh()
    state.isLoading = true
    await transport.release()
    try await task.value
    #expect(state.isLoading)
    #expect(state.rooms[0].starredAt != nil)
  }

  @Test func removedRoomIsNotReinsertedWhenPinCompletes() async throws {
    let state = try await sidebar()
    let transport = PausedSidebarTransport()
    let client = try Client.connecting(to: #require(URL(string: "https://core.example/v1")), transport: transport)
    let task = Task { try await state.perform(.pin, roomId: testRoomId, client: client, organizationSlug: nil) }
    await transport.waitForRequest()
    state.rooms = []
    await transport.release()
    try await task.value
    #expect(state.rooms.isEmpty)
  }

  @Test func refreshStartedBeforeSettlementCannotUndoPin() async throws {
    let state = try await sidebar()
    let transport = PausedSidebarTransport(response: testMessagesPageBody(messages: [actionRoomJSON()], nextCursor: nil))
    let client = try Client.connecting(to: #require(URL(string: "https://core.example/v1")), transport: transport)
    let refresh = Task { try await state.refresh(client: client, organizationSlug: nil) }
    await transport.waitForRequest()
    try await state.perform(.pin, roomId: testRoomId, client: makeTestClient(TestTransport([(200, actionBody(pinned: true))])), organizationSlug: nil)
    await transport.release()
    #expect(try await !refresh.value)
    #expect(state.rooms[0].starredAt != nil)
  }
}
