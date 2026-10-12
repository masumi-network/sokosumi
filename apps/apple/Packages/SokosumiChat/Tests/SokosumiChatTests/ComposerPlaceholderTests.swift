import CoreAPI
import Foundation
import SokosumiChat
import Testing

/// Row 41: the composer's prompt is web's (`rooms-client.tsx` placeholder, `thread-panel.tsx` `Thread.replyPlaceholder`).
struct ComposerPlaceholderTests {
  private static let created = Date(timeIntervalSince1970: 1_790_000_000)
  private static let reader = "user_reader"

  private static func room(kind: Components.Schemas.ChatRoom.KindPayload, name: String,
                           members: [Components.Schemas.ChatRoomUserParticipant] = []) -> Components.Schemas.ChatRoom {
    .init(
      id: "550e8400-e29b-41d4-a716-446655440041", organizationId: "org_1", name: name, kind: kind, isSelfDirect: false,
      isGroupDirect: false, isReadOnly: false, discoverability: kind == .channel ? ._public : nil, createdByUserId: reader,
      createdAt: created, updatedAt: created, unreadCount: 0, unreadMentionCount: 0, markedUnread: false,
      myAccess: .init(value1: .member, value2: "member"), userMembers: members, formerUserMembers: [], coworkerMembers: [],
      sokoBotMembers: []
    )
  }

  @Test func aChannelIsNamedWithItsHash() {
    #expect(composerPlaceholder(room: Self.room(kind: .channel, name: "launch"), currentUserId: Self.reader, inThread: false)
      == "Message #launch")
  }

  @Test func aDirectIsNamedAfterTheOtherPerson() {
    let direct = Self.room(kind: .direct, name: "Direct", members: [
      .init(id: Self.reader, name: "Reader", email: "reader@example.com", image: nil, presence: .online),
      .init(id: "user_ada", name: "Ada Lovelace", email: "ada@example.com", image: nil, presence: .online)
    ])
    #expect(composerPlaceholder(room: direct, currentUserId: Self.reader, inThread: false) == "Message Ada Lovelace")
  }

  @Test func aThreadAsksForAReplyInThread() {
    #expect(composerPlaceholder(room: Self.room(kind: .channel, name: "launch"), currentUserId: Self.reader, inThread: true)
      == "Reply in thread")
  }
}
