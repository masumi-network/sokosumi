import CoreAPI
import Foundation
import SokosumiChat
import Testing

/// Row 24g1: the sidebar row follows ADR 0037 as web's `resolveRoomAttention` does
/// (`room-attention.ts`, and its cases in `room-attention.test.ts`). Bold is Room unread (the channel
/// half) plus the badge and a hand-set mark; a Thread mention is the one Thread escalation; a row draws
/// one number; a Direct of two draws its count, not a mention badge.
struct RoomAttentionTests {
  private static let fixedDate = Date(timeIntervalSince1970: 1_790_000_000)

  private static func member(_ id: String) -> Components.Schemas.ChatRoomUserParticipant {
    .init(id: id, name: id, email: "\(id)@example.com", image: nil, presence: .offline)
  }

  /// A room summary as Core sends it since ADR 0037: `unreadCount` is the sum of the two halves.
  private static func room(
    kind: Components.Schemas.ChatRoom.KindPayload = .channel, members: Int = 0,
    channel: Int?, thread: Int = 0, mentions: Int = 0, marked: Bool = false, muted: Bool = false
  ) -> Components.Schemas.ChatRoom {
    .init(
      id: "550e8400-e29b-41d4-a716-446655440700", name: "general", kind: kind, isSelfDirect: false, isGroupDirect: members > 2,
      discoverability: kind == .channel ? ._public : nil, createdByUserId: "user_1", createdAt: fixedDate, updatedAt: fixedDate,
      unreadCount: (channel ?? 0) + thread, channelUnreadCount: channel, threadUnreadCount: channel == nil ? nil : thread,
      unreadMentionCount: mentions, mutedAt: muted ? fixedDate : nil, markedUnread: marked, myAccess: .member,
      userMembers: (0 ..< members).map { member("user_\($0)") }, coworkerMembers: [], sokoBotMembers: []
    )
  }

  @Test func threadRepliesAloneLeaveTheRowQuiet() {
    #expect(resolveRoomAttention(Self.room(channel: 0, thread: 3), showUnreadCount: true) == .init(bold: false, badgeCount: 0))
  }

