import CoreAPI
import Foundation
import HTTPTypes
import OpenAPIRuntime
import SokosumiChat
import Testing

private let alphaRoomId = "550e8400-e29b-41d4-a716-446655440a01"
private let betaRoomId = "550e8400-e29b-41d4-a716-446655440b02"
private let mutedRoomId = "550e8400-e29b-41d4-a716-446655440c03"
private let adaId = "019fc7e4-e4bd-7005-900c-66e44d33f5e4"
private let baseDate = Date(timeIntervalSince1970: 1_790_000_000)

/// One of a room's listed unread Threads (`ChatRoom.unreadThreads`).
private struct ListedThread {
  let parent: String
  let replies: Int
  let mentions: Int
}

private func room(
  _ id: String,
  name: String,
  unreadThreads: Int = 0,
  threadMentions: Int? = nil,
  listed: [ListedThread] = [],
  muted: Bool = false,
  updatedAt: Date = baseDate
) -> Components.Schemas.ChatRoom {
  .init(
    id: id, name: name, kind: .channel, isSelfDirect: false, isGroupDirect: false,
    discoverability: ._public, createdByUserId: "user_1", createdAt: baseDate, updatedAt: updatedAt,
    unreadCount: 0, threadUnreadCount: listed.reduce(0) { $0 + $1.replies }, unreadThreadCount: unreadThreads,
    unreadThreadMentionCount: threadMentions,
    unreadThreads: listed.map { .init(parentMessageId: $0.parent, firstUnreadReplyId: "\($0.parent)-reply",
                                      parentContent: "Parent", unreadReplyCount: $0.replies, unreadMentionCount: $0.mentions) },
    unreadMentionCount: 0, mutedAt: muted ? baseDate : nil, markedUnread: false, myAccess: .member,
    userMembers: [.init(id: adaId, name: "Ada Lovelace", email: "ada@example.com", presence: .online)],
    coworkerMembers: [], sokoBotMembers: []
  )
}

private func unreadJSON(_ parent: String, room: String, content: String = "Release checklist", replies: Int = 2, mentions: Int = 0) -> String {
  """
  {"parentMessageId":"\(parent)","firstUnreadReplyId":"\(parent)-reply","parentContent":"\(content)","unreadReplyCount":\(replies),"unreadMentionCount":\(mentions),"roomId":"\(room)","lastUnreadAt":"2026-09-23T10:00:00.000Z"}
  """
}

private func earlierJSON(_ parent: String, room: String, replies: Int = 4) -> String {
  """
  {"roomId":"\(room)","parentMessageId":"\(parent)","parentContent":"Design review","replyCount":\(replies),"lastReplyAt":"2026-09-22T10:00:00.000Z","lastReplyId":"\(parent)-last"}
  """
}

private func coreError(_ message: String) -> String {
  #"{"error":"Internal Server Error","message":"\#(message)","meta":{"timestamp":"\#(testTimestamp)","requestId":"req-1","path":"/v1/chats/threads/unread","method":"GET"}}"#
}

private func queryItem(_ recorded: TestTransport.Recorded, _ name: String) -> String? {
  URLComponents(string: recorded.request.path ?? "")?.queryItems?.first { $0.name == name }?.value
}

/// Row 24f1: web's chat-level Threads view (`/chat/threads`, SOK-1159) — every Thread the reader is part
/// of across the workspace's rooms, unread ones first and then Earlier, each naming its room.
@MainActor
struct CrossRoomThreadsTests {
  private let rooms = [room(alphaRoomId, name: "general", unreadThreads: 2), room(betaRoomId, name: "design", unreadThreads: 1)]

  // MARK: Transport

