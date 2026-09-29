import Foundation
import HTTPTypes
import OpenAPIRuntime

/// Writes `expiresInDays` into `POST /chats/rooms/{id}/invite-links`.
///
/// Core declares the field as `anyOf [integer, null]` (omitted = 7 days, `null` = no expiry), a shape
/// swift-openapi-generator drops from the generated body, so the typed request only carries `maxUses`.
/// `ChatService.createGuestInviteLink` binds the task-local expiry around the call; only that operation's
/// JSON object is rewritten, everything else passes through untouched.
public struct GuestInviteLinkExpiryMiddleware: ClientMiddleware {
  enum Expiry: Equatable, Sendable {
    case days(Int)
    case never
  }

  @TaskLocal static var expiry: Expiry?
  static let operationID = "post/chats/rooms/{id}/invite-links"

  public init() {}

  public func intercept(
    _ request: HTTPRequest,
    body: HTTPBody?,
    baseURL: URL,
    operationID: String,
    next: @Sendable (HTTPRequest, HTTPBody?, URL) async throws -> (HTTPResponse, HTTPBody?)
  ) async throws -> (HTTPResponse, HTTPBody?) {
    guard operationID == Self.operationID, let expiry = Self.expiry, let body else {
      return try await next(request, body, baseURL)
    }
    // Collect once, then always rebuild: the collected stream cannot be replayed.
    var request = request
    let bytes = try await Array(collecting: body, upTo: 1_000_000)
    var outgoingBytes = bytes
    if var json = try? JSONSerialization.jsonObject(with: Data(bytes)) as? [String: Any] {
      switch expiry {
      case let .days(days): json["expiresInDays"] = days
      case .never: json["expiresInDays"] = NSNull()
      }
      if let data = try? JSONSerialization.data(withJSONObject: json, options: [.sortedKeys]) {
        outgoingBytes = Array(data)
      }
    }
    // Content-Length was stamped from the pre-rewrite body; a stale value drops the connection (-1005).
    request.headerFields[.contentLength] = String(outgoingBytes.count)
    return try await next(request, HTTPBody(outgoingBytes), baseURL)
  }
}
