import CoreAPI
import Foundation
import HTTPTypes
import OpenAPIRuntime
@testable import SokosumiChat
import Testing

struct ChatReadCooldownTests {
  @Test func generatedClientsShareCooldownAcrossRoomAndThreadReads() async throws {
    let clock = CooldownTestClock()
    let middleware = ChatReadCooldownMiddleware(cooldown: clock.cooldown(), currentScope: { 0 })
    let transport = TestTransport([
      (429, #"{"error":"Too Many Requests","message":"Wait","retryAfterSeconds":3,"meta":{"timestamp":"2026-01-01T00:00:00.000Z","requestId":"test","path":"/chats/rooms/room/messages","method":"GET"}}"#),
      (200, testMessagesPageBody(messages: [], nextCursor: nil))
    ])
    let url = try #require(URL(string: "https://example.com"))
    let roomClient = Client.connecting(to: url, transport: transport, middlewares: [middleware])
    let threadClient = Client.connecting(to: url, transport: transport, middlewares: [middleware])
    await #expect(throws: ChatServiceError.unprocessable(statusCode: 429, message: "Wait")) {
      try await ChatService().listMessages(client: roomClient, roomId: testRoomId, organizationSlug: nil)
    }
    _ = try await ChatService().listThreadMessages(client: threadClient, roomId: testRoomId, parentMessageId: "parent", organizationSlug: nil)
    #expect(clock.elapsed == 3)
    #expect(transport.requests.count == 2)
  }

  @Test(arguments: [0.1, 1, 2.2, 300])
  func roundsPositiveDelaysUp(value: Double) {
    #expect(ChatReadCooldown.validDelay(value) == ceil(value))
  }

  @Test(arguments: [Double.nan, .infinity, -.infinity, 0, -2])
  func rejectsInvalidDelays(value: Double) {
    #expect(ChatReadCooldown.validDelay(value) == nil)
  }

  @Test(arguments: [1.0, 60, 300])
  func jitterLengthensTheWholeWait(delay: Double) async throws {
    let clock = CooldownTestClock()
    let cooldown = ChatReadCooldown(now: { clock.now }, sleep: { duration in
      #expect(duration <= .seconds(60))
      clock.advance(duration)
    }, jitter: { 0.25 })
    try await cooldown.wait(scope: 0, currentScope: { 0 })
    await cooldown.note(delay: delay, scope: 0)
    try await cooldown.wait(scope: 0, currentScope: { 0 })
    #expect(clock.elapsed == delay * 1.25)
  }

  @Test func sharedDeadlineOnlyExtendsAndUsesFallback() async throws {
    let clock = CooldownTestClock()
    let cooldown = clock.cooldown()
    let scope = 0
    try await cooldown.wait(scope: scope, currentScope: { scope })
    await cooldown.note(delay: 10, scope: scope)
    await cooldown.note(delay: 2, scope: scope)
    try await cooldown.wait(scope: scope, currentScope: { scope })
    #expect(clock.elapsed == 10)
    await cooldown.note(delay: nil, scope: scope)
    try await cooldown.wait(scope: scope, currentScope: { scope })
    #expect(clock.elapsed == 15)
  }

  @Test func aLaterThrottleExtendsAnAlreadyWaitingRead() async throws {
    let clock = CooldownTestClock()
    let started = AsyncStream<Duration>.makeStream()
    let permits = AsyncStream<Void>.makeStream()
    let cooldown = ChatReadCooldown(now: { clock.now }, sleep: { duration in
      started.continuation.yield(duration)
      var iterator = permits.stream.makeAsyncIterator()
      _ = await iterator.next()
      clock.advance(duration)
    }, jitter: { 0 })
    try await cooldown.wait(scope: 0, currentScope: { 0 })
    await cooldown.note(delay: 5, scope: 0)
    let waiting = Task { try await cooldown.wait(scope: 0, currentScope: { 0 }) }
    var iterator = started.stream.makeAsyncIterator()
    #expect(await iterator.next() == .seconds(5))
    await cooldown.note(delay: 10, scope: 0)
    permits.continuation.yield(())
    #expect(await iterator.next() == .seconds(5))
    permits.continuation.yield(())
    try await waiting.value
    #expect(clock.elapsed == 10)
    started.continuation.finish()
    permits.continuation.finish()
  }

  @Test func cancellingWaitingReadNeverReachesTransport() async throws {
    let clock = CooldownTestClock()
    let started = AsyncStream<Void>.makeStream()
    let cooldown = ChatReadCooldown(now: { clock.now }, sleep: { _ in
      started.continuation.yield(())
      try await Task.sleep(for: .seconds(300))
    }, jitter: { 0 })
    try await cooldown.wait(scope: 0, currentScope: { 0 })
    await cooldown.note(delay: 5, scope: 0)
    let middleware = ChatReadCooldownMiddleware(cooldown: cooldown, currentScope: { 0 })
    let url = try #require(URL(string: "https://example.com"))
    let task = Task {
      try await middleware.intercept(HTTPRequest(method: .get, scheme: "https", authority: "example.com", path: "/chats/rooms"), body: nil, baseURL: url, operationID: "get/chats/rooms") { _, _, _ in
        Issue.record("Cancelled read reached the transport")
        return (HTTPResponse(status: .ok), nil)
      }
    }
    var iterator = started.stream.makeAsyncIterator()
    _ = await iterator.next()
    task.cancel()
    await #expect(throws: CancellationError.self) { try await task.value }
    started.continuation.finish()
  }