  /// Web's `listUnreadThreads` / `listEarlierThreads`: `GET /chats/threads/unread` and `/earlier`, 50 per
  /// page (`THREAD_LIST_PAGE_LIMIT`) with the previous page's cursor, scoped by the workspace header.
  @Test(arguments: ["team", nil] as [String?])
  func bothListsReadCoreWithFiftyPerPageAndTheWorkspaceHeader(slug: String?) async throws {
    let transport = TestTransport([
      (200, testMessagesPageBody(messages: [unreadJSON("u1", room: alphaRoomId)], nextCursor: "u1")),
      (200, testMessagesPageBody(messages: [unreadJSON("u2", room: betaRoomId)], nextCursor: nil)),
      (200, testMessagesPageBody(messages: [earlierJSON("e1", room: alphaRoomId)], nextCursor: nil))
    ])
    let client = try makeTestClient(transport)
    let threads = CrossRoomThreads()
    try await threads.load(.unread, rooms: rooms, scope: "w", client: client, organizationSlug: slug)
    try await threads.load(.unread, older: true, rooms: rooms, scope: "w", client: client, organizationSlug: slug)
    try await threads.load(.earlier, rooms: rooms, scope: "w", client: client, organizationSlug: slug)
    #expect(transport.requests.map(\.operationID) == ["get/chats/threads/unread", "get/chats/threads/unread", "get/chats/threads/earlier"])
    #expect(transport.requests.map { URLComponents(string: $0.request.path ?? "")?.path } == ["/chats/threads/unread", "/chats/threads/unread", "/chats/threads/earlier"])
    #expect(transport.requests.map { queryItem($0, "limit") } == ["50", "50", "50"])
    #expect(transport.requests.map { queryItem($0, "cursor") } == [nil, "u1", nil])
    #expect(transport.requests.map { testOrgSlugHeader($0.request) } == [slug, slug, slug])
    #expect(threads.unreadRows(rooms: rooms).map(\.parentMessageId) == ["u1", "u2"])
    #expect(threads.unread.nextCursor == nil)
    #expect(threads.earlierRows(rooms: rooms).map(\.lastReplyId) == ["e1-last"])
  }

  // MARK: Rows

  /// Web drops a row whose room the sidebar no longer lists or the reader muted since the page was read,
  /// and a Thread a later page repeats.
  @Test func rowsDropUnlistedAndMutedRoomsAndRepeats() async throws {
    let transport = TestTransport([
      (200, testMessagesPageBody(messages: [
        unreadJSON("u1", room: alphaRoomId), unreadJSON("gone", room: "550e8400-e29b-41d4-a716-446655440d04"),
        unreadJSON("quiet", room: mutedRoomId), unreadJSON("u1", room: alphaRoomId)
      ], nextCursor: nil)),
      (200, testMessagesPageBody(messages: [earlierJSON("e1", room: mutedRoomId), earlierJSON("e2", room: betaRoomId)], nextCursor: nil))
    ])
    let client = try makeTestClient(transport)
    let listed = rooms + [room(mutedRoomId, name: "noise", unreadThreads: 1, muted: true)]
    let threads = CrossRoomThreads()
    try await threads.load(.unread, rooms: listed, scope: "w", client: client, organizationSlug: nil)
    try await threads.load(.earlier, rooms: listed, scope: "w", client: client, organizationSlug: nil)
    #expect(threads.unreadRows(rooms: listed).map(\.parentMessageId) == ["u1"])
    #expect(threads.earlierRows(rooms: listed).map(\.parentMessageId) == ["e2"])
  }

  /// Web's `useThreadRowNames`: the parent's preview with the room's mention names, "Thread" when empty.
  @Test func labelsNameMentionsFromTheirRoomAndFallBackToThread() async throws {
    let transport = TestTransport([
      (200, testMessagesPageBody(messages: [
        unreadJSON("u1", room: alphaRoomId, content: "@\(adaId):ada-lovelace can you take this one"),
        unreadJSON("u2", room: betaRoomId, content: "")
      ], nextCursor: nil))
    ])
    let threads = CrossRoomThreads()
    try await threads.load(.unread, rooms: rooms, scope: "w", client: makeTestClient(transport), organizationSlug: nil)
    #expect(threads.label(for: "u1") == "@Ada Lovelace can you take this one")
    #expect(threads.label(for: "u2") == "Thread")
  }

  // MARK: The Unread group

  /// Web's `UnreadThreadsList`: live rooms at zero already say "All caught up" without asking Core; a
  /// roster that is not live yet is a gap, not caught up, and waits.
  @Test func theRoomsSayCaughtUpBeforeCoreDoes() {
    let threads = CrossRoomThreads()
    let quiet = [room(alphaRoomId, name: "general")]
    #expect(!CrossRoomThreads.shouldLoadUnread(rooms: quiet, roomsLive: true))
    #expect(threads.unreadState(rooms: quiet, roomsLive: true) == .caughtUp)
    #expect(!CrossRoomThreads.shouldLoadUnread(rooms: [], roomsLive: false))
    #expect(threads.unreadState(rooms: [], roomsLive: false) == .loading)
    #expect(CrossRoomThreads.shouldLoadUnread(rooms: rooms, roomsLive: true))
    #expect(threads.unreadState(rooms: rooms, roomsLive: true) == .loading)
    // A muted room's Threads count nowhere.
    let mutedOnly = [room(mutedRoomId, name: "noise", unreadThreads: 3, muted: true)]
    #expect(threads.unreadState(rooms: mutedOnly, roomsLive: true) == .caughtUp)
  }

