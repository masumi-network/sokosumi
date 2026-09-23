import CoreAPI
import Foundation
import HTTPTypes
import OpenAPIRuntime
import SokosumiChat
import Testing

private func attentionBody(unread: Int = 4, marked: Bool = false) -> String {
  """
  {"data":\(testAttentionRoomJSON(unread: unread, marked: marked)),"meta":{"timestamp":"\(testTimestamp)","requestId":"req-1"}}
  """
}

private actor PausedAttentionTransport: ClientTransport {
  private let response: String
  init(response: String = attentionBody(unread: 0)) {
    self.response = response
  }

  private var waiter: CheckedContinuation<Void, Never>?
  private var observer: CheckedContinuation<Void, Never>?
  func waitForRequest() async {
    if waiter != nil {
      return
    }
    await withCheckedContinuation { observer = $0 }
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
    return (HTTPResponse(status: .ok), HTTPBody(response))
  }
}

@MainActor
struct RoomReadAttentionTests {
  private func room() async throws -> Components.Schemas.ChatRoom {
    let transport = TestTransport([(200, testMessagesPageBody(messages: [testAttentionRoomJSON()], nextCursor: nil))])
    return try #require(await ChatService().listRooms(client: makeTestClient(transport), organizationSlug: nil).first)
  }

  @Test func hiddenAndUnresolvedHistoryNeverRead() async throws {
    let room = try await room()
    let state = RoomReadAttention()
    let transport = TestTransport([(200, attentionBody(unread: 2))])
    let client = try makeTestClient(transport)
    #expect(try await !state.readIfNeeded(room: room, content: .init(messages: []), historyReadable: true, client: client, organizationSlug: nil))
    state.setVisible(true, window: UUID())
    #expect(try await !state.readIfNeeded(room: room, content: .init(messages: []), historyReadable: false, client: client, organizationSlug: nil))
    #expect(transport.requests.isEmpty)
    #expect(try await state.readIfNeeded(room: room, content: .init(messages: []), historyReadable: true, client: client, organizationSlug: nil))
    #expect(state.applying(to: [room])[0].unreadCount == 2)
    #expect(state.applying(to: [room])[0].unreadMentionCount == 1)
  }

  @Test func contentChangesReadAgainButIdenticalContentDoesNot() async throws {
    let room = try await room()
    let state = RoomReadAttention()
    let window = UUID()
    state.setVisible(true, window: window)
    let transport = TestTransport([(200, attentionBody()), (200, attentionBody())])
    for text in ["Thinking", "Thinking", "Final answer"] {
      try await state.readIfNeeded(room: room, content: .init(messages: [.init(id: "same", content: text)]), historyReadable: true, client: makeTestClient(transport), organizationSlug: "acme")
    }
    #expect(transport.requests.count == 2)
    #expect(testOrgSlugHeader(transport.requests[0].request) == "acme")
    state.setVisible(false, window: window)
    #expect(try await !state.readIfNeeded(room: room, content: .init(messages: [.init(id: "next", content: "hidden")]), historyReadable: true, client: makeTestClient(transport), organizationSlug: nil))
  }

