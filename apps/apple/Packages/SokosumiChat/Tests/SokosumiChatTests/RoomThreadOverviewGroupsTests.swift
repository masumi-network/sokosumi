import CoreAPI
import Foundation
import SokosumiChat
import Testing

/// Row 24d: web's thread overview divides the loaded threads under "Unread" and "Earlier"
/// (`thread-list-panel.tsx`, `threadNeedsOverviewUnread`).
@MainActor
struct RoomThreadOverviewGroupsTests {
  @Test func splitsByUnreadRepliesAndKeepsCoreOrderInEachGroup() {
    let groups = RoomThreadOverviewGroups(threads: [
      thread("a", unread: 2), thread("b", unread: 0), thread("c", unread: 1), thread("d", unread: 0)
    ])
    #expect(groups.unread.map(\.parentMessage.id) == ["a", "c"])
    #expect(groups.earlier.map(\.parentMessage.id) == ["b", "d"])
  }

  /// Only `unreadReplyCount` decides: a muted thread or one never looked at sits wherever its count puts it.
  @Test func onlyTheUnreadReplyCountDecides() {
    let muted = thread("muted", unread: 1, mutedAt: Date(timeIntervalSince1970: 1_790_000_000))
    let mutedRead = thread("muted-read", unread: 0, mutedAt: Date(timeIntervalSince1970: 1_790_000_000))
    let neverLooked = thread("never-looked", unread: 0, hasLooked: false)
    let negative = thread("negative", unread: -1)
    let groups = RoomThreadOverviewGroups(threads: [muted, mutedRead, neverLooked, negative])
    #expect(groups.unread.map(\.parentMessage.id) == ["muted"])
    #expect(groups.earlier.map(\.parentMessage.id) == ["muted-read", "never-looked", "negative"])
    #expect(RoomThreadOverviewGroups.isUnread(muted) && !RoomThreadOverviewGroups.isUnread(negative))
  }

  struct Headings: Equatable, CustomTestStringConvertible {
    var unread: Bool
    var caughtUp: Bool
    var earlier: Bool
    var testDescription: String {
      "unread \(unread), caught up \(caughtUp), earlier \(earlier)"
    }
  }

  @Test(arguments: [
    ([Int](), Headings(unread: false, caughtUp: false, earlier: false)), // a room with no threads: only its empty state
    ([0, 0], Headings(unread: true, caughtUp: true, earlier: true)), // all read: "All caught up" under Unread
    ([2, 1], Headings(unread: true, caughtUp: false, earlier: false)), // all unread: Unread alone
    ([3, 0], Headings(unread: true, caughtUp: false, earlier: true)) // mixed
  ])
  func headingVisibilityFollowsWeb(unreadCounts: [Int], expected: Headings) {
    let groups = RoomThreadOverviewGroups(threads: unreadCounts.enumerated().map { thread("t\($0.offset)", unread: $0.element) })
    #expect(Headings(unread: groups.showsUnreadHeading, caughtUp: groups.isCaughtUp, earlier: groups.showsEarlierHeading) == expected)
  }

  /// A looked thread moves when the overview loads again (going back from the thread reloads the first
  /// page, as web remounts its panel): Core now answers `unreadReplyCount: 0`, so the row sits under Earlier.
  @Test func aLookedThreadMovesToEarlierWhenTheOverviewReloads() async throws {
    let transport = TestTransport([
      (200, testMessagesPageBody(messages: [threadJSON(id: "looked", unread: 2), threadJSON(id: "other", unread: 1),
                                            threadJSON(id: "old", unread: 0)], nextCursor: nil)),
      (200, testMessagesPageBody(messages: [threadJSON(id: "other", unread: 1), threadJSON(id: "looked", unread: 0),
                                            threadJSON(id: "old", unread: 0)], nextCursor: nil))
    ])
    let overview = RoomThreadOverview()
    let client = try makeTestClient(transport)
    try await overview.load(client: client, roomId: testRoomId, organizationSlug: nil)
    #expect(overview.groups.unread.map(\.parentMessage.id) == ["looked", "other"])
    #expect(overview.groups.earlier.map(\.parentMessage.id) == ["old"])
    try await overview.load(client: client, roomId: testRoomId, organizationSlug: nil)
    #expect(overview.groups.unread.map(\.parentMessage.id) == ["other"])
    #expect(overview.groups.earlier.map(\.parentMessage.id) == ["looked", "old"])
  }