  /// The rule that fails silently when wrong: a mention reply counts toward the thread half.
  @Test func aThreadMentionBoldsAndBadgesTheRow() {
    #expect(resolveRoomAttention(Self.room(channel: 0, thread: 1, mentions: 1)) == .init(bold: true, badgeCount: 1))
    #expect(resolveRoomAttention(Self.room(channel: 0, thread: 9, mentions: 1)).badgeCount == 1, "The badge counts mentions only.")
    #expect(resolveRoomAttention(Self.room(channel: 0, thread: 1, mentions: 1), showUnreadCount: true).unreadTextCount == 0,
            "A row bold only by a Thread mention has no Room unread to count.")
  }

  @Test func theCountIsTheChannelHalf() {
    #expect(resolveRoomAttention(Self.room(channel: 2, thread: 3), showUnreadCount: true) == .init(bold: true, badgeCount: 0, unreadTextCount: 2))
    #expect(resolveRoomAttention(Self.room(channel: 2, thread: 3)).unreadTextCount == 0, "Switched off, no number.")
  }

  /// SOK-1147: the badge stands alone; bold says the room holds more.
  @Test func aRowDrawsOneNumber() {
    #expect(resolveRoomAttention(Self.room(channel: 12, mentions: 3), showUnreadCount: true) == .init(bold: true, badgeCount: 3, unreadTextCount: 0))
  }

  @Test func aMutedRoomStaysSilentThreadMentionOrNot() {
    #expect(resolveRoomAttention(Self.room(channel: 2, thread: 2, mentions: 1, muted: true), showUnreadCount: true) == .init(bold: false, badgeCount: 0))
  }

  @Test func aHandMarkedRoomStaysBoldWhenOnlyThreadsAreUnread() {
    #expect(resolveRoomAttention(Self.room(channel: 0, thread: 3, marked: true), showUnreadCount: true) == .init(bold: true, badgeCount: 0))
  }

  @Test func aSnapshotWithoutTheHalvesFallsBackToTheTotal() {
    var room = Self.room(channel: nil)
    room.unreadCount = 4
    #expect(resolveRoomAttention(room, showUnreadCount: true) == .init(bold: true, badgeCount: 0, unreadTextCount: 4))
  }

  @Test func aCountIsNeverShownWithoutBold() {
    for channel in [0, 1, 99] {
      for thread in [0, 3] {
        for mentions in [0, 1] {
          let attention = resolveRoomAttention(Self.room(channel: channel, thread: thread, mentions: mentions), showUnreadCount: true)
          #expect(attention.unreadTextCount == 0 || attention.bold)
        }
      }
    }
  }

  /// Web `roomBadgeCountsMentions`: Core counts every message toward the badge in a Direct of two humans or
  /// fewer, so that row draws the muted count a channel does, not a mention badge; the badge still bolds it.
  @Test func aDirectOfTwoDrawsItsCountNotAMentionBadge() {
    let direct = Self.room(kind: .direct, members: 2, channel: 5, mentions: 5)
    #expect(!roomBadgeCountsMentions(direct))
    #expect(!roomBadgeCountsMentions(Self.room(kind: .direct, members: 1, channel: 0)), "A Direct with yourself too.")
    #expect(roomBadgeCountsMentions(Self.room(kind: .direct, members: 3, channel: 0)), "A group Direct counts mentions.")
    #expect(roomBadgeCountsMentions(Self.room(channel: 0)))
    let shown = resolveRoomAttention(direct, showUnreadCount: true)
    #expect(shown == .init(bold: true, badgeCount: 5, mentionCount: 0, unreadTextCount: 5))
    #expect(shown.badgeLabel == nil && shown.badgeAccessibilityLabel == nil)
    #expect(resolveRoomAttention(direct) == .init(bold: true, badgeCount: 5, mentionCount: 0), "Switched off: bold, no number.")
    #expect(resolveRoomAttention(Self.room(kind: .direct, members: 3, channel: 3, mentions: 1), showUnreadCount: true)
      == .init(bold: true, badgeCount: 1, unreadTextCount: 0))
  }

  /// Web `resolveSectionAttention` goes through the same resolver, so a closed heading agrees with its rows.
  @Test func aClosedSectionFollowsTheRowRule() {
    #expect(resolveSectionAttention([Self.room(channel: 0, thread: 4)]) == nil)
    #expect(resolveSectionAttention([Self.room(channel: 0, thread: 4, mentions: 1)]) == .mention)
    #expect(resolveSectionAttention([Self.room(kind: .direct, members: 2, channel: 1, mentions: 1)]) == .mention,
            "A Direct of two still marks its section: the badge is addressed to the reader.")
  }

  /// Web `roomAttentionAfterRead`: a read empties Room unread, the badge and the mark, and keeps the Thread
  /// half, which only a Look clears; the row goes quiet.
  @Test func aReadKeepsTheThreadHalfAndQuietsTheRow() {
    let read = roomAttentionAfterRead(Self.room(channel: 4, thread: 3, mentions: 2, marked: true))
    #expect(read.unreadCount == 3 && read.channelUnreadCount == 0 && read.threadUnreadCount == 3)
    #expect(read.unreadMentionCount == 0 && !read.markedUnread)
    #expect(resolveRoomAttention(read, showUnreadCount: true) == .init(bold: false, badgeCount: 0))
    let old = roomAttentionAfterRead(Self.room(channel: nil, mentions: 1))
    #expect(old.unreadCount == 0 && old.channelUnreadCount == 0 && old.threadUnreadCount == 0 && old.unreadMentionCount == 0,
            "A snapshot from before the split clears everything.")
  }
}