  /// Core's own empty answer says caught up; a page whose rows were all dropped says nothing while another
  /// page follows, and the paging row takes over.
  @Test func coreSaysCaughtUpOnlyWithNothingLeftToPage() async throws {
    let transport = TestTransport([
      (200, testMessagesPageBody(messages: [unreadJSON("quiet", room: mutedRoomId)], nextCursor: "quiet")),
      (200, testMessagesPageBody(messages: [], nextCursor: nil))
    ])
    let client = try makeTestClient(transport)
    let threads = CrossRoomThreads()
    try await threads.load(.unread, rooms: rooms, scope: "w", client: client, organizationSlug: nil)
    #expect(threads.unreadState(rooms: rooms, roomsLive: true) == .rows)
    #expect(threads.unreadRows(rooms: rooms).isEmpty && threads.unread.loadsOlderAutomatically)
    try await threads.load(.unread, older: true, rooms: rooms, scope: "w", client: client, organizationSlug: nil)
    #expect(threads.unreadState(rooms: rooms, roomsLive: true) == .caughtUp)
  }

  /// A failed first page leaves no rows and says so with Try again; the retry reads the first page again.
  @Test func aFailedFirstPageShowsItsErrorAndARetryRecovers() async throws {
    let transport = TestTransport([
      (200, testMessagesPageBody(messages: [unreadJSON("u1", room: alphaRoomId)], nextCursor: nil)),
      (500, coreError("boom")),
      (200, testMessagesPageBody(messages: [unreadJSON("u2", room: betaRoomId)], nextCursor: nil))
    ])
    let client = try makeTestClient(transport)
    let threads = CrossRoomThreads()
    try await threads.load(.unread, rooms: rooms, scope: "w", client: client, organizationSlug: nil)
    await #expect(throws: (any Error).self) {
      try await threads.load(.unread, rooms: rooms, scope: "w", client: client, organizationSlug: nil)
    }
    #expect(threads.unreadState(rooms: rooms, roomsLive: true) == .failed)
    #expect(threads.unreadRows(rooms: rooms).isEmpty && threads.unread.nextCursor == nil)
    try await threads.load(.unread, rooms: rooms, scope: "w", client: client, organizationSlug: nil)
    #expect(threads.unreadState(rooms: rooms, roomsLive: true) == .rows)
    #expect(threads.unreadRows(rooms: rooms).map(\.parentMessageId) == ["u2"])
  }

  /// Web's `keepPreviousData`: while the rooms' counts move and the list reads Core again, the rows it has
  /// stay on screen until the new page answers.
  @Test func aReReadKeepsTheRowsUntilItAnswers() async throws {
    let threads = CrossRoomThreads()
    try await threads.load(.unread, rooms: rooms, scope: "w", client: makeTestClient(TestTransport([
      (200, testMessagesPageBody(messages: [unreadJSON("u1", room: alphaRoomId)], nextCursor: nil))
    ])), organizationSlug: nil)
    let held = PausedThreadsTransport(body: testMessagesPageBody(messages: [unreadJSON("u2", room: betaRoomId)], nextCursor: nil))
    let heldClient = try Client.connecting(to: #require(URL(string: "https://core.example/v1")), transport: held)
    let reread = Task { try await threads.load(.unread, rooms: rooms, scope: "w", client: heldClient, organizationSlug: nil) }
    await held.waitForRequest()
    #expect(threads.unreadRows(rooms: rooms).map(\.parentMessageId) == ["u1"])
    #expect(threads.unreadState(rooms: rooms, roomsLive: true) == .rows)
    await held.release()
    try await reread.value
    #expect(threads.unreadRows(rooms: rooms).map(\.parentMessageId) == ["u2"])
  }

  /// Web's `ThreadListLoadMore` under both groups: a failed next page stays on its row with the rows kept,
  /// stops loading by itself, and the retry asks for the same cursor.
  @Test func aFailedOlderPageStaysOnItsRowWithTheRowsKept() async throws {
    let transport = TestTransport([
      (200, testMessagesPageBody(messages: [earlierJSON("e1", room: alphaRoomId)], nextCursor: "e1")),
      (500, coreError("boom")),
      (200, testMessagesPageBody(messages: [earlierJSON("e2", room: betaRoomId)], nextCursor: nil))
    ])
    let client = try makeTestClient(transport)
    let threads = CrossRoomThreads()
    try await threads.load(.earlier, rooms: rooms, scope: "w", client: client, organizationSlug: nil)
    #expect(threads.earlier.loadsOlderAutomatically)
    await #expect(throws: (any Error).self) {
      try await threads.load(.earlier, older: true, rooms: rooms, scope: "w", client: client, organizationSlug: nil)
    }
    #expect(threads.earlier.olderPageStatus == .failed && !threads.earlier.loadsOlderAutomatically)
    #expect(threads.earlierRows(rooms: rooms).map(\.parentMessageId) == ["e1"] && threads.showsEarlier(rooms: rooms))
    try await threads.load(.earlier, older: true, rooms: rooms, scope: "w", client: client, organizationSlug: nil)
    #expect(threads.earlier.olderPageStatus == .idle)
    #expect(threads.earlierRows(rooms: rooms).map(\.parentMessageId) == ["e1", "e2"])
    #expect(transport.requests.map { queryItem($0, "cursor") } == [nil, "e1", "e1"])
  }

  // MARK: The Earlier group

  /// Web's `EarlierThreadsList` is absent, heading included, while its first read is out and while it holds
  /// nothing; a failed first read shows the heading with its error.
  @Test func earlierShowsOnlyWithARowOrAFailure() async throws {
    let transport = TestTransport([
      (200, testMessagesPageBody(messages: [], nextCursor: nil)),
      (200, testMessagesPageBody(messages: [earlierJSON("e1", room: alphaRoomId)], nextCursor: nil)),
      (500, coreError("boom"))
    ])
    let client = try makeTestClient(transport)
    let threads = CrossRoomThreads()
    #expect(!threads.showsEarlier(rooms: rooms), "Not while the first read is out.")
    try await threads.load(.earlier, rooms: rooms, scope: "w", client: client, organizationSlug: nil)
    #expect(!threads.showsEarlier(rooms: rooms), "Not while there is none.")
    try await threads.load(.earlier, rooms: rooms, scope: "w", client: client, organizationSlug: nil)
    #expect(threads.showsEarlier(rooms: rooms))
    await #expect(throws: (any Error).self) {
      try await threads.load(.earlier, rooms: rooms, scope: "w", client: client, organizationSlug: nil)
    }
    #expect(threads.showsEarlier(rooms: rooms) && threads.earlier.firstPageFailed)
    #expect(threads.earlierRows(rooms: rooms).isEmpty)
  }

  /// Another workspace's Threads never show under this one: a new scope starts both lists empty.
  @Test func aNewWorkspaceStartsEmpty() async throws {
    let transport = TestTransport([
      (200, testMessagesPageBody(messages: [unreadJSON("u1", room: alphaRoomId)], nextCursor: "u1")),
      (200, testMessagesPageBody(messages: [earlierJSON("e1", room: alphaRoomId)], nextCursor: nil))
    ])
    let client = try makeTestClient(transport)
    let threads = CrossRoomThreads()
    try await threads.load(.unread, rooms: rooms, scope: "first", client: client, organizationSlug: nil)
    try await threads.load(.earlier, rooms: rooms, scope: "first", client: client, organizationSlug: nil)
    let held = PausedThreadsTransport(body: testMessagesPageBody(messages: [], nextCursor: nil))
    let heldClient = try Client.connecting(to: #require(URL(string: "https://core.example/v1")), transport: held)
    let next = Task { try await threads.load(.unread, rooms: rooms, scope: "second", client: heldClient, organizationSlug: "other") }
    await held.waitForRequest()
    #expect(threads.unreadRows(rooms: rooms).isEmpty && threads.unread.nextCursor == nil)
    #expect(threads.unreadState(rooms: rooms, roomsLive: true) == .loading)
    #expect(!threads.showsEarlier(rooms: rooms), "Earlier forgets the old workspace too.")
    await held.release()
    try await next.value
  }

  /// A late page from before a reset never lands.
  @Test func resetDropsALatePage() async throws {
    let threads = CrossRoomThreads()
    let held = PausedThreadsTransport(body: testMessagesPageBody(messages: [unreadJSON("late", room: alphaRoomId)], nextCursor: nil))
    let heldClient = try Client.connecting(to: #require(URL(string: "https://core.example/v1")), transport: held)
    let late = Task { try await threads.load(.unread, rooms: rooms, scope: "w", client: heldClient, organizationSlug: nil) }
    await held.waitForRequest()
    threads.reset()
    await held.release()
    try await late.value
    #expect(threads.unreadRows(rooms: rooms).isEmpty && !threads.unread.hasAnswered && !threads.unread.isLoadingFirstPage)
  }
}

/// Web's `resolveUnreadThreadsAttention` and the lists' query keys (SOK-1159), UI-free.
struct UnreadThreadsAttentionTests {
  @Test func theThreadsEntryCountsThreadsAndMentionsAcrossUnmutedRooms() {
    let attention = resolveUnreadThreadsAttention([
      room(alphaRoomId, name: "general", unreadThreads: 5, threadMentions: 2, listed: [.init(parent: "p1", replies: 1, mentions: 1)]),
      // A snapshot from before Core counted past the cap has only the listed Threads.
      .init(copying: room(betaRoomId, name: "design", listed: [.init(parent: "p2", replies: 3, mentions: 1), .init(parent: "p3", replies: 1, mentions: 0)]), unreadThreadCount: nil),
      room(mutedRoomId, name: "noise", unreadThreads: 9, threadMentions: 4, muted: true)
    ])
    #expect(attention.threadCount == 7)
    #expect(attention.mentionCount == 3)
    #expect(attention.accessibilityLabel == "3 mentions, 7 unread threads")
    #expect(resolveUnreadThreadsAttention([room(alphaRoomId, name: "general", unreadThreads: 1, threadMentions: 0)]).accessibilityLabel == "1 unread thread")
    #expect(resolveUnreadThreadsAttention([room(alphaRoomId, name: "general", unreadThreads: 120, threadMentions: 1)]).accessibilityLabel == "1 mention, More than 99 unread threads")
    #expect(resolveUnreadThreadsAttention([]) == .init(threadCount: 0, mentionCount: 0))
  }

  /// The lists read Core again exactly when a Thread is read, muted or gains a reply; Earlier also when a
  /// room's activity moves. A muted room changes neither.
  @Test func theListsReReadWhenTheRoomsThreadsMove() {
    let base = [room(alphaRoomId, name: "general", unreadThreads: 1, listed: [.init(parent: "p1", replies: 1, mentions: 0)])]
    let unreadKey = unreadThreadsFingerprint(base)
    let earlierKey = earlierThreadsFingerprint(base)
    let replied = [room(alphaRoomId, name: "general", unreadThreads: 1, listed: [.init(parent: "p1", replies: 2, mentions: 0)])]
    #expect(unreadThreadsFingerprint(replied) != unreadKey)
    let active = [room(alphaRoomId, name: "general", unreadThreads: 1, listed: [.init(parent: "p1", replies: 1, mentions: 0)], updatedAt: baseDate.addingTimeInterval(60))]
    #expect(unreadThreadsFingerprint(active) == unreadKey)
    #expect(earlierThreadsFingerprint(active) != earlierKey)
    let withMuted = base + [room(mutedRoomId, name: "noise", unreadThreads: 4, listed: [.init(parent: "p9", replies: 4, mentions: 0)], muted: true)]
    #expect(unreadThreadsFingerprint(withMuted) == unreadKey && earlierThreadsFingerprint(withMuted) == earlierKey)
  }
}

private extension Components.Schemas.ChatRoom {
  init(copying room: Self, unreadThreadCount: Int?) {
    self = room
    self.unreadThreadCount = unreadThreadCount
    unreadThreadMentionCount = nil
  }
}

/// Holds one list request until released, to observe the list while a page is out.
private actor PausedThreadsTransport: ClientTransport {
  private let body: String
  private var requested: CheckedContinuation<Void, Never>?
  private var didRequest = false
  private var gate: CheckedContinuation<Void, Never>?
  private var released = false

  init(body: String) {
    self.body = body
  }

  func waitForRequest() async {
    if didRequest {
      return
    }
    await withCheckedContinuation { requested = $0 }
  }

  func release() {
    released = true
    gate?.resume()
    gate = nil
  }

  func send(_: HTTPRequest, body _: HTTPBody?, baseURL _: URL, operationID _: String) async throws -> (HTTPResponse, HTTPBody?) {
    didRequest = true
    requested?.resume()
    requested = nil
    if !released {
      await withCheckedContinuation { gate = $0 }
    }
    return (HTTPResponse(status: .ok), HTTPBody(body))
  }
}
