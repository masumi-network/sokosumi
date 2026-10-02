import CoreAPI
import Foundation
import SokosumiAuth
import SokosumiChat

/// The members panel's membership changes (SOK-1258). Each one shares the single-flight channel update, takes the
/// room back in place and never navigates; a removed person's own client receives Core's membership-revoked event.
public extension WorkspaceState {
  /// Organization owner or admin, read once per workspace with the Archived section. False until that read lands
  /// or when it failed, like web's room page.
  var isOrganizationOwnerOrAdmin: Bool {
    archivedChannels.canDelete
  }

  func addChannelMembers(_ recipients: Set<DirectRecipient>, roomId: String, context: UUID, auth: AuthState) async throws -> Bool {
    guard !recipients.isEmpty, canStartMutation(context: context) else { return false }
    updatingRoom = true
    defer {
      if context == compositionContext {
        updatingRoom = false
      }
    }
    let room = try await channelOperation(context: context, auth: auth) { client, _, slug in
      try await ChatService().addChannelMembers(client: client, roomId: roomId, recipients: recipients, organizationSlug: slug)
    }
    if let index = rooms.firstIndex(where: { $0.id == room.id }) {
      rooms[index] = room
    }
    return true
  }

  /// A person's removal answers without the room, so the person and the Soko Bots that leave with them drop locally;
  /// a Coworker or Soko Bot removal returns Core's room.
  @discardableResult
  func removeChannelMember(_ member: DirectRecipient, roomId: String, context: UUID, auth: AuthState) async throws -> Bool {
    guard canStartMutation(context: context) else { return false }
    updatingRoom = true
    defer {
      if context == compositionContext {
        updatingRoom = false
      }
    }
    let updated: Components.Schemas.ChatRoom? = try await channelOperation(context: context, auth: auth) { client, _, slug in
      switch member {
      case let .human(userId):
        try await ChatService().removeMember(client: client, roomId: roomId, userId: userId, organizationSlug: slug)
        return nil
      case let .coworker(coworkerId):
        return try await ChatService().removeCoworker(client: client, roomId: roomId, coworkerId: coworkerId, organizationSlug: slug)
      case let .sokoBot(sokoBotId):
        return try await ChatService().removeSokoBot(client: client, roomId: roomId, sokoBotId: sokoBotId, organizationSlug: slug)
      }
    }
    guard let index = rooms.firstIndex(where: { $0.id == roomId }) else { return true }
    if let updated {
      rooms[index] = updated
    } else if case let .human(userId) = member {
      var room = rooms[index]
      room.userMembers.removeAll { $0.id == userId }
      room.sokoBotMembers.removeAll { $0.ownerUserId == userId }
      rooms[index] = room
    }
    return true
  }
}
