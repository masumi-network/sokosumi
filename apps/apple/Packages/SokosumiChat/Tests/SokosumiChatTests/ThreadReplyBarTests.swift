import CoreAPI
import Foundation
import SokosumiChat
import Testing

private let ada = #"{"type":"user","user":{"id":"user_ada","name":"Ada Lovelace","email":"ada@example.com","image":null,"presence":"offline"}}"#
private let grace = #"{"type":"user","user":{"id":"user_grace","name":"Grace Hopper","email":"grace@example.com","image":"https://example.test/grace.png","presence":"online"}}"#
private let elena = #"{"type":"coworker","coworker":{"id":"cow_1","name":"Elena","slug":"elena","caption":null,"image":null,"presence":"online"}}"#
private let linus = #"{"type":"user","user":{"id":"user_linus","name":"Linus","email":"linus@example.com","image":null,"presence":"offline"}}"#
private let unknown = #"{"type":"unknown"}"#
/// 2026-09-24T12:00:00Z, the fixed clock.
private let now = Date(timeIntervalSince1970: 1_790_251_200)

/// Row 24h: the reply bar under a thread parent follows web's `ThreadReplyBar` (room-message-row.tsx) and the
/// counts follow SOK-1151: the room's unread-thread read owns every bar.
@MainActor
struct ThreadReplyBarTests {
  private func row(_ id: String, sender: String = ada) async throws -> Components.Schemas.ChatRoomMessage {
    try #require(try await fetchTestMessages([testMessageJSON(id: id, content: "Hello", sender: sender)]).first)
  }

  private func sender(_ json: String) async throws -> Components.Schemas.ChatRoomMessageSender {
    try await row("sender", sender: json).sender
  }

  private func parent(replies: Int, unread: Int?, repliers: [String] = []) async throws -> Components.Schemas.ChatRoomMessage {
    var message = try await row("parent")
    message.threadReplyCount = replies
    message.threadUnreadReplyCount = unread
    message.threadLastReplyAt = replies > 0 ? now.addingTimeInterval(-240) : nil
    var senders: [Components.Schemas.ChatRoomMessageSender] = []
    for json in repliers {
      try await senders.append(sender(json))
    }
    message.threadRepliers = repliers.isEmpty ? nil : senders
    return message
  }

  @Test func onlyAParentWithRepliesHasABar() async throws {
    #expect(try await ThreadReplyBar(message: parent(replies: 0, unread: nil)) == nil)
    let bar = try #require(try await ThreadReplyBar(message: parent(replies: 1, unread: nil)))
    #expect(bar.replyCount == 1 && bar.lastReplyAt == now.addingTimeInterval(-240) && bar.faces.isEmpty)
  }

  /// `Thread.replyCount` read, `Thread.newReplyCount` unread; the unread count wins the label.
  @Test(arguments: [
    (ThreadReplyBarLabelCase(replies: 1, unread: nil), "1 reply"), (ThreadReplyBarLabelCase(replies: 3, unread: 0), "3 replies"),
    (ThreadReplyBarLabelCase(replies: 3, unread: 1), "1 new reply"), (ThreadReplyBarLabelCase(replies: 5, unread: 2), "2 new replies")
  ])
  func labelsFollowWeb(counts: ThreadReplyBarLabelCase, label: String) async throws {
    let bar = try #require(try await ThreadReplyBar(message: parent(replies: counts.replies, unread: counts.unread)))
    #expect(bar.isUnread == ((counts.unread ?? 0) > 0))
    #expect(bar.label == label)
  }

  /// Core's repliers in the order they joined; the id is web's `senderKey`, and an unknown sender still
  /// gets a face of its own.
  @Test func facesKeepCoresOrderWithStableIds() async throws {
    let bar = try #require(try await ThreadReplyBar(message: parent(replies: 4, unread: 0, repliers: [grace, elena, unknown])))
    #expect(bar.faces.map(\.id) == ["user:user_grace", "coworker:cow_1", "unknown-2"])
    #expect(bar.faces.map(\.name) == ["Grace Hopper", "Elena", "Unknown"])
    #expect(bar.faces.map(\.imageURL) == ["https://example.test/grace.png", nil, nil])
  }

  /// next-intl's `relativeTime(…, { style: "narrow" })`: the largest unit that fits, rounded like
  /// `Math.round` (half up), "now" only for seconds, never "yesterday".
  @Test(arguments: [
    (0, "now"), (-30, "30s ago"), (-89, "1m ago"), (-150, "2m ago"), (-3 * 3600, "3h ago"),
    (-86400, "1d ago"), (-14 * 86400, "2w ago"), (-90 * 86400, "3mo ago"), (-400 * 86400, "1y ago")
  ] as [(Double, String)])
  func ageFollowsWebsNarrowRelativeTime(offset: Double, label: String) {
    #expect(threadReplyAgeLabel(since: now.addingTimeInterval(offset), now: now, locale: Locale(identifier: "en_US")) == label)
  }

