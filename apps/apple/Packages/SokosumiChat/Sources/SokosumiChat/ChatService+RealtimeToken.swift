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
    try await call {
      try await client.postRealtimeAblyToken(
        .init(
          query: .init(clientInstanceId: clientInstanceId),
          headers: .init(xOrganizationSlug: organizationSlug)
        )
      )
    }.ok.body.json.data
  }
}
