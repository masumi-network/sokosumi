import CoreAPI
import Foundation

public extension ChatService {
  /// Core authorization stays on the grant request; Blob gets only its presigned URL.
  func attachmentGrant(client: Client, roomId: String, file: Components.Schemas.CreateChatRoomFileUploadSessionRequest, organizationSlug: String?) async throws -> Components.Schemas.ChatRoomFileUploadSession {
    let response = try await client.postChatsRoomsIdFiles(.init(
      path: .init(id: roomId), headers: .init(xOrganizationSlug: organizationSlug),
      body: .json(file)
    ))
    switch response {
    case let .created(value): return try value.body.json.data
    case let .unauthorized(value): throw try ChatServiceError.unauthorized(value.body.json.message)
    case let .badRequest(value): throw try ChatServiceError.unprocessable(statusCode: 400, message: value.body.json.message)
    case let .forbidden(value): throw try ChatServiceError.unprocessable(statusCode: 403, message: value.body.json.message)
    case let .notFound(value): throw try ChatServiceError.unprocessable(statusCode: 404, message: value.body.json.message)
    case let .contentTooLarge(value): throw try ChatServiceError.unprocessable(statusCode: 413, message: value.body.json.message)
    case let .serviceUnavailable(value): throw try ChatServiceError.unprocessable(statusCode: 503, message: value.body.json.message)
    case let .undocumented(statusCode, payload): throw await unprocessableError(statusCode: statusCode, payload: payload)
    }
  }
}