  @Test func newSessionDoesNotInheritCooldownOrLateResponse() async throws {
    let clock = CooldownTestClock()
    let cooldown = clock.cooldown()
    let old = 0, new = 1
    try await cooldown.wait(scope: old, currentScope: { old })
    await cooldown.note(delay: 300, scope: old)
    try await cooldown.wait(scope: new, currentScope: { new })
    await cooldown.note(delay: 300, scope: old)
    try await cooldown.wait(scope: new, currentScope: { new })
    #expect(clock.elapsed == 0)
    await #expect(throws: CancellationError.self) {
      try await cooldown.wait(scope: old, currentScope: { new })
    }
    // Even an actor hop that captured an old generation cannot restore it.
    await #expect(throws: CancellationError.self) {
      try await cooldown.wait(scope: old, currentScope: { old })
    }
  }

  @Test func sessionChangeDuringWaitCancelsRead() async throws {
    let clock = CooldownTestClock()
    let session = CooldownTestSession()
    let scope = await session.id
    let cooldown = ChatReadCooldown(now: { clock.now }, sleep: { duration in
      clock.advance(duration)
      await session.change()
    }, jitter: { 0 })
    try await cooldown.wait(scope: scope, currentScope: { await session.id })
    await cooldown.note(delay: 5, scope: scope)
    await #expect(throws: CancellationError.self) {
      try await cooldown.wait(scope: scope, currentScope: { await session.id })
    }
  }

  @Test(arguments: [true, false], ["get/chats/rooms/{id}/pinned-messages", "get/chats/rooms/{id}/threads/{parentMessageId}"])
  func middlewarePreservesBodyAndHonorsHeaderBeforeBody(header: Bool, operation: String) async throws {
    let clock = CooldownTestClock()
    let scope = 0
    let middleware = ChatReadCooldownMiddleware(cooldown: clock.cooldown(), currentScope: { scope })
    let url = try #require(URL(string: "https://example.com"))
    let request = HTTPRequest(method: .get, scheme: "https", authority: "example.com", path: "/chats/rooms/room/messages")
    let json = #"{"message":"Wait","retryAfterSeconds":2}"#
    let response = try await middleware.intercept(request, body: nil, baseURL: url, operationID: "get/chats/rooms/{id}/messages") { _, _, _ in
      var response = HTTPResponse(status: .tooManyRequests)
      if header {
        response.headerFields[.retryAfter] = "7"
      }
      return (response, HTTPBody(json))
    }
    let body = try #require(response.1)
    #expect(try await String(collecting: body, upTo: 1024) == json)
    _ = try await middleware.intercept(request, body: nil, baseURL: url, operationID: operation) { _, _, _ in
      (HTTPResponse(status: .ok), nil)
    }
    #expect(clock.elapsed == (header ? 7 : 2))
  }

  @Test func writesAndStreamStateBypassWait() async throws {
    let clock = CooldownTestClock()
    let cooldown = clock.cooldown()
    let scope = 0
    try await cooldown.wait(scope: scope, currentScope: { scope })
    await cooldown.note(delay: 300, scope: scope)
    let middleware = ChatReadCooldownMiddleware(cooldown: cooldown, currentScope: { scope })
    let url = try #require(URL(string: "https://example.com"))
    for (method, operation) in [(HTTPRequest.Method.post, "post/chats/rooms/{id}/messages"), (.get, "get/chats/rooms/{id}/stream/active")] {
      _ = try await middleware.intercept(HTTPRequest(method: method, scheme: "https", authority: "example.com", path: "/"), body: nil, baseURL: url, operationID: operation) { _, _, _ in
        (HTTPResponse(status: .ok), nil)
      }
    }
    #expect(clock.elapsed == 0)
  }

  @Test(arguments: ["not JSON", #"{"retryAfterSeconds":0}"#, #"{"retryAfterSeconds":-2}"#, "{}"])
  func invalidEnvelopeUsesFiveSecondFallback(json: String) async throws {
    let clock = CooldownTestClock()
    let middleware = ChatReadCooldownMiddleware(cooldown: clock.cooldown(), currentScope: { 0 })
    let url = try #require(URL(string: "https://example.com"))
    let request = HTTPRequest(method: .get, scheme: "https", authority: "example.com", path: "/chats/rooms")
    _ = try await middleware.intercept(request, body: nil, baseURL: url, operationID: "get/chats/rooms") { _, _, _ in
      (HTTPResponse(status: .tooManyRequests), HTTPBody(json))
    }
    _ = try await middleware.intercept(request, body: nil, baseURL: url, operationID: "get/chats/rooms") { _, _, _ in
      (HTTPResponse(status: .ok), nil)
    }
    #expect(clock.elapsed == 5)
  }
}

private actor CooldownTestSession {
  var id = 0
  func change() {
    id += 1
  }
}

/// Locked because the production clock callback is synchronous and Sendable.
private final class CooldownTestClock: @unchecked Sendable {
  private let lock = NSLock()
  private var seconds = 0.0
  var elapsed: Double {
    lock.withLock { seconds }
  }

  var now: Date {
    Date(timeIntervalSince1970: elapsed)
  }

  func advance(_ duration: Duration) {
    lock.withLock { seconds += Double(duration.components.seconds) + Double(duration.components.attoseconds) / 1e18 }
  }

  func cooldown() -> ChatReadCooldown {
    ChatReadCooldown(now: { self.now }, sleep: { self.advance($0) }, jitter: { 0 })
  }
}
