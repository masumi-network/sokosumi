import CoreAPI
import Foundation
import SokosumiChat

/// The members panel's membership changes (SOK-1258). Each one shares the single-flight channel update, takes the
/// room back in place and never navigates; a removed person's own client receives Core's membership-revoked event.
public extension WorkspaceState {
  /// Organization owner or admin, read once per workspace with the Archived section. False until that read lands
  /// or when it failed, like web's room page.
  var isOrganizationOwnerOrAdmin: Bool {
    archivedChannels.canDelete
  }

  func addChannelMembers(_ recipients: Set<DirectRecipient>, roomId: String, context: UUID) async throws -> Bool {
    guard !recipients.isEmpty else { return false }
    return try await exclusive(.updateRoom, context: context) {
      let room = try await channelOperation(context: context) { client, _, slug in
        try await service.addChannelMembers(client: client, roomId: roomId, recipients: recipients, organizationSlug: slug)
      }
      // A list read already in flight predates this roster edit.
      sidebar.invalidateRefresh()
      if let index = rooms.firstIndex(where: { $0.id == room.id }) {
        rooms[index] = room
      }
    }
  }

  /// A person's removal answers without the room, so the person and the Soko Bots that leave with them drop locally;
  /// a Coworker or Soko Bot removal returns Core's room.
  @discardableResult
  func removeChannelMember(_ member: DirectRecipient, roomId: String, context: UUID) async throws -> Bool {
    try await exclusive(.updateRoom, context: context) {
      let updated: Components.Schemas.ChatRoom? = try await channelOperation(context: context) { client, _, slug in
        switch member {
        case let .human(userId):
          try await service.removeMember(client: client, roomId: roomId, userId: userId, organizationSlug: slug)
          return nil
        case let .coworker(coworkerId):
          return try await service.removeCoworker(client: client, roomId: roomId, coworkerId: coworkerId, organizationSlug: slug)
        case let .sokoBot(sokoBotId):
          return try await service.removeSokoBot(client: client, roomId: roomId, sokoBotId: sokoBotId, organizationSlug: slug)
        }
      }
      // A list read already in flight predates this roster edit.
      sidebar.invalidateRefresh()
      guard let index = rooms.firstIndex(where: { $0.id == roomId }) else { return }
      if let updated {
        rooms[index] = updated
      } else if case let .human(userId) = member {
        var room = rooms[index]
        room.userMembers.removeAll { $0.id == userId }
        room.sokoBotMembers.removeAll { $0.ownerUserId == userId }
        rooms[index] = room
      }
    }
  }
}
