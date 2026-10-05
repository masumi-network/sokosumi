import CoreAPI
import Foundation
@testable import SokosumiChat
import Testing

/// Mirrors web `room-helpers-direct-display-order.test.ts` (Former members), `read-only-direct-notice.test.tsx`,
/// `direct-room-avatar-stack.tsx` and #5649's `canOpenThread`.
private let reader = Components.Schemas.ChatRoomUserParticipant(id: "me", name: "Andreas", email: "andreas@example.com", presence: .online)

private func human(_ name: String) -> Components.Schemas.ChatRoomUserParticipant {
  .init(id: name.lowercased(), name: name, email: "\(name.lowercased())@example.com", presence: .online)
}

private func former(_ name: String, email: String? = nil) -> Components.Schemas.ChatRoomFormerUserMember {
  .init(id: name.lowercased(), name: name, email: email ?? "\(name.lowercased())@example.com", image: "https://example.com/\(name).png")
}

private func direct(
  readOnly: Bool = true,
  groupName: String? = nil,
  isSelfDirect: Bool = false,
  users: [Components.Schemas.ChatRoomUserParticipant] = [reader],
  former: [Components.Schemas.ChatRoomFormerUserMember] = []
) -> Components.Schemas.ChatRoom {
  .init(
    id: "room", name: "Direct", kind: .direct, isSelfDirect: isSelfDirect, isGroupDirect: false, isReadOnly: readOnly,
    groupName: groupName, createdByUserId: "me", createdAt: .distantPast, updatedAt: .distantPast, unreadCount: 0,
    unreadMentionCount: 0, markedUnread: false, myAccess: .init(value1: .member, value2: "member"), userMembers: users,
    formerUserMembers: former, coworkerMembers: [], sokoBotMembers: []
  )
}

private func message(replies: Int) -> Components.Schemas.ChatRoomMessage {
  var message = chatRoomMessage(from: .init(clientTurnId: "m1", roomId: "room", content: "Hello", createdAt: .distantPast,
                                            sender: .init(id: "sarthi", name: "Sarthi", email: "sarthi@example.com", presence: .offline)))
  message.id = "m1"
  message.threadReplyCount = replies
  return message
}

struct ReadOnlyDirectTests {
  // MARK: Name

  @Test func isNamedAfterTheFormerMembersNotTheViewer() {
    #expect(roomDisplayName(direct(former: [former("Sarthi")]), currentUserId: "me") == "Sarthi")
  }

  @Test func listsSeveralFormerMembersLikeAnyDirect() {
    let room = direct(former: ["Ben", "Cara", "Dan", "Eve"].map { former($0) })
    #expect(roomDisplayName(room, currentUserId: "me") == "Ben, Cara, Dan and 1 more")
  }

  @Test func aFormerMemberWithoutANameGoesByEmail() {
    #expect(roomDisplayName(direct(former: [former("", email: "x@example.com")]), currentUserId: "me") == "x@example.com")
  }

  @Test func fallsBackToTheStoredNameWhenNoFormerProfileIsLeft() {
    #expect(roomDisplayName(direct(), currentUserId: "me") == "Direct")
  }

  @Test func keepsNamingThePeopleStillInAGroup() {
    let room = direct(readOnly: false, users: [reader, human("Ada")], former: [former("Ben")])
    #expect(roomDisplayName(room, currentUserId: "me") == "Ada")
  }

  @Test func aSelfDirectIsYou() {
    #expect(roomDisplayName(direct(readOnly: false, isSelfDirect: true), currentUserId: "me") == "You")
  }

  // MARK: Faces

  @Test func showsTheFormerMembersFacesWhenEveryPeerIsGone() {
    let room = direct(former: ["Ben", "Cara", "Dan", "Eve"].map { former($0) })
    let faces = directRoomAvatarParticipants(room, currentUserId: "me")
    #expect(faces.map(\.name) == ["Ben", "Cara", "Dan"])
    #expect(faces.first?.imageURL == "https://example.com/Ben.png")
    #expect(faces.allSatisfy { !$0.isAI && $0.presence == .offline })
  }

  @Test func showsThePeersStillInTheDirectRatherThanFormerMembers() {
    let room = direct(readOnly: false, users: [reader, human("Ada")], former: [former("Ben")])
    #expect(directRoomAvatarParticipants(room, currentUserId: "me").map(\.name) == ["Ada"])
  }

  // MARK: Notice

  @Test func noticeNamesWhoLeft() {
    #expect(ReadOnlyDirectNotice(room: direct(former: [former("Sarthi")])) == .named(members: "Sarthi", count: 1))
  }

  @Test func noticeNamesThePeopleWhoLeftNotTheGroupName() {
    let room = direct(groupName: "Launch team", former: [former("Ben"), former("Cara")])
    #expect(ReadOnlyDirectNotice(room: room) == .named(members: "Ben, Cara", count: 2))
  }

  @Test func noticeStillExplainsItselfWhenNoFormerProfileIsLeft() {
    #expect(ReadOnlyDirectNotice(room: direct()) == .unnamed)
  }

  @Test func noticeSaysNothingWhileTheRoomTakesMessages() {
    #expect(ReadOnlyDirectNotice(room: direct(readOnly: false, former: [former("Ben")])) == nil)
    #expect(ReadOnlyDirectNotice(room: nil) == nil)
  }

  // MARK: Actions

  @Test func aReadOnlyDirectTakesNoNewMessagesReactionsOrQuotes() {
    #expect(!roomTakesNewMessages(direct()))
    #expect(roomTakesNewMessages(direct(readOnly: false)))
    #expect(roomTakesNewMessages(nil))
  }

  @Test func onlyAThreadWithRepliesOpensInAReadOnlyDirect() {
    #expect(!canOpenThread(message(replies: 0), in: direct()))
    #expect(canOpenThread(message(replies: 2), in: direct()))
    #expect(canOpenThread(message(replies: 0), in: direct(readOnly: false)))
  }
}
