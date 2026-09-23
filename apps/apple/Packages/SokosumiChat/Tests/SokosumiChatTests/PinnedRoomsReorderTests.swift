import CoreAPI
import Foundation
import HTTPTypes
import OpenAPIRuntime
import SokosumiChat
import Testing

private let roomA = "550e8400-e29b-41d4-a716-446655440201"
private let roomB = "550e8400-e29b-41d4-a716-446655440202"
private let roomC = "550e8400-e29b-41d4-a716-446655440203"

private func pinnedRoomJSON(id: String, starredAt: String?) -> String {
  let pin = starredAt.map { "\"\($0)\"" } ?? "null"
  return """
  {"id":"\(id)","organizationId":null,"organizationName":null,"name":"\(id.suffix(3))","slug":null,"kind":"channel","isSelfDirect":false,"directKey":null,"isGroupDirect":false,"groupName":null,"topic":null,"discoverability":null,"createdByUserId":"user_1","createdAt":"\(testTimestamp)","updatedAt":"\(testTimestamp)","unreadCount":0,"unreadMentionCount":0,"starredAt":\(pin),"pinnedMessageCount":0,"mutedAt":null,"markedUnread":false,"myAccess":"member","peerInActiveOrganization":false,"userMembers":[],"coworkerMembers":[],"sokoBotMembers":[]}
  """
}

/// Core's list: A, B, C pinned in that order.
private func roomsBody(order: [String] = [roomA, roomB, roomC], unpinned: Set<String> = []) -> String {
  let rooms = order.enumerated().map { index, id in
    pinnedRoomJSON(id: id, starredAt: unpinned.contains(id) ? nil : "2026-01-01T00:00:0\(index).000Z")
  }
  return testMessagesPageBody(messages: rooms, nextCursor: nil)
}