  @Test func threadContentReadsLookBeforeRoomAndDeduplicates() async throws {
    let room = try await room()
    let state = RoomReadAttention()
    state.setVisible(true, window: UUID())
    let lookBody = """
    {"data":{"parentMessageId":"root","lastReadAt":"\(testTimestamp)"},"meta":{"timestamp":"\(testTimestamp)","requestId":"test"}}
    """
    let transport = TestTransport([(200, lookBody), (200, attentionBody(unread: 2)),
                                   (200, lookBody), (200, attentionBody(unread: 1))])
    let client = try makeTestClient(transport)
    for text in ["First", "First", "Edited"] {
      try await state.readIfNeeded(room: room,
                                   content: .init(messages: [], parentMessageId: "root", replies: [.init(id: "reply", content: text)]),
                                   historyReadable: true, client: client, organizationSlug: nil)
    }
    #expect(transport.requests.map(\.operationID) == [
      "post/chats/rooms/{id}/threads/{parentMessageId}/read", "post/chats/rooms/{id}/read",
      "post/chats/rooms/{id}/threads/{parentMessageId}/read", "post/chats/rooms/{id}/read"
    ])
    #expect(state.applying(to: [room]).first?.unreadCount == 1)
  }

  /// Row 24c: web's `lookThread` reports every Look that reaches Core, the automatic one included, so the
  /// header Threads trigger re-counts (`onThreadLooked`). A refused Look reports nothing; a room read that
  /// fails after a Look does not take the report back.
  @Test func everyAutomaticLookThatReachesCoreIsReported() async throws {
    let room = try await room()
    let state = RoomReadAttention()
    state.setVisible(true, window: UUID())
    let lookBody = """
    {"data":{"parentMessageId":"root","lastReadAt":"\(testTimestamp)"},"meta":{"timestamp":"\(testTimestamp)","requestId":"test"}}
    """
    let transport = TestTransport([(200, attentionBody(unread: 3)),
                                   (200, lookBody), (200, attentionBody(unread: 2)),
                                   (503, "{}"), (200, attentionBody(unread: 2)),
                                   (200, lookBody), (503, "{}")])
    let client = try makeTestClient(transport)
    var looked: [Int] = []
    func read(_ content: RoomReadAttention.Content) async {
      _ = try? await state.readIfNeeded(room: room, content: content, historyReadable: true, client: client, organizationSlug: nil,
                                        threadLooked: { looked.append(transport.requests.count) })
    }
    await read(.init(messages: [.init(id: "m", content: "Room")]))
    #expect(looked.isEmpty, "No thread open, no Look.")
    await read(.init(messages: [], parentMessageId: "root", replies: [.init(id: "r1", content: "First")]))
    #expect(looked == [2], "Reported as soon as the Look answers, before the room read.")
    await read(.init(messages: [], parentMessageId: "root", replies: [.init(id: "r2", content: "Second")]))
    #expect(looked == [2], "A refused Look reports nothing.")
    await read(.init(messages: [], parentMessageId: "root", replies: [.init(id: "r3", content: "Third")]))
    #expect(looked == [2, 6], "The Look counts even when the room read after it fails.")
    #expect(transport.requests.count == 7)
  }

  @Test func failedThreadLookStillReadsRoomAndRetriesAttention() async throws {
    let room = try await room()
    let state = RoomReadAttention()
    state.setVisible(true, window: UUID())
    let transport = TestTransport([(503, "{}"), (200, attentionBody(unread: 2)),
                                   (503, "{}"), (200, attentionBody(unread: 1))])
    let client = try makeTestClient(transport)
    for _ in 0 ..< 2 {
      await #expect(throws: ChatServiceError.self) {
        try await state.readIfNeeded(room: room, content: .init(messages: [], parentMessageId: "root"),
                                     historyReadable: true, client: client, organizationSlug: nil)
      }
    }
    #expect(transport.requests.count == 4)
    #expect(state.applying(to: [room]).first?.unreadCount == 1)
    #expect(state.errorMessage == nil)
  }

  @Test func navigationDuringThreadLookDoesNotReadOldRoom() async throws {
    let room = try await room()
    let state = RoomReadAttention()
    state.setVisible(true, window: UUID())
    let transport = PausedAttentionTransport(response: """
    {"data":{"parentMessageId":"root","lastReadAt":"\(testTimestamp)"},"meta":{"timestamp":"\(testTimestamp)","requestId":"test"}}
    """)
    let client = try Client.connecting(to: #require(URL(string: "https://core.example.com/v1")), transport: transport)
    let task = Task {
      try await state.readIfNeeded(room: room, content: .init(messages: [], parentMessageId: "root"),
                                   historyReadable: true, client: client, organizationSlug: nil)
    }
    await transport.waitForRequest()
    state.roomChanged()
    await transport.release()
    #expect(try await !task.value)
    #expect(state.applying(to: [room]).first?.unreadCount == room.unreadCount)
  }

  @Test func explicitThreadReadPreservesCountersUntilCoreResponds() async throws {
    let room = try await room()
    let state = RoomReadAttention()
    state.setVisible(true, window: UUID())
    let transport = PausedAttentionTransport(response: attentionBody(unread: 2))
    let client = try Client.connecting(to: #require(URL(string: "https://core.example.com/v1")), transport: transport)
    let task = Task { try await state.readAfterThreadLook(room: room, client: client, organizationSlug: nil) }
    await transport.waitForRequest()
    #expect(state.applying(to: [room]).first?.unreadCount == room.unreadCount)
    await transport.release()
    #expect(try await task.value)
    #expect(state.applying(to: [room]).first?.unreadCount == 2)
  }

  @Test func failedReadRollsBackAndCanRetry() async throws {
    let room = try await room()
    let state = RoomReadAttention()
    state.setVisible(true, window: UUID())
    let transport = TestTransport([(503, "{}"), (200, attentionBody(unread: 1))])
    await #expect(throws: ChatServiceError.self) {
      try await state.readIfNeeded(room: room, content: .init(messages: []), historyReadable: true, client: makeTestClient(transport), organizationSlug: nil)
    }
    // Background read failures stay silent (web parity); only mark-unread
    // failures surface `errorMessage`.
    #expect(state.errorMessage == nil)
    #expect(state.applying(to: [room])[0].unreadCount == 4)
    #expect(try await state.readIfNeeded(room: room, content: .init(messages: []), historyReadable: true, client: makeTestClient(transport), organizationSlug: nil))
    #expect(state.applying(to: [room])[0].unreadCount == 1)
  }

  @Test func markUnreadGatesActiveAndMutedRoomsAndRollsBackFailures() async throws {
    var room = try await room()
    let state = RoomReadAttention()
    let transport = TestTransport([(503, "{}"), (200, attentionBody(marked: true))])
    try await state.markUnread(room: room, activeRoomId: room.id, client: makeTestClient(transport), organizationSlug: nil)
    room.mutedAt = Date()
    try await state.markUnread(room: room, activeRoomId: nil, client: makeTestClient(transport), organizationSlug: nil)
    #expect(transport.requests.isEmpty)
    room.mutedAt = nil
    await #expect(throws: ChatServiceError.self) {
      try await state.markUnread(room: room, activeRoomId: nil, client: makeTestClient(transport), organizationSlug: "acme")
    }
    #expect(!state.applying(to: [room])[0].markedUnread)
    // User-initiated mark-unread surfaces the failure, but the stale alert
    // doesn't survive navigation.
    #expect(state.errorMessage != nil)
    state.roomChanged()
    #expect(state.errorMessage == nil)
    try await state.markUnread(room: room, activeRoomId: nil, client: makeTestClient(transport), organizationSlug: "acme")
    #expect(state.applying(to: [room])[0].markedUnread)
    #expect(transport.requests.allSatisfy { $0.operationID == "post/chats/rooms/{id}/unread" })
  }

  @Test func pendingReadWinsAgainstOldRefreshButFreshRefreshWinsAfterSettlement() async throws {
    let room = try await room()
    let state = RoomReadAttention()
    state.setVisible(true, window: UUID())
    let revision = state.beginRefresh()
    let transport = PausedAttentionTransport()
    let client = try Client.connecting(to: #require(URL(string: "https://core.example/v1")), transport: transport)
    let task = Task { try await state.readIfNeeded(room: room, content: .init(messages: []), historyReadable: true, client: client, organizationSlug: nil) }
    await transport.waitForRequest()
    #expect(state.reconcile([room], requestRevision: revision)[0].unreadCount == 0)
    await transport.release()
    #expect(try await task.value)
    #expect(state.reconcile([room], requestRevision: revision)[0].unreadCount == 0)
    #expect(state.reconcile([room], requestRevision: state.beginRefresh())[0].unreadCount == 4)
  }

  @Test func workspaceResetRejectsLateReadResult() async throws {
    let room = try await room()
    let state = RoomReadAttention()
    state.setVisible(true, window: UUID())
    let transport = PausedAttentionTransport()
    let client = try Client.connecting(to: #require(URL(string: "https://core.example/v1")), transport: transport)
    let task = Task { try await state.readIfNeeded(room: room, content: .init(messages: []), historyReadable: true, client: client, organizationSlug: nil) }
    await transport.waitForRequest()
    state.reset()
    await transport.release()
    #expect(try await task.value == false)
    #expect(state.applying(to: [room])[0].unreadCount == 4)
  }

  @Test func newerUnreadWinsOverLateRead() async throws {
    let room = try await room()
    let state = RoomReadAttention()
    state.setVisible(true, window: UUID())
    let transport = PausedAttentionTransport()
    let client = try Client.connecting(to: #require(URL(string: "https://core.example/v1")), transport: transport)
    let task = Task { try await state.readIfNeeded(room: room, content: .init(messages: []), historyReadable: true, client: client, organizationSlug: nil) }
    await transport.waitForRequest()
    state.roomChanged()
    let unread = TestTransport([(200, attentionBody(marked: true))])
    try await state.markUnread(room: room, activeRoomId: nil, client: makeTestClient(unread), organizationSlug: "acme")
    await transport.release()
    _ = try await task.value
    #expect(state.applying(to: [room])[0].markedUnread)
    #expect(testOrgSlugHeader(unread.requests[0].request) == "acme")
  }

  @Test func expiredMutationCannotSuppressFreshSidebarForever() async throws {
    let room = try await room()
    var time = Date()
    let state = RoomReadAttention(now: { time })
    state.setVisible(true, window: UUID())
    let transport = PausedAttentionTransport()
    let client = try Client.connecting(to: #require(URL(string: "https://core.example/v1")), transport: transport)
    let task = Task { try await state.readIfNeeded(room: room, content: .init(messages: []), historyReadable: true, client: client, organizationSlug: nil) }
    await transport.waitForRequest()
    time = time.addingTimeInterval(31)
    #expect(state.reconcile([room], requestRevision: state.beginRefresh())[0].unreadCount == 4)
    await transport.release()
    _ = try await task.value
    #expect(state.applying(to: [room])[0].unreadCount == 4)
  }

  /// Was `activeAndMutedChromeSuppressUnreadAttention`: its first line asserted no badge for
  /// `isActive`. Web dropped the open-room rule (#4441), so only mute suppresses the chrome.
  @Test func onlyMutedChromeSuppressesUnreadAttention() {
    #expect(resolveRoomAttention(unreadCount: 5, unreadMentionCount: 2) == .init(bold: true, badgeCount: 2))
    #expect(resolveRoomAttention(unreadCount: 5, unreadMentionCount: 2, isMuted: true) == .init(bold: false, badgeCount: 0))
    #expect(!resolveRoomAttention(unreadCount: 0, unreadMentionCount: 0, markedUnread: true, isMuted: true).bold)
    #expect(resolveRoomAttention(unreadCount: 0, unreadMentionCount: 0, markedUnread: true).bold)
  }
}
