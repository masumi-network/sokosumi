import CoreAPI
import Foundation
import OpenAPIRuntime

public extension ChatService {
  /// `POST /realtime/ably-token?clientInstanceId=` (SOK-976).
  /// Grants per-membership room subscribe plus the always-on chat-control
  /// channel (ADR 0003). Remint after join/leave/revoke so capabilities
  /// match membership. Nil slug omits the org header (personal).
  func fetchAblyToken(
    client: Client,
    clientInstanceId: String,
    organizationSlug: String?
  ) async throws -> Components.Schemas.AblyTokenRequest {
    let response = try await client.postRealtimeAblyToken(
      .init(
        query: .init(clientInstanceId: clientInstanceId),
        headers: .init(xOrganizationSlug: organizationSlug)
      )
    )
    switch response {
    case let .ok(okResponse):
      return try okResponse.body.json.data
    case let .badRequest(badRequest):
      throw try ChatServiceError.unprocessable(statusCode: 400, message: badRequest.body.json.message)
    case let .unauthorized(unauthorized):
      throw try ChatServiceError.unauthorized(unauthorized.body.json.message)
    case let .forbidden(forbidden):
      throw try ChatServiceError.unprocessable(statusCode: 403, message: forbidden.body.json.message)
    case let .internalServerError(serverError):
      throw try ChatServiceError.unprocessable(statusCode: 500, message: serverError.body.json.message)
    case let .undocumented(statusCode, payload):
      throw await unprocessableError(statusCode: statusCode, payload: payload)
    }
  }
}
