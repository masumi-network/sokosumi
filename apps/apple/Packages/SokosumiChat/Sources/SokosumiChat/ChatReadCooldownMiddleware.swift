import Foundation
import HTTPTypes
import OpenAPIRuntime

/// Observes 429 envelopes before generated decoding discards retry timing.
/// Waiting happens before bearer-token resolution so delayed reads use a fresh
/// token. Never retries the failed response or delays writes/stream delivery.
public struct ChatReadCooldownMiddleware: ClientMiddleware {
  private static let reads: Set<String> = [
    "get/chats/rooms", "get/chats/rooms/{id}/messages", "get/chats/rooms/{id}/threads",
    "get/chats/rooms/{id}/threads/{parentMessageId}/messages",
    "get/chats/rooms/{id}/messages/{messageId}", "get/chats/rooms/{id}/pinned-messages"
  ]

  private let cooldown: ChatReadCooldown
  private let currentScope: @Sendable () async -> Int

  public init(cooldown: ChatReadCooldown, currentScope: @escaping @Sendable () async -> Int) {
    self.cooldown = cooldown
    self.currentScope = currentScope
  }

  public func intercept(
    _ request: HTTPRequest,
    body: HTTPBody?,
    baseURL: URL,
    operationID: String,
    next: @Sendable (HTTPRequest, HTTPBody?, URL) async throws -> (HTTPResponse, HTTPBody?)
  ) async throws -> (HTTPResponse, HTTPBody?) {
    guard request.method == .get, Self.reads.contains(operationID) else {
      return try await next(request, body, baseURL)
    }
    let scope = await currentScope()
    try await cooldown.wait(scope: scope, currentScope: currentScope)
    let (response, responseBody) = try await next(request, body, baseURL)
    try Task.checkCancellation()
    guard await currentScope() == scope else { throw CancellationError() }
    guard response.status.code == 429 else { return (response, responseBody) }
    let headerDelay = response.headerFields[.retryAfter].flatMap(Double.init).flatMap(ChatReadCooldown.validDelay)
    if let headerDelay {
      await cooldown.note(delay: headerDelay, scope: scope)
      return (response, responseBody)
    }
    guard let responseBody else {
      await cooldown.note(delay: nil, scope: scope)
      return (response, nil)
    }
    let bytes: [UInt8]
    do {
      bytes = try await Array(collecting: responseBody, upTo: 65536)
    } catch {
      await cooldown.note(delay: nil, scope: scope)
      throw error
    }
    try Task.checkCancellation()
    guard await currentScope() == scope else { throw CancellationError() }
    let payload = try? JSONDecoder().decode(RetryDelay.self, from: Data(bytes))
    await cooldown.note(delay: payload?.retryAfterSeconds, scope: scope)
    // Restore the collected error body for the generated response decoder.
    return (response, HTTPBody(bytes))
  }
}

private struct RetryDelay: Decodable {
  let retryAfterSeconds: Double?
}