  /// Web's `applyThreadUnreadReplyCounts`: once the read answered it owns every bar, and a parent absent
  /// from it has no unread replies, whatever the message list said.
  @Test func theUnreadReadOwnsEveryBar() async throws {
    let listed = try await parent(replies: 3, unread: 2)
    var other = try await parent(replies: 2, unread: nil)
    other.id = "other"
    let shown = applyThreadUnreadReplyCounts([listed, other], counts: ["other": 1])
    #expect(shown.map(\.threadUnreadReplyCount) == [0, 1])
    #expect(applyThreadUnreadReplyCounts(shown, counts: ["other": 1]) == shown)
  }

  /// Web's `clearThreadUnreadReplies` on the loaded rows: only the cleared Threads lose their tint.
  @Test func clearingZeroesOnlyTheClearedBars() async throws {
    let looked = try await parent(replies: 3, unread: 2)
    var kept = try await parent(replies: 2, unread: 1)
    kept.id = "kept"
    let shown = clearingThreadUnreadReplies([looked, kept]) { $0 == "parent" }
    #expect(shown.map(\.threadUnreadReplyCount) == [0, 1])
  }

  /// Web's `keepKnownThreadUnreadReplyCount`: a realtime copy of the parent (an edit) states no count, so the
  /// known one stays; a copy that states one wins.
  @Test func aRealtimeCopyKeepsTheKnownCount() async throws {
    let known = try await parent(replies: 3, unread: 2)
    var edited = known
    edited.content = "Edited"
    edited.threadUnreadReplyCount = nil
    let applied = applyRealtimeFullEvent(messages: [known], shells: [], eventType: .update, message: edited).messages
    #expect(applied.first?.content == "Edited" && applied.first?.threadUnreadReplyCount == 2)
    edited.threadUnreadReplyCount = 0
    #expect(keepKnownThreadUnreadReplyCount(known: known, incoming: edited).threadUnreadReplyCount == 0)
  }

  /// Web's `applyReplyToParentThreadPreview`: this client's reply counts, takes the age and joins the faces
  /// last; a repeat replier keeps their place and the faces stop at three.
  @Test func ownReplyJoinsTheFacesLast() async throws {
    let start = try await parent(replies: 2, unread: 0, repliers: [grace, elena])
    var reply = try await row("reply", sender: ada)
    reply.createdAt = now
    let first = applyingReplyToParentThreadPreview(start, reply: reply)
    #expect(first.threadReplyCount == 3 && first.threadLastReplyAt == now)
    #expect(first.threadRepliers?.compactMap(senderId) == ["user_grace", "cow_1", "user_ada"])
    let repeated = applyingReplyToParentThreadPreview(first, reply: reply)
    #expect(repeated.threadReplyCount == 4 && repeated.threadRepliers == first.threadRepliers)
    let full = try await applyingReplyToParentThreadPreview(first, reply: row("fourth", sender: linus))
    #expect(full.threadRepliers?.compactMap(senderId) == ["user_grace", "cow_1", "user_ada"])
  }

  /// Web's `tombstoneChatRoomMessage` spreads the row: a deleted parent keeps its reply bar whole.
  @Test func aDeletedParentKeepsItsBar() async throws {
    let start = try await parent(replies: 2, unread: 1, repliers: [grace])
    let tombstone = tombstoneTranscriptMessage(start, now: now)
    #expect(tombstone.content.isEmpty && tombstone.deletedAt == now)
    #expect(tombstone.threadUnreadReplyCount == 1 && tombstone.threadRepliers == start.threadRepliers)
    #expect(tombstone.threadReplyCount == 2 && tombstone.threadLastReplyAt == start.threadLastReplyAt)
  }
}

struct ThreadReplyBarLabelCase: Sendable, CustomTestStringConvertible {
  let replies: Int
  let unread: Int?

  var testDescription: String {
    "\(replies) replies, \(unread.map(String.init) ?? "no") unread"
  }
}

private func senderId(_ sender: Components.Schemas.ChatRoomMessageSender) -> String? {
  switch sender {
  case let .case1(user): user.user.id
  case let .case2(coworker): coworker.coworker.id
  case let .case3(bot): bot.sokoBot.id
  case .case4: nil
  }
}
