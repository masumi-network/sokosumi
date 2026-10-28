import CoreAPI
import Foundation
@testable import SokosumiChat
import Testing

private func room(
  kind: Components.Schemas.ChatRoom.KindPayload, organizationId: String?, discoverability: Components.Schemas.ChatRoom.DiscoverabilityPayload? = nil,
  access: Components.Schemas.ChatRoomAccess = .member, coworker: Bool = false, sokoBot: Bool = false
) -> Components.Schemas.ChatRoom {
  .init(
    id: "room", organizationId: organizationId, name: "Room", slug: nil, kind: kind, isSelfDirect: false, isGroupDirect: false, isReadOnly: false, topic: nil,
    discoverability: discoverability, createdByUserId: "me", createdAt: .distantPast, updatedAt: .distantPast,
    unreadCount: 0, unreadMentionCount: 0, markedUnread: false, myAccess: .init(value1: access, value2: .init(stringLiteral: access.rawValue)),
    userMembers: [], formerUserMembers: [],
    coworkerMembers: coworker ? [.init(id: "agent", name: "Agent", slug: "agent", presence: .online)] : [],
    sokoBotMembers: sokoBot ? [.init(id: "bot", name: "Assistant", caption: nil, ownerUserId: "me", scope: .personal, presence: .offline)] : []
  )
}

@Test func roomsShownInEveryWorkspaceFollowCoreVisibility() {
  // Personal Direct, External channel (host member or guest) and an org-less matched channel a member is in.
  #expect(room(kind: .direct, organizationId: nil).isShownInEveryWorkspace)
  #expect(room(kind: .channel, organizationId: "org", discoverability: .external).isShownInEveryWorkspace)
  #expect(room(kind: .channel, organizationId: "org", discoverability: .external, access: .guest).isShownInEveryWorkspace)
  #expect(room(kind: .channel, organizationId: nil, discoverability: .matched).isShownInEveryWorkspace)
  // Channels and AI 1:1s stay in their workspace.
  #expect(!room(kind: .channel, organizationId: "org", discoverability: ._public).isShownInEveryWorkspace)
  #expect(!room(kind: .channel, organizationId: "org", discoverability: ._private).isShownInEveryWorkspace)
  #expect(!room(kind: .channel, organizationId: "org", discoverability: .matched).isShownInEveryWorkspace)
  #expect(!room(kind: .direct, organizationId: "org").isShownInEveryWorkspace)
  #expect(!room(kind: .direct, organizationId: nil, coworker: true).isShownInEveryWorkspace)
  #expect(!room(kind: .direct, organizationId: nil, sokoBot: true).isShownInEveryWorkspace)
}