  /// Mark all moves the rows only once Core's reload answers; a muted thread with an unread mention stays.
  @Test func markAllReadRegroupsFromTheReload() async throws {
    let transport = TestTransport([
      (200, testMessagesPageBody(messages: [threadJSON(id: "plain", unread: 2), threadJSON(id: "muted-mention", unread: 1)], nextCursor: nil)),
      (200, #"{"data":{"markedCount":1},"meta":{"timestamp":"2026-01-01T00:00:00.000Z","requestId":"test"}}"#),
      (200, testMessagesPageBody(messages: [threadJSON(id: "muted-mention", unread: 1), threadJSON(id: "plain", unread: 0)], nextCursor: nil))
    ])
    let overview = RoomThreadOverview()
    let client = try makeTestClient(transport)
    try await overview.load(client: client, roomId: testRoomId, organizationSlug: nil)
    var groupsWhenLooked: RoomThreadOverviewGroups?
    try await overview.markAllRead(client: client, roomId: testRoomId, organizationSlug: nil) {
      groupsWhenLooked = overview.groups
    }
    #expect(groupsWhenLooked?.unread.count == 2, "Nothing moves before Core's reload answers.")
    #expect(overview.groups.unread.map(\.parentMessage.id) == ["muted-mention"])
    #expect(overview.groups.earlier.map(\.parentMessage.id) == ["plain"])
  }

  /// Paging appends older threads; Core lists unread first, so they land under Earlier.
  @Test func olderPagesGrowEarlier() async throws {
    let transport = TestTransport([
      (200, testMessagesPageBody(messages: [threadJSON(id: "new", unread: 1)], nextCursor: "older")),
      (200, testMessagesPageBody(messages: [threadJSON(id: "older", unread: 0)], nextCursor: nil))
    ])
    let overview = RoomThreadOverview()
    let client = try makeTestClient(transport)
    try await overview.load(client: client, roomId: testRoomId, organizationSlug: nil)
    #expect(!overview.groups.showsEarlierHeading)
    try await overview.load(client: client, roomId: testRoomId, organizationSlug: nil, older: true)
    #expect(overview.groups.unread.map(\.parentMessage.id) == ["new"])
    #expect(overview.groups.earlier.map(\.parentMessage.id) == ["older"])
  }

  private func thread(_ id: String, unread: Int, hasLooked: Bool = true, mutedAt: Date? = nil) -> Components.Schemas.ChatRoomThread {
    let sender = Components.Schemas.ChatRoomUserParticipant(id: "user", name: "Ada", email: "ada@example.com", presence: .offline)
    var parent = chatRoomMessage(from: OutboundShell(clientTurnId: id, roomId: testRoomId, content: "Thread \(id)",
                                                     createdAt: Date(timeIntervalSince1970: 1_790_000_000), sender: sender))
    parent.id = id
    return Components.Schemas.ChatRoomThread(parentMessage: parent, replyCount: 3, lastReplyAt: Date(timeIntervalSince1970: 1_790_000_000),
                                             unreadReplyCount: unread, hasLooked: hasLooked, mutedAt: mutedAt)
  }

  private func threadJSON(id: String, unread: Int) -> String {
    let parent = testMessageJSON(id: id, content: "Thread", sender: testUserSender(name: "Ada", email: "ada@example.com"))
    return """
    {"parentMessage":\(parent),"replyCount":3,"lastReplyAt":"2026-09-15T12:00:00.000Z","unreadReplyCount":\(unread),"lastUnreadReplyAt":null,"hasLooked":true}
    """
  }
}
