import Foundation
import HTTPTypes
import OpenAPIRuntime

/// Restores the explicit-null body Core requires on
/// `PUT /users/{id}/preferred-organization`.
///
/// swift-openapi-generator omits nil optionals, so
/// `PreferredOrganization(organizationId: nil)` encodes to `{}` — but Core's
/// schema requires the key and its validation hook answers 422. Only this
/// operation's empty-object body is rewritten; everything else passes
/// through untouched.
public struct ExplicitNullPreferredOrganizationMiddleware: ClientMiddleware {
  private static let operationID = "put/users/{id}/preferred-organization"

  public init() {}

  public func intercept(
    _ request: HTTPRequest,
    body: HTTPBody?,
    baseURL: URL,
    operationID: String,
    next: @Sendable (HTTPRequest, HTTPBody?, URL) async throws -> (HTTPResponse, HTTPBody?)
  ) async throws -> (HTTPResponse, HTTPBody?) {
    guard operationID == Self.operationID,
      let body,
      let bytes = try? await Array(collecting: body, upTo: 1_000_000),
      let json = try? JSONSerialization.jsonObject(with: Data(bytes)),
      let dict = json as? [String: Any],
      dict.isEmpty
    else {
      return try await next(request, body, baseURL)
    }
    return try await next(request, HTTPBody(#"{"organizationId":null}"#), baseURL)
  }
}
