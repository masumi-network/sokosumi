import CoreAPI
import Foundation

/// Incremental Channel membership (SOK-1258). Core owns the permission matrix and the Soko Bot cascade; its messages
/// surface as-is. These are organization Channel operations, so the organization header is always sent.
public extension ChatService {
  /// `POST /chats/rooms/{id}/members`: adds without removing; members already present are no-ops.
  func addChannelMembers(client: Client, roomId: String, recipients: Set<DirectRecipient>, organizationSlug: String) async throws -> Components.Schemas.ChatRoom {
    try await call {
      try await client.postChatsRoomsIdMembers(.init(
        path: .init(id: roomId), headers: .init(xOrganizationSlug: organizationSlug), body: .json(addMembersRequest(recipients))
      ))
    }.ok.body.json.data
  }

  /// `DELETE /chats/rooms/{id}/members/{userId}`: a Guest for any host member, a host member for an owner or admin.
  /// Their Soko Bots leave with them. Leaving yourself goes through `members/me`.
  func removeMember(client: Client, roomId: String, userId: String, organizationSlug: String) async throws {
    _ = try await call {
      try await client.deleteChatsRoomsIdMembersUserId(.init(
        path: .init(id: roomId, userId: userId), headers: .init(xOrganizationSlug: organizationSlug)
      ))
    }.ok
  }

  /// `DELETE /chats/rooms/{id}/coworkers/{coworkerId}`: any host member.
  func removeCoworker(client: Client, roomId: String, coworkerId: String, organizationSlug: String) async throws -> Components.Schemas.ChatRoom {
    try await call {
      try await client.deleteChatsRoomsIdCoworkersCoworkerId(.init(
        path: .init(id: roomId, coworkerId: coworkerId), headers: .init(xOrganizationSlug: organizationSlug)
      ))
    }.ok.body.json.data
  }

  /// `DELETE /chats/rooms/{id}/soko-bots/{sokoBotId}`: its owner only.
  func removeSokoBot(client: Client, roomId: String, sokoBotId: String, organizationSlug: String) async throws -> Components.Schemas.ChatRoom {
    try await call {
      try await client.deleteChatsRoomsIdSokoBotsSokoBotId(.init(
        path: .init(id: roomId, sokoBotId: sokoBotId), headers: .init(xOrganizationSlug: organizationSlug)
      ))
    }.ok.body.json.data
  }

  /// One sorted id list per kind; a kind with nobody to add is left out of the body.
  private func addMembersRequest(_ recipients: Set<DirectRecipient>) -> Components.Schemas.AddChatRoomMembersRequest {
    var userIds: [String] = []
    var coworkerIds: [String] = []
    var sokoBotIds: [String] = []
    for recipient in recipients {
      switch recipient {
      case let .human(id): userIds.append(id)
      case let .coworker(id): coworkerIds.append(id)
      case let .sokoBot(id): sokoBotIds.append(id)
      }
    }
    return .init(
      userIds: userIds.isEmpty ? nil : userIds.sorted(),
      coworkerIds: coworkerIds.isEmpty ? nil : coworkerIds.sorted(),
      sokoBotIds: sokoBotIds.isEmpty ? nil : sokoBotIds.sorted()
    )
  }
}
