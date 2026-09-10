import CoreAPI
import Foundation
import OpenAPIRuntime

public extension ChatService {
  /// Starts a coworker turn using the same single user UIMessage as web.
  /// The returned body is consumed incrementally, never collected into memory.
  func startDirectStream(
    client: Client,
    roomId: String,
    organizationSlug: String?,
    messageId: String,
    text: String
  ) async throws -> HTTPBody {
    let response = try await client.postChatsRoomsIdStream(.init(
      path: .init(id: roomId),
      headers: .init(xOrganizationSlug: organizationSlug),
      body: .json(.init(
        value1: .init(messages: [.init(
          role: .user,
          parts: [.init(value2: .init(_type: .text, text: text))],
          id: messageId
        )], id: roomId),
        value2: .init(roomId: roomId)
      ))
    ))
    switch response {
    case let .ok(value): return try value.body.textEventStream
    case let .badRequest(value): throw try ChatServiceError.unprocessable(statusCode: 400, message: value.body.json.message)
    case let .unauthorized(value): throw try ChatServiceError.unauthorized(value.body.json.message)
    case let .forbidden(value): throw try ChatServiceError.unprocessable(statusCode: 403, message: value.body.json.message)
    case let .notFound(value): throw try ChatServiceError.unprocessable(statusCode: 404, message: value.body.json.message)
    case let .conflict(value): throw try ChatServiceError.unprocessable(statusCode: 409, message: value.body.json.message)
    case let .unprocessableContent(value): throw try ChatServiceError.unprocessable(statusCode: 422, message: value.body.json.message)
    case let .internalServerError(value): throw try ChatServiceError.unprocessable(statusCode: 500, message: value.body.json.message)
    case let .serviceUnavailable(value): throw try ChatServiceError.unprocessable(statusCode: 503, message: value.body.json.message)
    case let .undocumented(code, payload): throw await unprocessableError(statusCode: code, payload: payload)
    }
  }

  /// A 204 is an idle room, not a thinking or error state.
  func resumeDirectStream(client: Client, roomId: String, organizationSlug: String?) async throws -> HTTPBody? {
    let response = try await client.getChatsRoomsIdStreamActive(.init(
      path: .init(id: roomId), headers: .init(xOrganizationSlug: organizationSlug)
    ))
    switch response {
    case let .ok(value): return try value.body.textEventStream
    case .noContent: return nil
    case let .unauthorized(value): throw try ChatServiceError.unauthorized(value.body.json.message)
    case let .forbidden(value): throw try ChatServiceError.unprocessable(statusCode: 403, message: value.body.json.message)
    case let .notFound(value): throw try ChatServiceError.unprocessable(statusCode: 404, message: value.body.json.message)
    case let .internalServerError(value): throw try ChatServiceError.unprocessable(statusCode: 500, message: value.body.json.message)
    case let .undocumented(code, payload): throw await unprocessableError(statusCode: code, payload: payload)
    }
  }
}
