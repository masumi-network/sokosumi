import CoreAPI

public extension Components.Schemas.ChatRoom {
  /// Core's `membershipVisibleActiveRoomWhere` (ADR 0059): External channels, org-less matched channels and Personal
  /// Directs (org-less, no Coworker or Soko Bot) list in every workspace, so they stay one room across a switch.
  var isShownInEveryWorkspace: Bool {
    if kind == .channel {
      return discoverability == .external
        || (organizationId == nil && discoverability == .matched && myAccess.value1 == .member)
    }
    return organizationId == nil && coworkerMembers.isEmpty && sokoBotMembers.isEmpty
  }
}

public extension [Components.Schemas.ChatRoom] {
  /// Whether the listed room with this id shows in every workspace; false when it is not listed.
  func isShownInEveryWorkspace(roomId: String) -> Bool {
    first { $0.id == roomId }?.isShownInEveryWorkspace == true
  }
}
