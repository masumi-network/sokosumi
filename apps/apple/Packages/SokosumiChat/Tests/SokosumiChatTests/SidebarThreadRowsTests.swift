import CoreAPI
import Foundation
import SokosumiChat
import Testing

/// Row 24g2: a room's unread Threads inset under its sidebar row, as web's `ChatRoomThreadRows` lists them
/// (`chat-room-thread-rows.tsx`, its cases in `chat-room-thread-rows.test.tsx` and the room row's in
/// `chat-room-sidebar-row.test.tsx`).
struct SidebarThreadRowsTests {
  private static let fixedDate = Date(timeIntervalSince1970: 1_790_000_000)
  private static let roomId = "550e8400-e29b-41d4-a716-446655440800"
  private static let adaId = "019fc7e4-e4bd-7005-900c-66e44d33f5e4"

  private struct Listed {
    let parent: String
    var content = "Vendor-wide rollout"
    var replies = 2
    var mentions: Int? = 0
  }

  private static func room(
    _ listed: [Listed]?, threadCount: Int? = nil, muted: Bool = false, id: String = roomId
  ) -> Components.Schemas.ChatRoom {
    .init(
      id: id, name: "product-launch", kind: .channel, isSelfDirect: false, isGroupDirect: false,
      discoverability: ._public, createdByUserId: "user_1", createdAt: fixedDate, updatedAt: fixedDate,
      unreadCount: 5, channelUnreadCount: 1, threadUnreadCount: 4, unreadThreadCount: threadCount,
      unreadThreads: listed?.map {
        .init(parentMessageId: $0.parent, firstUnreadReplyId: "\($0.parent)-reply", parentContent: $0.content,
              unreadReplyCount: $0.replies, unreadMentionCount: $0.mentions)
      },
      unreadMentionCount: 0, mutedAt: muted ? fixedDate : nil, markedUnread: false, myAccess: .member,
      userMembers: [.init(id: adaId, name: "Ada Lovelace", email: "ada@example.com", presence: .online)],
      coworkerMembers: [], sokoBotMembers: []
    )
  }

  /// Core ranks and caps the list (newest unread reply first, at most three); the sidebar shows it as sent.
  @Test func listsCoresThreadsInCoresOrder() {
    let rows = sidebarThreadRows(Self.room([.init(parent: "p-3"), .init(parent: "p-1"), .init(parent: "p-2")], threadCount: 3))
    #expect(rows.map(\.parentMessageId) == ["p-3", "p-1", "p-2"])
    #expect(rows.map(\.firstUnreadReplyId) == ["p-3-reply", "p-1-reply", "p-2-reply"], "A row opens at its first unread reply.")
    #expect(rows.allSatisfy { $0.roomId == Self.roomId })
    #expect(Set(rows.map(\.id)).count == 3)
  }

