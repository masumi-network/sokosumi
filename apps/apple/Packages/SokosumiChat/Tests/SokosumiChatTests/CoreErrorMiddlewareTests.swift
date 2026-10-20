import CoreAPI
import Foundation
import HTTPTypes
import OpenAPIRuntime
@testable import SokosumiChat
import Testing

/// Every Core failure reaches callers as one `ChatServiceError`, mapped once for all operations.
struct CoreErrorMiddlewareTests {
  @Test(arguments: [400, 403, 404, 409, 413, 422, 429, 500, 503])
  func statusWithEnvelopeKeepsCoresMessage(status: Int) async {
    let error = await mapped(status: status, body: envelope(message: "Core says no"))
    #expect(error == .unprocessable(statusCode: status, message: "Core says no"))
  }

  @Test func unauthorizedCarriesCoresMessage() async {
    let error = await mapped(status: 401, body: envelope(message: "Session expired"))
    #expect(error == .unauthorized("Session expired"))
  }

  @Test func kindTravelsWithTheError() async {
    let error = await mapped(status: 409, body: envelope(message: "Slug taken", kind: "channel_slug_taken"))
    #expect(error == .unprocessable(statusCode: 409, message: "Slug taken", kind: "channel_slug_taken"))
  }

  @Test(arguments: [nil, "", "not JSON", "{}", #"{"message":""}"#])
  func unreadableBodyKeepsTheStatusWithFallback(body: String?) async {
    #expect(await mapped(status: 502, body: body) == .unprocessable(statusCode: 502, message: CoreErrorMiddleware.fallbackMessage))
    #expect(await mapped(status: 401, body: body) == .unauthorized(CoreErrorMiddleware.fallbackMessage))
  }

  /// The caller left while the error body was arriving: cancellation, not a 401 that would sign out.
  @Test func cancellationWhileReadingTheBodyStaysCancellation() async throws {
    let body = HTTPBody(AsyncThrowingStream<ArraySlice<UInt8>, any Error> { $0.finish(throwing: CancellationError()) }, length: .unknown)
    await #expect(throws: CancellationError.self) {
      _ = try await CoreErrorMiddleware().intercept(request, body: nil, baseURL: baseURL, operationID: "get/chats/rooms") { _, _, _ in
        (HTTPResponse(status: .unauthorized), body)
      }
    }
  }

  @Test func aFailedBodyReadKeepsTheStatusWithFallback() async throws {
    let body = HTTPBody(AsyncThrowingStream<ArraySlice<UInt8>, any Error> { $0.finish(throwing: URLError(.networkConnectionLost)) }, length: .unknown)
    await #expect(throws: ChatServiceError.unprocessable(statusCode: 500, message: CoreErrorMiddleware.fallbackMessage)) {
      _ = try await CoreErrorMiddleware().intercept(request, body: nil, baseURL: baseURL, operationID: "get/chats/rooms") { _, _, _ in
        (HTTPResponse(status: .internalServerError), body)
      }
    }
  }

  /// Streams and file downloads must arrive incrementally: a 2xx body is the transport's own, unread.
  @Test(arguments: [200, 201, 204])
  func successPassesThroughUnread(status: Int) async throws {
    let (stream, continuation) = AsyncStream<ArraySlice<UInt8>>.makeStream()
    let body = HTTPBody(stream, length: .unknown, iterationBehavior: .single)
    let (response, passed) = try await CoreErrorMiddleware().intercept(
      request, body: nil, baseURL: baseURL, operationID: "get/chats/rooms/{id}/stream/active"
    ) { _, _, _ in
      (HTTPResponse(status: .init(code: status)), body)
    }
    #expect(response.status.code == status)
    #expect(passed === body)
    continuation.yield(ArraySlice("data: hi".utf8))
    continuation.finish()
    #expect(try await String(collecting: #require(passed), upTo: 64) == "data: hi")
  }

  @Test func operationsThrowThePlainError() async throws {
    let transport = TestTransport([(403, envelope(message: "Not a member"))])
    let client = try Client.core(baseURL: #require(URL(string: "https://core.example/v1")), transport: transport)
    await #expect(throws: ChatServiceError.unprocessable(statusCode: 403, message: "Not a member")) {
      try await ChatService().listMessages(client: client, roomId: testRoomId, organizationSlug: nil)
    }
  }

