import CoreAPI
import Foundation
import HTTPTypes
import OpenAPIRuntime
import SokosumiChat
import Testing

@MainActor
struct RoomThreadOverviewTests {
  @Test func loadsPagesWithoutMarkingReadAndDeduplicatesParents() async throws {
    let first = threadJSON(id: "first", unread: 2)
    let second = threadJSON(id: "second", unread: 0)
    let transport = TestTransport([
      (200, testMessagesPageBody(messages: [first], nextCursor: "older")),
      (200, testMessagesPageBody(messages: [first, second, second], nextCursor: nil))
    ])
    let overview = RoomThreadOverview()
    let client = try makeTestClient(transport)
    try await overview.load(client: client, roomId: testRoomId, organizationSlug: "team")
    #expect(overview.items.first?.unreadReplyCount == 2)
    try await overview.load(client: client, roomId: testRoomId, organizationSlug: "team", older: true)
    #expect(overview.items.map(\.parentMessage.id) == ["first", "second"])
    #expect(overview.nextCursor == nil)
    #expect(transport.requests.count == 2)
    #expect(transport.requests.allSatisfy { $0.request.method.rawValue == "GET" })
    #expect(transport.requests.last?.request.path?.contains("cursor=older") == true)
  }

  /// Row 24c: web asks for 50 threads on every page (`THREAD_LIST_PAGE_LIMIT`); Core's default is 20.
  @Test func everyPageAsksForFiftyThreadsLikeWeb() async throws {
    let transport = TestTransport([
      (200, testMessagesPageBody(messages: [threadJSON(id: "first", unread: 1)], nextCursor: "older")),
      (200, testMessagesPageBody(messages: [threadJSON(id: "second", unread: 0)], nextCursor: nil))
    ])
    let overview = RoomThreadOverview()
    let client = try makeTestClient(transport)
    try await overview.load(client: client, roomId: testRoomId, organizationSlug: nil)
    try await overview.load(client: client, roomId: testRoomId, organizationSlug: nil, older: true)
    let queries = transport.requests.map { URLComponents(string: $0.request.path ?? "")?.queryItems ?? [] }
    #expect(queries.map { $0.first { $0.name == "limit" }?.value } == ["50", "50"])
    #expect(queries.map { $0.first { $0.name == "cursor" }?.value } == [nil, "older"])
  }