  @Test func namesEachThreadByItsParent() {
    let rows = sidebarThreadRows(Self.room([
      .init(parent: "p-1", content: "Vendor-wide rollout"),
      .init(parent: "p-2", content: "@\(Self.adaId):ada can you check the copy?"),
      .init(parent: "p-3", content: "@all please review **today**"),
      .init(parent: "p-4", content: "")
    ]))
    #expect(rows.map(\.label) == [
      "Vendor-wide rollout", "@Ada Lovelace can you check the copy?", "@Everyone please review today", "Thread"
    ])
    let long = sidebarThreadRows(Self.room([.init(parent: "p-1", content: String(repeating: "word ", count: 60))]))
    #expect(long.first?.label.hasSuffix("…") == true && (long.first?.label.count ?? 0) <= 128, "The preview is cut like web's.")
  }

  /// One number per row: the muted unread reply count, or the mention badge where a reply names the reader.
  /// Both are spoken.
  @Test func drawsOneNumberAndSpeaksBoth() throws {
    let rows = sidebarThreadRows(Self.room([
      .init(parent: "p-1", replies: 3, mentions: 1),
      .init(parent: "p-2", replies: 2),
      .init(parent: "p-3", replies: 1, mentions: nil),
      .init(parent: "p-4", replies: 150, mentions: 12)
    ]))
    #expect(rows.map(\.mentionCount) == [1, 0, 0, 12])
    #expect(rows.map(\.countLabel) == [nil, "2", "1", nil])
    #expect(rows.map(\.accessibilityValue) == [
      "1 mention, 3 unread replies", "2 unread replies", "1 unread reply", "12 mentions, 150 unread replies"
    ])
    let loud = try #require(sidebarThreadRows(Self.room([.init(parent: "p-1", replies: 150)])).first)
    #expect(loud.countLabel == "99+" && loud.accessibilityValue == "150 unread replies")
  }

  /// `unreadThreadCount` is the true number; the overflow row states what the cap left out.
  @Test func statesWhatTheCapLeftOut() {
    let three: [Listed] = [.init(parent: "p-1"), .init(parent: "p-2"), .init(parent: "p-3")]
    #expect(sidebarMoreThreadsCount(Self.room(three, threadCount: 5)) == 2)
    #expect(sidebarMoreThreadsCount(Self.room(three, threadCount: 3)) == 0)
    #expect(sidebarMoreThreadsCount(Self.room(three, threadCount: nil)) == 0, "An older summary counts what it lists.")
    #expect(moreUnreadThreadsLabel(1) == "1 more unread thread")
    #expect(moreUnreadThreadsLabel(4) == "4 more unread threads")
  }

  @Test func insetsTheRowsUnderTheirRoom() {
    let loud = Self.room([.init(parent: "p-1"), .init(parent: "p-2")], threadCount: 4)
    let quiet = Self.room(nil, id: "550e8400-e29b-41d4-a716-446655440801")
    let items = sidebarRoomListItems([loud, quiet])
    #expect(items.map(\.id) == [
      Self.roomId, "\(Self.roomId)/p-1", "\(Self.roomId)/p-2", "\(Self.roomId)/more-threads", quiet.id
    ])
    #expect(items.dropFirst(3).first == .moreThreads(roomId: Self.roomId, count: 2))
  }

  /// Web renders nothing, overflow included, while the room lists no Thread, whatever its count says.
  @Test func listsNothingWithoutAListedThread() {
    #expect(sidebarRoomListItems([Self.room([], threadCount: 4)]).count == 1)
    #expect(sidebarRoomListItems([Self.room(nil, threadCount: 4)]).count == 1)
  }

  /// Room mute outranks everything a room holds; Pinned reorder mode keeps every row one height.
  @Test func aMutedRoomAndReorderModeListNoThread() {
    let listed: [Listed] = [.init(parent: "p-1", mentions: 1)]
    #expect(sidebarRoomListItems([Self.room(listed, threadCount: 3, muted: true)]).map(\.id) == [Self.roomId])
    #expect(sidebarRoomListItems([Self.room(listed, threadCount: 3)], reordering: true).map(\.id) == [Self.roomId])
    #expect(sidebarThreadRows(Self.room(listed, muted: true)).isEmpty)
  }

  /// A room read does not Look a Thread (ADR 0037), so the rows stay until Core's answer to a Look says otherwise.
  @Test func aRoomReadKeepsTheRows() {
    let room = Self.room([.init(parent: "p-1"), .init(parent: "p-2")], threadCount: 4)
    let read = roomAttentionAfterRead(room)
    #expect(sidebarThreadRows(room).count == 2)
    #expect(sidebarThreadRows(read) == sidebarThreadRows(room) && sidebarMoreThreadsCount(read) == 2)
  }

  /// A row opens through the chat notification's link, the same path an in-app link takes.
  @Test func aRowOpensThroughTheMessageLink() throws {
    let base = try #require(URL(string: "https://app.example.com"))
    let row = try #require(sidebarThreadRows(Self.room([.init(parent: "p-1")])).first)
    let url = try #require(ChatLink.href(roomId: row.roomId, messageId: row.firstUnreadReplyId, webBaseURL: base))
    #expect(ChatLink(url: url, webBaseURL: base) == .room(id: Self.roomId, messageId: "p-1-reply"))
  }
}
