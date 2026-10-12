import CoreAPI
import Foundation
import HTTPTypes
import OpenAPIRuntime

/// Turns every non-2xx Core response into a `ChatServiceError`, so no operation wrapper maps statuses itself.
///
/// Core answers every failure with its `{error, message, kind?, retryAfterSeconds?, meta}` envelope: 401 becomes
/// `.unauthorized(message)`, any other status `.unprocessable(statusCode:message:kind:)`, and a body that is not
/// the envelope keeps the status with "Core rejected the request.". Successful bodies pass through untouched and
/// unread, so streams and file downloads still arrive incrementally. `Client.core` puts this middleware outermost:
/// the read cooldown still sees 429s and `ClientBuildMiddleware` still sees 426 and `route_not_found` 404s.
public struct CoreErrorMiddleware: ClientMiddleware {
  static let fallbackMessage = "Core rejected the request."
  private static let maxEnvelopeBytes = 64 * 1024

  public init() {}

  public func intercept(
    _ request: HTTPRequest,
    body: HTTPBody?,
    baseURL: URL,
    operationID _: String,
    next: @Sendable (HTTPRequest, HTTPBody?, URL) async throws -> (HTTPResponse, HTTPBody?)
  ) async throws -> (HTTPResponse, HTTPBody?) {
    let (response, responseBody) = try await next(request, body, baseURL)
    guard response.status.kind != .successful else { return (response, responseBody) }
    throw await Self.error(statusCode: response.status.code, body: responseBody)
  }

  static func error(statusCode: Int, body: HTTPBody?) async -> ChatServiceError {
    var envelope: Envelope?
    if let body, let bytes = try? await Array(collecting: body, upTo: maxEnvelopeBytes) {
      envelope = try? JSONDecoder().decode(Envelope.self, from: Data(bytes))
    }
    let message = envelope?.message.flatMap { $0.isEmpty ? nil : $0 } ?? fallbackMessage
    if statusCode == 401 {
      return .unauthorized(message)
    }
    return .unprocessable(statusCode: statusCode, message: message, kind: envelope?.kind)
  }
}

private struct Envelope: Decodable {
  let message: String?
  let kind: String?
}

public extension Client {
  /// The Core client every caller builds: `CoreErrorMiddleware` always wraps `middlewares`, so each of them sees
  /// Core's raw response first.
  static func core(baseURL: URL, middlewares: [any ClientMiddleware] = [], session: URLSession = .shared) -> Client {
    .connecting(to: baseURL, middlewares: [CoreErrorMiddleware()] + middlewares, session: session)
  }

  /// Fake-transport variant for tests, with the same middleware order.
  static func core(baseURL: URL, transport: any ClientTransport, middlewares: [any ClientMiddleware] = []) -> Client {
    .connecting(to: baseURL, transport: transport, middlewares: [CoreErrorMiddleware()] + middlewares)
  }
}