  @Test func loadFailureKeepsOlderItemsAndAllowsRetry() async throws {
    let transport = TestTransport([
      (200, testMessagesPageBody(messages: [threadJSON(id: "first", unread: 0)], nextCursor: "older")),
      (403, #"{"error":"Forbidden","message":"No access"}"#),
      (200, testMessagesPageBody(messages: [], nextCursor: nil))
    ])
    let overview = RoomThreadOverview()
    let client = try makeTestClient(transport)
    try await overview.load(client: client, roomId: testRoomId, organizationSlug: nil)
    do {
      try await overview.load(client: client, roomId: testRoomId, organizationSlug: nil, older: true)
      Issue.record("Expected forbidden error")
    } catch {}
    #expect(overview.failure != nil && !overview.isLoading)
    #expect(overview.items.count == 1)
    try await overview.load(client: client, roomId: testRoomId, organizationSlug: nil, older: true)
    #expect(overview.failure == nil && overview.nextCursor == nil)
  }

  @Test func firstPageReloadRemovesObsoletePreviews() async throws {
    let transport = TestTransport([
      (200, testMessagesPageBody(messages: [threadJSON(id: "old", unread: 0)], nextCursor: nil)),
      (200, testMessagesPageBody(messages: [threadJSON(id: "new", unread: 0)], nextCursor: nil))
    ])
    let overview = RoomThreadOverview()
    let client = try makeTestClient(transport)
    try await overview.load(client: client, roomId: testRoomId, organizationSlug: nil)
    try await overview.load(client: client, roomId: testRoomId, organizationSlug: nil)
    #expect(overview.items.map(\.parentMessage.id) == ["new"])
    #expect(overview.previews == ["new": "Thread"])
  }

  @Test func markAllReadReloadPreservesResolvedMentionPreview() async throws {
    let user = Components.Schemas.ChatRoomUserParticipant(id: "AbCdEfGhIjKlMnOpQrStUvWxYz012345", name: "Anna Smith", email: "anna@example.com", presence: .online)
    let room = Components.Schemas.ChatRoom(id: testRoomId, name: "Room", kind: .direct, isSelfDirect: false, createdByUserId: "AbCdEfGhIjKlMnOpQrStUvWxYz012345", createdAt: Date(), updatedAt: Date(),
                                           unreadCount: 0, unreadMentionCount: 0, markedUnread: false, myAccess: .member,
                                           userMembers: [user], coworkerMembers: [], sokoBotMembers: [])
    let transport = TestTransport([
      (200, testMessagesPageBody(messages: [threadJSON(id: "parent", unread: 2, content: "**Hello** @AbCdEfGhIjKlMnOpQrStUvWxYz012345")], nextCursor: nil)),
      (200, #"{"data":{"markedCount":1},"meta":{"timestamp":"2026-01-01T00:00:00.000Z","requestId":"test"}}"#),
      (200, testMessagesPageBody(messages: [threadJSON(id: "parent", unread: 0, content: "**Hello** @AbCdEfGhIjKlMnOpQrStUvWxYz012345")], nextCursor: nil))
    ])
    let overview = RoomThreadOverview()
    let client = try makeTestClient(transport)
    let mentions = MessageMentions(room: room)
    try await overview.load(client: client, roomId: testRoomId, organizationSlug: nil, mentions: mentions)
    #expect(overview.previews["parent"] == "Hello @Anna Smith")
    try await overview.markAllRead(client: client, roomId: testRoomId, organizationSlug: nil, mentions: mentions, looked: {})
    #expect(overview.previews["parent"] == "Hello @Anna Smith")
    #expect(overview.items.first?.unreadReplyCount == 0)
    #expect(!overview.isMarkingRead)
    #expect(transport.requests.map(\.request.method.rawValue) == ["GET", "POST", "GET"])
  }

  /// Row 24c: web's `handleMarkAllRead` tells the room (`onAllThreadsLooked`: re-count the Threads trigger,
  /// post the room read) once Core accepted, then reloads the first page. The trigger's count is Core's
  /// re-count, not a zero the overview assumes: Mark all skips a muted thread with an unread mention.
  @Test func markAllReadReportsTheLookBeforeReloading() async throws {
    let transport = TestTransport([
      (200, testMessagesPageBody(messages: [threadJSON(id: "parent", unread: 2)], nextCursor: nil)),
      (200, #"{"data":{"count":1},"meta":{"timestamp":"2026-01-01T00:00:00.000Z","requestId":"test"}}"#),
      (200, #"{"data":{"markedCount":1},"meta":{"timestamp":"2026-01-01T00:00:00.000Z","requestId":"test"}}"#),
      (200, testMessagesPageBody(messages: [threadJSON(id: "parent", unread: 0)], nextCursor: nil))
    ])
    let overview = RoomThreadOverview()
    let client = try makeTestClient(transport)
    try await overview.load(client: client, roomId: testRoomId, organizationSlug: nil)
    try await overview.refreshCount(client: client, roomId: testRoomId, organizationSlug: nil)
    var lookedAfter: [String] = []
    try await overview.markAllRead(client: client, roomId: testRoomId, organizationSlug: nil, looked: {
      lookedAfter = transport.requests.map(\.operationID)
      #expect(overview.isMarkingRead, "The room hears of it while Mark all still holds the list.")
    })
    #expect(lookedAfter.suffix(1) == ["post/chats/rooms/{id}/threads/read"], "Reported once Core accepted, before the reload.")
    #expect(transport.requests.map(\.operationID).suffix(2) == ["post/chats/rooms/{id}/threads/read", "get/chats/rooms/{id}/threads"])
    #expect(overview.unreadCount == 1, "The count waits for the trigger's re-count.")
    #expect(overview.items.first?.unreadReplyCount == 0 && !overview.isMarkingRead)
  }

  @Test func failedMarkAllReadPreservesUnreadState() async throws {
    let transport = TestTransport([
      (200, testMessagesPageBody(messages: [threadJSON(id: "parent", unread: 2)], nextCursor: nil)),
      (200, #"{"data":{"count":1},"meta":{"timestamp":"2026-01-01T00:00:00.000Z","requestId":"test"}}"#),
      (403, #"{"error":"Forbidden","message":"No access"}"#)
    ])
    let overview = RoomThreadOverview()
    let client = try makeTestClient(transport)
    try await overview.load(client: client, roomId: testRoomId, organizationSlug: nil)
    try await overview.refreshCount(client: client, roomId: testRoomId, organizationSlug: nil)
    var looked = 0
    await #expect(throws: (any Error).self) {
      try await overview.markAllRead(client: client, roomId: testRoomId, organizationSlug: nil, looked: { looked += 1 })
    }
    #expect(looked == 0, "A refused Mark all tells the room nothing.")
    #expect(overview.items.first?.unreadReplyCount == 2)
    #expect(overview.unreadCount == 1)
    #expect(overview.failure != nil && !overview.isMarkingRead)
    #expect(transport.requests.count == 3)
  }

  @Test(arguments: ["list", "count", "markAll"])
  func resetRejectsLateResponses(operation: String) async throws {
    let data = switch operation {
    case "count": #"{"count":7}"#
    case "markAll": #"{"markedCount":1}"#
    default: "[]"
    }
    let body = operation == "list"
      ? testMessagesPageBody(messages: [threadJSON(id: "late", unread: 2)], nextCursor: "older")
      : "{\"data\":\(data),\"meta\":{\"timestamp\":\"\(testTimestamp)\",\"requestId\":\"test\"}}"
    let transport = PausedOverviewTransport(body: body)
    let client = try Client.connecting(to: #require(URL(string: "https://core.example/v1")), transport: transport)
    let overview = RoomThreadOverview()
    let task = Task {
      switch operation {
      case "count": try await overview.refreshCount(client: client, roomId: testRoomId, organizationSlug: nil)
      case "markAll": try await overview.markAllRead(client: client, roomId: testRoomId, organizationSlug: nil, looked: {
          Issue.record("A reset overview must not report a late Mark all.")
        })
      default: try await overview.load(client: client, roomId: testRoomId, organizationSlug: nil)
      }
    }
    await transport.waitForRequest()
    if operation == "markAll" {
      let extraTransport = TestTransport([])
      try await overview.load(client: makeTestClient(extraTransport), roomId: testRoomId, organizationSlug: nil)
      #expect(extraTransport.requests.isEmpty)
    }
    overview.reset()
    await transport.release()
    try await task.value
    #expect(overview.items.isEmpty && overview.previews.isEmpty)
    #expect(overview.nextCursor == nil && overview.unreadCount == 0)
    #expect(!overview.isLoading && !overview.isMarkingRead)
    #expect(overview.failure == nil)
    #expect(await transport.requestCount == 1)
  }

  @Test(arguments: [
    ["see [the design](https://example.test/spec)", "see the design"],
    ["See https://example.test/spec, please", "See , please"],
    ["![shot](https://example.test/shot.png)", "shot"],
    ["![](https://example.test/shot.png)", ""],
    ["[report.pdf](https://example.test/report.pdf)", "report.pdf"],
    ["Before\n```swift\nlet secret = 1\n```\nAfter", "Before After"],
    [String(repeating: "a", count: 130), String(repeating: "a", count: 127) + "…"],
    [String(repeating: "👨‍👩‍👧‍👦", count: 40), String(repeating: "👨‍👩‍👧‍👦", count: 18) + "…"]
  ])
  func previewsMatchWebExamples(example: [String]) async throws {
    let transport = TestTransport([(200, testMessagesPageBody(messages: [threadJSON(id: "parent", unread: 0, content: example[0])], nextCursor: nil))])
    let overview = RoomThreadOverview()
    try await overview.load(client: makeTestClient(transport), roomId: testRoomId, organizationSlug: nil)
    #expect(overview.previews["parent"] == example[1])
  }

  @Test func reopeningOverviewSupersedesPendingLoad() async throws {
    let oldTransport = PausedOverviewTransport(body: testMessagesPageBody(messages: [threadJSON(id: "old", unread: 1)], nextCursor: "old-cursor"))
    let oldClient = try Client.connecting(to: #require(URL(string: "https://core.example/v1")), transport: oldTransport)
    let currentTransport = TestTransport([(200, testMessagesPageBody(messages: [threadJSON(id: "current", unread: 0)], nextCursor: nil))])
    let overview = RoomThreadOverview()
    let oldLoad = Task { try await overview.load(client: oldClient, roomId: testRoomId, organizationSlug: nil) }
    await oldTransport.waitForRequest()
    try await overview.load(client: makeTestClient(currentTransport), roomId: testRoomId, organizationSlug: nil)
    await oldTransport.release()
    try await oldLoad.value
    #expect(overview.items.map(\.parentMessage.id) == ["current"])
    #expect(overview.previews == ["current": "Thread"])
    #expect(overview.nextCursor == nil && !overview.isLoading)
  }

  private func threadJSON(id: String, unread: Int, content: String = "Thread") -> String {
    let escapedContent = (String(bytes: (try? JSONEncoder().encode(content)) ?? Data(), encoding: .utf8) ?? "").dropFirst().dropLast()
    let parent = testMessageJSON(id: id, content: String(escapedContent), sender: testUserSender(name: "Ada", email: "ada@example.com"))
    return """
    {"parentMessage":\(parent),"replyCount":3,"lastReplyAt":"2026-09-15T12:00:00.000Z","unreadReplyCount":\(unread),"lastUnreadReplyAt":null,"hasLooked":true}
    """
  }
}

private actor PausedOverviewTransport: ClientTransport {
  let body: String
  private var waiter: CheckedContinuation<Void, Never>?
  private var observer: CheckedContinuation<Void, Never>?
  private(set) var requestCount = 0

  init(body: String) {
    self.body = body
  }

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
    requestCount += 1
    await withCheckedContinuation {
      waiter = $0
      observer?.resume()
      observer = nil
    }
    return (HTTPResponse(status: .ok), HTTPBody(body))
  }
}
