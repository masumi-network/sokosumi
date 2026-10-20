import CoreAPI
import Foundation

public extension ChatService {
  /// Core authorization stays on the grant request; Blob gets only its presigned URL.
  func attachmentGrant(client: Client, roomId: String, file: Components.Schemas.CreateChatRoomFileUploadSessionRequest, organizationSlug: String?) async throws -> Components.Schemas.ChatRoomFileUploadSession {
    try await call {
      try await client.postChatsRoomsIdFiles(.init(
        path: .init(id: roomId), headers: .init(xOrganizationSlug: organizationSlug),
        body: .json(file)
      ))
    }.created.body.json.data
  }
}
