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
///
/// The length carries the contract (explicit-null rewrite scoped to
/// preferred-organization).
public struct ExplicitNullPreferredOrganizationMiddleware: ClientMiddleware { // swiftlint:disable:this type_name
  private static let operationID = "put/users/{id}/preferred-organization"

  public init() {}

  public func intercept(
    _ request: HTTPRequest,
    body: HTTPBody?,
    baseURL: URL,
    operationID: String,
    next: @Sendable (HTTPRequest, HTTPBody?, URL) async throws -> (HTTPResponse, HTTPBody?)
  ) async throws -> (HTTPResponse, HTTPBody?) {
    guard operationID == Self.operationID, let body else {
      return try await next(request, body, baseURL)
    }
    // Collect once, then always rebuild. Passing the original body after
    // collecting empties a non-replayable stream (org switch would PUT {}).
    let bytes = try await Array(collecting: body, upTo: 1_000_000)
    let outgoing = if let json = try? JSONSerialization.jsonObject(with: Data(bytes)) as? [String: Any],
                      json.isEmpty {
      HTTPBody(#"{"organizationId":null}"#)
    } else {
      HTTPBody(bytes)
    }
    return try await next(request, outgoing, baseURL)
  }
}
