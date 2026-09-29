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

  /// Row 24e: web's `handleLoadOlder` keeps a failed older page on its row (`olderFailed`), apart from the
  /// list's own error, and stops loading by itself until the reader retries; a retry that lands leaves the
  /// row idle, so loading on scroll resumes.
  @Test func aFailedOlderPageStaysOnItsRowAndARetryResumesPaging() async throws {
    let transport = TestTransport([
      (200, testMessagesPageBody(messages: [threadJSON(id: "first", unread: 2), threadJSON(id: "second", unread: 0)], nextCursor: "older")),
      (500, #"{"error":"Internal","message":"boom"}"#),
      (200, testMessagesPageBody(messages: [threadJSON(id: "third", unread: 0)], nextCursor: "oldest"))
    ])
    let overview = RoomThreadOverview()
    let client = try makeTestClient(transport)
    try await overview.load(client: client, roomId: testRoomId, organizationSlug: nil)
    #expect(overview.loadsOlderAutomatically)
    await #expect(throws: (any Error).self) {
      try await overview.load(client: client, roomId: testRoomId, organizationSlug: nil, older: true)
    }
    #expect(overview.olderPageStatus == .failed)
    #expect(overview.failureMessage == nil, "An older page never raises the list's own error.")
    #expect(overview.items.map(\.parentMessage.id) == ["first", "second"] && overview.nextCursor == "older")
    #expect(overview.groups.unread.count == 1 && overview.groups.earlier.count == 1, "The groups keep their rows.")
    #expect(!overview.isLoading && !overview.loadsOlderAutomatically, "A failed row waits for the reader.")

    try await overview.load(client: client, roomId: testRoomId, organizationSlug: nil, older: true)
    #expect(overview.olderPageStatus == .idle && overview.loadsOlderAutomatically)
    #expect(overview.items.map(\.parentMessage.id) == ["first", "second", "third"] && overview.nextCursor == "oldest")
    #expect(transport.requests.map { URLComponents(string: $0.request.path ?? "")?.queryItems?.first { $0.name == "cursor" }?.value } == [nil, "older", "older"],
            "The retry asks for the page that failed.")
  }

  /// An older page in flight is the row's own loading: the list is not reloading, Mark all waits for it and
  /// the row does not ask twice.
  @Test func anOlderPageInFlightIsTheRowsOwnLoading() async throws {
    let overview = RoomThreadOverview()
    try await overview.load(client: makeTestClient(TestTransport([
      (200, testMessagesPageBody(messages: [threadJSON(id: "first", unread: 2)], nextCursor: "older"))
    ])), roomId: testRoomId, organizationSlug: nil)
    let held = PausedOverviewTransport(body: testMessagesPageBody(messages: [threadJSON(id: "second", unread: 0)], nextCursor: nil))
    let heldClient = try Client.connecting(to: #require(URL(string: "https://core.example/v1")), transport: held)
    let older = Task { try await overview.load(client: heldClient, roomId: testRoomId, organizationSlug: nil, older: true) }
    await held.waitForRequest()
    #expect(overview.olderPageStatus == .loading)
    #expect(!overview.isLoading, "The first page is not loading, so the list keeps its rows and headings.")
    #expect(!overview.loadsOlderAutomatically)
    let idle = TestTransport([])
    try await overview.load(client: makeTestClient(idle), roomId: testRoomId, organizationSlug: nil, older: true)
    try await overview.markAllRead(client: makeTestClient(idle), roomId: testRoomId, organizationSlug: nil, looked: {})
    #expect(idle.requests.isEmpty, "Neither a second older page nor Mark all starts while the page loads.")
    await held.release()
    try await older.value
    #expect(overview.olderPageStatus == .idle && overview.items.map(\.parentMessage.id) == ["first", "second"])
    #expect(overview.nextCursor == nil && !overview.loadsOlderAutomatically)
  }

  /// Web's `loadFirstPage`: a failed first page clears the rows and the cursor, so no heading, Mark all or
  /// paging row is left, and says Core's message, or web's copy when Core sent none.
  @Test(arguments: [
    [overviewCoreError("You are not a member of this room"), "403", "You are not a member of this room"],
    ["not json", "200", "Could not load threads. Try again."]
  ])
  func aFailedFirstPageClearsTheList(example: [String]) async throws {
    let transport = TestTransport([
      (200, testMessagesPageBody(messages: [threadJSON(id: "first", unread: 2), threadJSON(id: "second", unread: 0)], nextCursor: "older")),
      (500, #"{"error":"Internal","message":"boom"}"#),
      (Int(example[1]) ?? 500, example[0])
    ])
    let overview = RoomThreadOverview()
    let client = try makeTestClient(transport)
    try await overview.load(client: client, roomId: testRoomId, organizationSlug: nil)
    _ = try? await overview.load(client: client, roomId: testRoomId, organizationSlug: nil, older: true)
    await #expect(throws: (any Error).self) {
      try await overview.load(client: client, roomId: testRoomId, organizationSlug: nil)
    }
    #expect(overview.items.isEmpty && overview.previews.isEmpty && overview.nextCursor == nil)
    #expect(!overview.groups.showsUnreadHeading && !overview.groups.showsEarlierHeading && overview.groups.unread.isEmpty)
    #expect(overview.failureMessage == example[2])
    #expect(overview.olderPageStatus == .idle, "A first page forgets the failed older row.")
    #expect(!overview.isLoading && !overview.loadsOlderAutomatically)
  }

  /// Mark all reloads through the same first page, so a failed reload clears the list the same way; a
  /// reopened overview (Back from a thread) reloads through it too.
  @Test func aFailedReloadAfterMarkAllClearsTheList() async throws {
    let transport = TestTransport([
      (200, testMessagesPageBody(messages: [threadJSON(id: "first", unread: 2)], nextCursor: "older")),
      (200, #"{"data":{"markedCount":1},"meta":{"timestamp":"2026-01-01T00:00:00.000Z","requestId":"test"}}"#),
      (500, overviewCoreError("Reload refused"))
    ])
    let overview = RoomThreadOverview()
    let client = try makeTestClient(transport)
    try await overview.load(client: client, roomId: testRoomId, organizationSlug: nil)
    var looked = 0
    await #expect(throws: (any Error).self) {
      try await overview.markAllRead(client: client, roomId: testRoomId, organizationSlug: nil, looked: { looked += 1 })
    }
    #expect(looked == 1, "Core accepted Mark all, so the room heard of it.")
    #expect(overview.items.isEmpty && overview.nextCursor == nil && !overview.groups.showsUnreadHeading)
    #expect(overview.failureMessage == "Reload refused")
    #expect(!overview.isMarkingRead && !overview.isLoading)
  }

  /// Web's `handleMarkAllRead`: a refused Mark all keeps the rows under the list's error, with Core's message
  /// or web's copy; it is not an older-page failure, so paging stays armed, and an older page does not
  /// clear it. The next first page does.
  @Test(arguments: [
    [overviewCoreError("Only members can do that"), "403", "Only members can do that"],
    ["not json", "200", "Could not mark unread threads as read. Try again."]
  ])
  func aFailedMarkAllKeepsTheRows(example: [String]) async throws {
    let transport = TestTransport([
      (200, testMessagesPageBody(messages: [threadJSON(id: "first", unread: 2)], nextCursor: "older")),
      (Int(example[1]) ?? 500, example[0]),
      (200, testMessagesPageBody(messages: [threadJSON(id: "second", unread: 0)], nextCursor: "oldest")),
      (200, testMessagesPageBody(messages: [threadJSON(id: "first", unread: 2)], nextCursor: "older"))
    ])
    let overview = RoomThreadOverview()
    let client = try makeTestClient(transport)
    try await overview.load(client: client, roomId: testRoomId, organizationSlug: nil)
    await #expect(throws: (any Error).self) {
      try await overview.markAllRead(client: client, roomId: testRoomId, organizationSlug: nil, looked: {})
    }
    #expect(overview.failureMessage == example[2])
    #expect(overview.items.map(\.parentMessage.id) == ["first"] && overview.groups.unread.count == 1)
    #expect(overview.olderPageStatus == .idle && overview.loadsOlderAutomatically)
    try await overview.load(client: client, roomId: testRoomId, organizationSlug: nil, older: true)
    #expect(overview.failureMessage == example[2], "An older page leaves the list's error alone, as on web.")
    try await overview.load(client: client, roomId: testRoomId, organizationSlug: nil)
    #expect(overview.failureMessage == nil)
  }

  /// A first page supersedes an older page in flight: the late page neither appends nor fails the row.
  @Test(arguments: [true, false])
  func aFirstPageSupersedesAnOlderPageInFlight(lateFailure: Bool) async throws {
    let overview = RoomThreadOverview()
    try await overview.load(client: makeTestClient(TestTransport([
      (200, testMessagesPageBody(messages: [threadJSON(id: "first", unread: 2)], nextCursor: "older"))
    ])), roomId: testRoomId, organizationSlug: nil)
    let held = PausedOverviewTransport(body: lateFailure ? #"{"error":"Internal","message":"late"}"# : testMessagesPageBody(messages: [threadJSON(id: "late", unread: 0)], nextCursor: "late-cursor"),
                                       status: lateFailure ? .internalServerError : .ok)
    let heldClient = try Client.connecting(to: #require(URL(string: "https://core.example/v1")), transport: held)
    let older = Task { try await overview.load(client: heldClient, roomId: testRoomId, organizationSlug: nil, older: true) }
    await held.waitForRequest()
    try await overview.load(client: makeTestClient(TestTransport([
      (200, testMessagesPageBody(messages: [threadJSON(id: "fresh", unread: 0)], nextCursor: "fresh-cursor"))
    ])), roomId: testRoomId, organizationSlug: nil)
    #expect(overview.olderPageStatus == .idle, "The reload leaves the row idle while the stale page is out.")
    await held.release()
    _ = try? await older.value
    #expect(overview.items.map(\.parentMessage.id) == ["fresh"] && overview.nextCursor == "fresh-cursor")
    #expect(overview.olderPageStatus == .idle && overview.failureMessage == nil && overview.loadsOlderAutomatically)
  }

  /// A reset drops a late older-page outcome, success or failure.
  @Test(arguments: [true, false])
  func resetDropsALateOlderPage(lateFailure: Bool) async throws {
    let overview = RoomThreadOverview()
    try await overview.load(client: makeTestClient(TestTransport([
      (200, testMessagesPageBody(messages: [threadJSON(id: "first", unread: 2)], nextCursor: "older"))
    ])), roomId: testRoomId, organizationSlug: nil)
    let held = PausedOverviewTransport(body: lateFailure ? #"{"error":"Internal","message":"late"}"# : testMessagesPageBody(messages: [threadJSON(id: "late", unread: 0)], nextCursor: nil),
                                       status: lateFailure ? .internalServerError : .ok)
    let heldClient = try Client.connecting(to: #require(URL(string: "https://core.example/v1")), transport: held)
    let older = Task { try await overview.load(client: heldClient, roomId: testRoomId, organizationSlug: nil, older: true) }
    await held.waitForRequest()
    overview.reset()
    #expect(overview.olderPageStatus == .idle)
    await held.release()
    _ = try? await older.value
    #expect(overview.items.isEmpty && overview.nextCursor == nil)
    #expect(overview.olderPageStatus == .idle && overview.failureMessage == nil)
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
    let room = Components.Schemas.ChatRoom(id: testRoomId, name: "Room", kind: .direct, isSelfDirect: false, isGroupDirect: false, createdByUserId: "AbCdEfGhIjKlMnOpQrStUvWxYz012345", createdAt: Date(), updatedAt: Date(),
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
      (200, #"{"data":{"count":1,"threads":[{"parentMessageId":"parent","unreadReplyCount":2}]},"meta":{"timestamp":"2026-01-01T00:00:00.000Z","requestId":"test"}}"#),
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
      (200, #"{"data":{"count":1,"threads":[{"parentMessageId":"parent","unreadReplyCount":2}]},"meta":{"timestamp":"2026-01-01T00:00:00.000Z","requestId":"test"}}"#),
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
    #expect(overview.failureMessage != nil && !overview.isMarkingRead)
    #expect(transport.requests.count == 3)
  }

  @Test(arguments: ["list", "count", "markAll"])
  func resetRejectsLateResponses(operation: String) async throws {
    let data = switch operation {
    case "count": #"{"count":1,"threads":[{"parentMessageId":"late","unreadReplyCount":7}]}"#
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
    #expect(overview.failureMessage == nil)
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

  /// Row 24h (SOK-1151): one read of `GET …/threads/unread-count` feeds the Threads trigger (how many Threads)
  /// and every reply bar (each Thread's unread replies); nothing is known until the room's first read lands.
  @Test func oneReadFeedsTheTriggerAndEveryReplyBar() async throws {
    let transport = TestTransport([
      (200, #"{"data":{"count":2,"threads":[{"parentMessageId":"a","unreadReplyCount":3},{"parentMessageId":"b","unreadReplyCount":1}]},"meta":{"timestamp":"2026-01-01T00:00:00.000Z","requestId":"test"}}"#),
      (500, #"{"error":"Internal","message":"boom"}"#)
    ])
    let overview = RoomThreadOverview()
    #expect(overview.unreadReplyCounts == nil && overview.unreadCount == 0)
    let client = try makeTestClient(transport)
    try await overview.refreshCount(client: client, roomId: testRoomId, organizationSlug: "team")
    #expect(overview.unreadReplyCounts == ["a": 3, "b": 1])
    #expect(overview.unreadCount == 2)
    await #expect(throws: (any Error).self) {
      try await overview.refreshCount(client: client, roomId: testRoomId, organizationSlug: "team")
    }
    #expect(overview.unreadReplyCounts == ["a": 3, "b": 1], "A failed read keeps the last answer.")
    overview.reset()
    #expect(overview.unreadReplyCounts == nil, "Another room shows nothing until its own read lands.")
  }

  /// Web's `clear`: a Look drops its Thread at once, and a read already in flight cannot put it back.
  @Test func clearingDropsTheThreadAndALateRead() async throws {
    let overview = RoomThreadOverview()
    try await overview.refreshCount(client: makeTestClient(TestTransport([
      (200, #"{"data":{"count":2,"threads":[{"parentMessageId":"a","unreadReplyCount":3},{"parentMessageId":"b","unreadReplyCount":1}]},"meta":{"timestamp":"2026-01-01T00:00:00.000Z","requestId":"test"}}"#)
    ])), roomId: testRoomId, organizationSlug: nil)
    let held = PausedOverviewTransport(body: #"{"data":{"count":2,"threads":[{"parentMessageId":"a","unreadReplyCount":3},{"parentMessageId":"b","unreadReplyCount":1}]},"meta":{"timestamp":"2026-01-01T00:00:00.000Z","requestId":"test"}}"#)
    let heldClient = try Client.connecting(to: #require(URL(string: "https://core.example/v1")), transport: held)
    let late = Task { try await overview.refreshCount(client: heldClient, roomId: testRoomId, organizationSlug: nil) }
    await held.waitForRequest()
    overview.clearUnreadReplies { $0 == "a" }
    #expect(overview.unreadReplyCounts == ["b": 1] && overview.unreadCount == 1)
    await held.release()
    try await late.value
    #expect(overview.unreadReplyCounts == ["b": 1], "The read from before the Look is dropped.")
  }

  /// Web's `onAllThreadsLooked(stillUnreadParentIds)`: Mark all skips a muted Thread even with an unread
  /// mention, so only a loaded muted Thread that is still unread keeps its bar.
  @Test func mutedUnreadThreadsStayUnreadAfterMarkAll() async throws {
    let transport = TestTransport([(200, testMessagesPageBody(messages: [
      threadJSON(id: "muted-unread", unread: 1, mutedAt: testTimestamp),
      threadJSON(id: "muted-read", unread: 0, mutedAt: testTimestamp),
      threadJSON(id: "plain-unread", unread: 2)
    ], nextCursor: nil))])
    let overview = RoomThreadOverview()
    try await overview.load(client: makeTestClient(transport), roomId: testRoomId, organizationSlug: nil)
    #expect(overview.mutedUnreadParentIds == ["muted-unread"])
  }

  private func threadJSON(id: String, unread: Int, content: String = "Thread", mutedAt: String? = nil) -> String {
    let escapedContent = (String(bytes: (try? JSONEncoder().encode(content)) ?? Data(), encoding: .utf8) ?? "").dropFirst().dropLast()
    let parent = testMessageJSON(id: id, content: String(escapedContent), sender: testUserSender(name: "Ada", email: "ada@example.com"))
    let muted = mutedAt.map { "\"\($0)\"" } ?? "null"
    return """
    {"parentMessage":\(parent),"replyCount":3,"lastReplyAt":"2026-09-15T12:00:00.000Z","unreadReplyCount":\(unread),"lastUnreadReplyAt":null,"hasLooked":true,"mutedAt":\(muted)}
    """
  }
}

/// Core's error envelope carrying `message`, which the overview shows as web does.
private func overviewCoreError(_ message: String) -> String {
  #"{"error":"Forbidden","message":"\#(message)","meta":{"timestamp":"\#(testTimestamp)","requestId":"req-1","path":"/v1/chats/rooms/room/threads","method":"GET"}}"#
}

private actor PausedOverviewTransport: ClientTransport {
  let body: String
  let status: HTTPResponse.Status
  private var waiter: CheckedContinuation<Void, Never>?
  private var observer: CheckedContinuation<Void, Never>?
  private(set) var requestCount = 0

  init(body: String, status: HTTPResponse.Status = .ok) {
    self.body = body
    self.status = status
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
    return (HTTPResponse(status: status), HTTPBody(body))
  }
}