private func orderBody(_ roomIds: [String]) -> String {
  let rows = roomIds.enumerated().map { #"{"roomId":"\#($1)","starredAt":"2026-02-01T00:00:00.00\#($0)Z"}"# }.joined(separator: ",")
  return #"{"data":[\#(rows)],"meta":{"timestamp":"\#(testTimestamp)","requestId":"reorder"}}"#
}

private let reorderFailureBody = """
{"error":"Request failed","message":"Refused","meta":{"timestamp":"\(testTimestamp)","requestId":"reorder","path":"/chats/rooms/starred","method":"PUT"}}
"""

/// Holds every request until released, oldest first, so two reorders can overlap.
private actor PausedReorderTransport: ClientTransport {
  private var responses: [(Int, String)]
  private(set) var bodies: [Data] = []
  private(set) var organizationSlugs: [String?] = []
  private var waiters: [CheckedContinuation<Void, Never>] = []
  private var observers: [(Int, CheckedContinuation<Void, Never>)] = []

  init(_ responses: [(Int, String)]) {
    self.responses = responses
  }

  func waitForRequests(_ count: Int) async {
    if bodies.count < count {
      await withCheckedContinuation { observers.append((count, $0)) }
    }
  }

  func release() {
    waiters.removeFirst().resume()
  }

  func send(_ request: HTTPRequest, body: HTTPBody?, baseURL _: URL, operationID: String) async throws -> (HTTPResponse, HTTPBody?) {
    #expect(operationID == "put/chats/rooms/starred")
    let next = responses.removeFirst()
    var data = Data()
    if let body {
      data = try await Data(Array(collecting: body, upTo: 1_000_000))
    }
    bodies.append(data)
    organizationSlugs.append(testOrgSlugHeader(request))
    await withCheckedContinuation { waiter in
      waiters.append(waiter)
      for (count, observer) in observers where bodies.count >= count {
        observer.resume()
      }
      observers.removeAll { bodies.count >= $0.0 }
    }
    return (HTTPResponse(status: .init(code: next.0)), HTTPBody(next.1))
  }
}

@MainActor
struct PinnedRoomsReorderTests {
  private func sidebar(_ body: String = roomsBody()) async throws -> ConversationSidebar {
    let sidebar = ConversationSidebar()
    try await sidebar.refresh(client: makeTestClient(TestTransport([(200, body)])), organizationSlug: nil)
    return sidebar
  }

  private func client(_ transport: PausedReorderTransport) throws -> Client {
    try Client.connecting(to: #require(URL(string: "https://core.example/v1")), transport: transport)
  }

  private func pinnedIds(_ sidebar: ConversationSidebar) -> [String] {
    sidebar.partitioned.pinned.map(\.id)
  }

  @Test(arguments: [nil, "acme"] as [String?])
  func reorderShowsBeforeCoreAnswersSurvivesARefreshAndTakesCoresKeys(organizationSlug: String?) async throws {
    let state = try await sidebar()
    #expect(pinnedIds(state) == [roomA, roomB, roomC])
    let transport = PausedReorderTransport([(200, orderBody([roomC, roomA, roomB]))])
    let reorderClient = try client(transport)
    let task = Task { try await state.reorderPinned([roomC, roomA, roomB], client: reorderClient, organizationSlug: organizationSlug) }
    await transport.waitForRequests(1)
    #expect(pinnedIds(state) == [roomC, roomA, roomB])
    #expect(await testRequestJSON(transport.bodies[0])["roomIds"] as? [String] == [roomC, roomA, roomB])
    #expect(await transport.organizationSlugs == [organizationSlug])
    // Core has not written yet: a list read meanwhile still says A, B, C.
    try await state.refresh(client: makeTestClient(TestTransport([(200, roomsBody())])), organizationSlug: organizationSlug)
    #expect(pinnedIds(state) == [roomC, roomA, roomB])
    await transport.release()
    try await task.value
    #expect(pinnedIds(state) == [roomC, roomA, roomB])
    let core = ISO8601DateFormatter()
    core.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    #expect(state.rooms.first { $0.id == roomC }?.starredAt == core.date(from: "2026-02-01T00:00:00.000Z"))
    #expect(state.actionError == nil)
  }

  @Test func optimisticReorderKeysUseInjectedNow() async throws {
    let state = try await sidebar()
    let now = Date(timeIntervalSince1970: 1_700_000_000)
    let transport = PausedReorderTransport([(200, orderBody([roomC, roomA, roomB]))])
    let reorderClient = try client(transport)
    let task = Task {
      try await state.reorderPinned([roomC, roomA, roomB], client: reorderClient, organizationSlug: nil, now: now)
    }
    await transport.waitForRequests(1)
    #expect(state.rooms.first { $0.id == roomC }?.starredAt == now.addingTimeInterval(-0.003))
    #expect(state.rooms.first { $0.id == roomA }?.starredAt == now.addingTimeInterval(-0.002))
    #expect(state.rooms.first { $0.id == roomB }?.starredAt == now.addingTimeInterval(-0.001))
    await transport.release()
    try await task.value
  }

  @Test func latestReorderWinsOverAnEarlierAnswerAndAnEarlierFailure() async throws {
    let state = try await sidebar()
    let transport = PausedReorderTransport([(500, reorderFailureBody), (200, orderBody([roomB, roomC, roomA]))])
    let reorderClient = try client(transport)
    let first = Task { try await state.reorderPinned([roomC, roomA, roomB], client: reorderClient, organizationSlug: nil) }
    await transport.waitForRequests(1)
    let second = Task { try await state.reorderPinned([roomB, roomC, roomA], client: reorderClient, organizationSlug: nil) }
    await transport.waitForRequests(2)
    #expect(pinnedIds(state) == [roomB, roomC, roomA])
    // The superseded request fails quietly: no error, no throw, so no reload.
    await transport.release()
    try await first.value
    #expect(state.actionError == nil)
    #expect(pinnedIds(state) == [roomB, roomC, roomA])
    await transport.release()
    try await second.value
    #expect(pinnedIds(state) == [roomB, roomC, roomA])
  }

  @Test func failureOfTheLatestReorderSurfacesAndThrowsForTheReload() async throws {
    let state = try await sidebar()
    let transport = PausedReorderTransport([(500, reorderFailureBody)])
    let reorderClient = try client(transport)
    let task = Task { try await state.reorderPinned([roomB, roomA, roomC], client: reorderClient, organizationSlug: nil) }
    await transport.waitForRequests(1)
    await transport.release()
    await #expect(throws: ChatServiceError.self) { try await task.value }
    #expect(state.actionError == "Core rejected the request (500): Refused")
    // No local snapshot is put back; the reload brings Core's order and nothing pending overrides it.
    try await state.refresh(client: makeTestClient(TestTransport([(200, roomsBody())])), organizationSlug: nil)
    #expect(pinnedIds(state) == [roomA, roomB, roomC])
  }

  @Test(arguments: ["switch", "reset"])
  func completionAfterTheWorkspaceChangedTouchesNothing(change: String) async throws {
    let state = try await sidebar()
    let transport = PausedReorderTransport([(500, reorderFailureBody)])
    let reorderClient = try client(transport)
    let task = Task { try await state.reorderPinned([roomC, roomB, roomA], client: reorderClient, organizationSlug: nil) }
    await transport.waitForRequests(1)
    if change == "switch" {
      state.dropPendingActions()
      state.rooms = []
    } else {
      state.reset()
    }
    try await state.refresh(client: makeTestClient(TestTransport([(200, roomsBody())])), organizationSlug: "other")
    await transport.release()
    try await task.value
    #expect(state.actionError == nil)
    #expect(pinnedIds(state) == [roomA, roomB, roomC])
  }

  @Test func aRoomUnpinnedMeanwhileStaysUnpinned() async throws {
    let state = try await sidebar()
    let transport = PausedReorderTransport([(200, orderBody([roomC, roomA, roomB]))])
    let reorderClient = try client(transport)
    let task = Task { try await state.reorderPinned([roomC, roomA, roomB], client: reorderClient, organizationSlug: nil) }
    await transport.waitForRequests(1)
    // Unpinned on another device: the list read says so, and neither the pending order nor Core's answer re-pins it.
    try await state.refresh(client: makeTestClient(TestTransport([(200, roomsBody(unpinned: [roomA]))])), organizationSlug: nil)
    #expect(pinnedIds(state) == [roomC, roomB])
    await transport.release()
    try await task.value
    #expect(pinnedIds(state) == [roomC, roomB])
    #expect(state.rooms.first { $0.id == roomA }?.starredAt == nil)
  }

  @Test func reorderModeNeedsAnOpenSectionWithTwoPinsAndDoesNotComeBackByItself() async throws {
    let state = try await sidebar(roomsBody(order: [roomA, roomB]))
    #expect(state.canReorderPinned)
    state.setPinnedReorderMode(true)
    #expect(state.pinnedReorderMode)
    state.setExpanded(false, section: .pinned)
    #expect(!state.pinnedReorderMode)
    state.setPinnedReorderMode(true)
    #expect(!state.pinnedReorderMode)
    state.setExpanded(true, section: .pinned)
    #expect(!state.pinnedReorderMode)

    state.setPinnedReorderMode(true)
    let unpin = TestTransport([(200, #"{"data":\#(pinnedRoomJSON(id: roomB, starredAt: nil)),"meta":{"timestamp":"\#(testTimestamp)","requestId":"unpin"}}"#)])
    try await state.perform(.unpin, roomId: roomB, client: makeTestClient(unpin), organizationSlug: nil)
    #expect(!state.canReorderPinned)
    #expect(!state.pinnedReorderMode)
    // Pinning a second room again does not re-enter the mode unasked.
    state.rooms[1].starredAt = Date()
    #expect(state.canReorderPinned)
    #expect(!state.pinnedReorderMode)

    state.setPinnedReorderMode(true)
    state.dropPendingActions()
    #expect(!state.pinnedReorderMode)
  }
}