  /// Outermost, the mapper runs after the read cooldown has noted a 429's timing.
  @Test func cooldownStillSeesTooManyRequests() async throws {
    let clock = AdvancingClock()
    let cooldown = ChatReadCooldown(now: { clock.now }, sleep: { clock.advance($0) }, jitter: { 0 })
    let transport = TestTransport([
      (429, #"{"error":"Too Many Requests","message":"Wait","retryAfterSeconds":3,"meta":{}}"#),
      (200, testMessagesPageBody(messages: [], nextCursor: nil))
    ])
    let client = try Client.core(
      baseURL: #require(URL(string: "https://core.example/v1")),
      transport: transport,
      middlewares: [ChatReadCooldownMiddleware(cooldown: cooldown, currentScope: { 0 })]
    )
    await #expect(throws: ChatServiceError.unprocessable(statusCode: 429, message: "Wait")) {
      try await ChatService().listMessages(client: client, roomId: testRoomId, organizationSlug: nil)
    }
    _ = try await ChatService().listMessages(client: client, roomId: testRoomId, organizationSlug: nil)
    #expect(clock.now == Date(timeIntervalSince1970: 3))
  }

  /// Outermost, the mapper never sees the 426 or `route_not_found` 404 `ClientBuildMiddleware` turns into an update.
  @Test(arguments: [(426, "client_update_required"), (404, "route_not_found")])
  func buildMiddlewareStillSeesUpdateStatuses(status: Int, kind: String) async throws {
    let transport = TestTransport([(status, envelope(message: "Update", kind: kind))])
    let client = try Client.core(
      baseURL: #require(URL(string: "https://core.example/v1")),
      transport: transport,
      middlewares: [ClientBuildMiddleware(build: "2")]
    )
    await #expect(throws: CoreUpdateRequired()) {
      try await ChatService().listMessages(client: client, roomId: testRoomId, organizationSlug: nil)
    }
  }

  @Test func anOrdinaryNotFoundIsNotAnUpdate() async throws {
    let transport = TestTransport([(404, envelope(message: "Room not found", kind: "room_not_found"))])
    let client = try Client.core(
      baseURL: #require(URL(string: "https://core.example/v1")),
      transport: transport,
      middlewares: [ClientBuildMiddleware(build: "2")]
    )
    await #expect(throws: ChatServiceError.unprocessable(statusCode: 404, message: "Room not found", kind: "room_not_found")) {
      try await ChatService().listMessages(client: client, roomId: testRoomId, organizationSlug: nil)
    }
  }

  private let baseURL = URL(string: "https://core.example/v1")!
  private let request = HTTPRequest(method: .get, scheme: "https", authority: "core.example", path: "/v1/chats/rooms")

  private func mapped(status: Int, body: String?) async -> ChatServiceError? {
    do {
      _ = try await CoreErrorMiddleware().intercept(request, body: nil, baseURL: baseURL, operationID: "get/chats/rooms") { _, _, _ in
        (HTTPResponse(status: .init(code: status)), body.map { HTTPBody($0) })
      }
      return nil
    } catch {
      return error as? ChatServiceError
    }
  }

  private func envelope(message: String, kind: String? = nil) -> String {
    let kindField = kind.map { #","kind":"\#($0)""# } ?? ""
    return #"{"error":"Rejected","message":"\#(message)"\#(kindField),"meta":{"timestamp":"2026-01-01T00:00:00.000Z","requestId":"req","path":"/v1/chats/rooms","method":"GET"}}"#
  }
}

/// Sleeping advances the clock, so a cooldown wait ends after exactly its delay.
private final class AdvancingClock: @unchecked Sendable {
  private let lock = NSLock()
  private var seconds = 0.0
  var now: Date {
    lock.withLock { Date(timeIntervalSince1970: seconds) }
  }

  func advance(_ duration: Duration) {
    lock.withLock { seconds += Double(duration.components.seconds) + Double(duration.components.attoseconds) / 1e18 }
  }
}
