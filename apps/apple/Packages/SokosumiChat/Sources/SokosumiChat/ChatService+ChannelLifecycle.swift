import CoreAPI
import Foundation

/// Web `chat-room.service.ts` lifecycle calls. Core owns every role, membership and last-member rule; its messages surface as-is.
public extension ChatService {
  /// `DELETE /chats/rooms/{id}/members/me`. Guest and matched rooms can be left from a personal workspace, so the header stays optional.
  func leaveChannel(client: Client, roomId: String, organizationSlug: String?) async throws {
    _ = try await call { try await client.deleteChatsRoomsIdMembersMe(.init(path: .init(id: roomId), headers: .init(xOrganizationSlug: organizationSlug))) }.ok
  }

  /// `POST /chats/rooms/{id}/archive`.
  func archiveChannel(client: Client, roomId: String, organizationSlug: String) async throws {
    _ = try await call { try await client.postChatsRoomsIdArchive(.init(path: .init(id: roomId), headers: .init(xOrganizationSlug: organizationSlug))) }.ok
  }

  /// `POST /chats/rooms/{id}/restore`; returns the live room DTO.
  func restoreChannel(client: Client, roomId: String, organizationSlug: String) async throws -> Components.Schemas.ChatRoom {
    try await call { try await client.postChatsRoomsIdRestore(.init(path: .init(id: roomId), headers: .init(xOrganizationSlug: organizationSlug))) }.ok.body.json.data
  }

  /// `DELETE /chats/rooms/{id}`: permanent, archived channels only.
  func deleteChannel(client: Client, roomId: String, organizationSlug: String) async throws {
    _ = try await call { try await client.deleteChatsRoomsId(.init(path: .init(id: roomId), headers: .init(xOrganizationSlug: organizationSlug))) }.noContent
  }

  /// Web `listArchivedRooms` plus the owner/admin flag that enables Delete. Web reads the two apart
  /// (`private-sidebar-cache.ts`): a failed role read still lists the rooms, with Delete off.
  func archivedChannels(client: Client, organizationId: String, organizationSlug: String) async throws -> ArchivedChannelList {
    let canDelete = try await organizationOwnerOrAdminIfReadable(client: client, organizationId: organizationId)
    let rooms = try await listRooms(client: client, organizationSlug: organizationSlug, kind: .channel, status: .archived)
    return ArchivedChannelList(rooms: rooms, canDelete: canDelete == true, roleLoadFailed: canDelete == nil)
  }
}
