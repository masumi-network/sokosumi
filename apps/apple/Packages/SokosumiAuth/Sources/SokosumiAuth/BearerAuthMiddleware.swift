import Foundation
import HTTPTypes
import OpenAPIRuntime

/// Injects `Authorization: Bearer <access token>` into Core API calls made
/// through the generated OpenAPI client. Resolves the token through
/// `OAuthSession` so expiry silently refreshes; with no session the request
/// goes out unauthenticated and Core answers 401 visibly (SOK-971 behavior).
public struct BearerAuthMiddleware: ClientMiddleware {
  private let tokenProvider: @Sendable () async throws -> String?

  public init(session: OAuthSession) {
    tokenProvider = {
      do {
        return try await session.validAccessToken()
      } catch OAuthError.needsSignIn {
        // No (usable) session: go out unauthenticated so Core answers 401
        // visibly. Any other failure (network, 5xx) propagates to the
        // caller instead of masquerading as an anonymous request.
        return nil
      }
    }
  }

  public func intercept(
    _ request: HTTPRequest,
    body: HTTPBody?,
    baseURL: URL,
    operationID _: String,
    next: @Sendable (HTTPRequest, HTTPBody?, URL) async throws -> (HTTPResponse, HTTPBody?)
  ) async throws -> (HTTPResponse, HTTPBody?) {
    var request = request
    if let token = try await tokenProvider() {
      request.headerFields[.authorization] = "Bearer \(token)"
    }
    return try await next(request, body, baseURL)
  }
}
