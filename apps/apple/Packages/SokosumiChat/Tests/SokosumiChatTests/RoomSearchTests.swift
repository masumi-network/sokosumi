import CoreAPI
import Foundation
import HTTPTypes
import OpenAPIRuntime
import SokosumiChat
import Testing

@MainActor
struct RoomSearchTests {
  @Test func queryUsesExistingEndpointAndFiftyResultLimit() async throws {
    let row = testMessageJSON(id: "match", content: "A match", sender: testUserSender(name: "Ada", email: "ada@example.com"))
    let transport = TestTransport([(200, testMessagesPageBody(messages: [row], nextCursor: "unused"))])
    let search = RoomSearch()
    try await search.search(query: "  hello & world  ", roomId: testRoomId,
                            client: makeTestClient(transport), organizationSlug: "team")
    #expect(search.results.map(\.id) == ["match"])
    #expect(!search.isLoading)
    #expect(search.errorMessage == nil)
    let request = try #require(transport.requests.first?.request)
    let url = try #require(URLComponents(string: "https://core.example\(request.path ?? "")"))
    #expect(url.queryItems?.first { $0.name == "q" }?.value == "hello & world")
    #expect(url.queryItems?.first { $0.name == "limit" }?.value == "50")
    #expect(try request.headerFields[#require(.init("X-Organization-Slug"))] == "team")
  }

  @Test func resetRejectsAnUncancelledLateResponse() async throws {
    let transport = PausedSearchTransport()
    let client = try Client.connecting(to: #require(URL(string: "https://core.example/v1")), transport: transport)
    let search = RoomSearch()
    let task = Task { await search.search(query: "hello", roomId: testRoomId, client: client, organizationSlug: nil) }
    await transport.waitForRequest()
    search.reset()
    await transport.release()
    await task.value
    #expect(search.results.isEmpty)
    #expect(search.errorMessage == nil && !search.isLoading)
  }

  @Test func failureClearsResultsAndRemainsRetryable() async throws {
    let transport = TestTransport([
      (403, #"{"error":"Forbidden","message":"No access"}"#),
      (200, testMessagesPageBody(messages: [], nextCursor: nil))
    ])
    let client = try makeTestClient(transport)
    let search = RoomSearch()
    await search.search(query: "hello", roomId: testRoomId, client: client, organizationSlug: nil)
    #expect(search.errorMessage != nil && !search.isLoading)
    await search.search(query: "hello", roomId: testRoomId, client: client, organizationSlug: nil)
    #expect(search.errorMessage == nil && !search.isLoading)
  }

  @Test func threadContextPassesAroundAndUsesThirtyRows() async throws {
    let transport = TestTransport([(200, testMessagesPageBody(messages: [], nextCursor: nil))])
    _ = try await ChatService().listThreadMessages(client: makeTestClient(transport), roomId: testRoomId,
                                                   parentMessageId: "parent", around: "reply", organizationSlug: nil)
    let path = try #require(transport.requests.first?.request.path)
    let url = try #require(URLComponents(string: "https://core.example\(path)"))
    #expect(url.queryItems?.first { $0.name == "around" }?.value == "reply")
    #expect(url.queryItems?.first { $0.name == "limit" }?.value == "30")
  }

  @Test func missingThreadTargetExposesRetryableFailure() async throws {
    let transport = TestTransport([(200, testMessagesPageBody(messages: [], nextCursor: nil))])
    let client = try makeTestClient(transport)
    let timeline = RoomTimeline()
    timeline.reset(roomId: testRoomId, parentMessageId: "parent")
    await #expect(throws: (any Error).self) {
      try await timeline.loadPage(.around("missing"), client: client, organizationSlug: nil, generation: timeline.generation)
    }
    #expect(timeline.failedPage == .around("missing"))
    #expect(timeline.errorMessage != nil)
    #expect(!timeline.isLoading && !timeline.isRefreshing)
  }

  @Test func emptyQueryDoesNotRequest() async throws {
    let transport = TestTransport([])
    let search = RoomSearch()
    try await search.search(query: " \n ", roomId: testRoomId,
                            client: makeTestClient(transport), organizationSlug: nil)
    #expect(transport.requests.isEmpty)
    #expect(search.results.isEmpty && !search.isLoading)
  }

  @Test func cancellationDuringDebounceDoesNotRequestOrReportFailure() async throws {
    let transport = TestTransport([])
    let client = try makeTestClient(transport)
    let search = RoomSearch()
    let task = Task { await search.search(query: "hello", roomId: testRoomId, client: client, organizationSlug: nil) }
    while !search.isLoading {
      await Task.yield()
    }
    task.cancel()
    await task.value
    #expect(transport.requests.isEmpty)
    #expect(search.errorMessage == nil && !search.isLoading)
  }
}

private actor PausedSearchTransport: ClientTransport {
  private var waiter: CheckedContinuation<Void, Never>?
  private var observer: CheckedContinuation<Void, Never>?

  func waitForRequest() async {
    if waiter != nil {
      return
    }
    await withCheckedContinuation { observer = $0 }
  }

  func release() {
    waiter?.resume()
    waiter = nil
  }

  func send(_: HTTPRequest, body _: HTTPBody?, baseURL _: URL, operationID _: String) async throws -> (HTTPResponse, HTTPBody?) {
    await withCheckedContinuation {
      waiter = $0
      observer?.resume()
      observer = nil
    }
    let row = testMessageJSON(id: "late", content: "Late result", sender: testUserSender(name: "Ada", email: "ada@example.com"))
    return (HTTPResponse(status: .ok), HTTPBody(testMessagesPageBody(messages: [row], nextCursor: nil)))
  }
}
