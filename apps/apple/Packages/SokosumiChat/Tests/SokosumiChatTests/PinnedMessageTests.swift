import CoreAPI
import Foundation
import HTTPTypes
import OpenAPIRuntime
import SokosumiChat
import Testing

private actor PausedPinTransport: ClientTransport {
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
    await withCheckedContinuation { waiter = $0
      observer?.resume()
      observer = nil
    }
    return (HTTPResponse(status: .ok), HTTPBody(#"{"data":[{"messageId":"pin","pinnedAt":"2026-01-01T00:00:00.000Z","pinnedBy":null,"message":null}],"meta":{"timestamp":"2026-01-01T00:00:00.000Z","requestId":"req","pagination":{"cursor":null,"limit":100,"total":1,"nextCursor":null}}}"#))
  }
}

private func pinsBody(_ ids: [String], next: String?) -> String {
  let items = ids.map { #"{"messageId":"\#($0)","pinnedAt":"2026-01-01T00:00:00.000Z","pinnedBy":null,"message":null}"# }
  let cursor = next.map { "\"\($0)\"" } ?? "null"
  return "{\"data\":[\(items.joined(separator: ","))],\"meta\":{\"timestamp\":\"2026-01-01T00:00:00.000Z\",\"requestId\":\"req\",\"pagination\":{\"cursor\":null,\"limit\":100,\"total\":\(ids.count),\"nextCursor\":\(cursor)}}}"
}

@MainActor struct PinnedMessageTests {
  /// Web shows "Loading pinned messages…" for the first page only; an older page just holds its button.
  @Test func onlyTheFirstPageIsTheListsLoading() async throws {
    let pins = PinnedMessages()
    pins.reset(roomId: testRoomId)
    let first = PausedPinTransport()
    let load = Task { try await pins.load(client: Client.core(baseURL: #require(URL(string: "https://core.example/v1")), transport: first),
                                          organizationSlug: nil) }
    await first.waitForRequest()
    #expect(pins.isLoadingFirstPage)
    await first.release()
    try await load.value
    pins.reset(roomId: testRoomId)
    try await pins.load(client: makeTestClient(TestTransport([(200, pinsBody(["a"], next: "a"))])), organizationSlug: nil)
    let older = PausedPinTransport()
    let page = Task { try await pins.load(client: Client.core(baseURL: #require(URL(string: "https://core.example/v1")), transport: older),
                                          organizationSlug: nil, older: true) }
    await older.waitForRequest()
    #expect(pins.isLoading, "The Load older button waits.")
    #expect(!pins.isLoadingFirstPage, "The panel shows no Loading line for an older page.")
    await older.release()
    try await page.value
  }

  @Test func openingPanelDuringCancelledPrefetchStillLoadsPins() async throws {
    let transport = PausedPinTransport()
    let client = try Client.core(baseURL: #require(URL(string: "https://core.example/v1")), transport: transport)
    let pins = PinnedMessages()
    pins.reset(roomId: testRoomId)
    let prefetch = Task { try await pins.load(client: client, organizationSlug: nil) }
    await transport.waitForRequest()
    prefetch.cancel()
    let panel = Task { try await pins.load(client: client, organizationSlug: nil) }
    await Task.yield()
    await transport.release()
    try await prefetch.value
    try await panel.value
    #expect(pins.items.map(\.messageId) == ["pin"])
    #expect(!pins.isLoading)
  }

  @Test(arguments: [false, true])
  func pinAndUnpinUseScopedEndpoints(organization: Bool) async throws {
    let body = #"{"data":{"messageId":"message","pinnedMessageCount":1},"meta":{"timestamp":"2026-01-01T00:00:00.000Z","requestId":"req"}}"#
    let transport = TestTransport([(200, body), (200, body)])
    let client = try makeTestClient(transport)
    let slug = organization ? "team" : nil
    let pinned = try await ChatService().pinMessage(client: client, roomId: testRoomId, messageId: "message", organizationSlug: slug)
    let unpinned = try await ChatService().unpinMessage(client: client, roomId: testRoomId, messageId: "message", organizationSlug: slug)
    #expect(pinned.messageId == "message")
    #expect(unpinned.pinnedMessageCount == 1)
    #expect(transport.requests[0].request.method == .post)
    #expect(transport.requests[1].request.method == .delete)
    #expect(transport.requests.allSatisfy { $0.request.path?.contains("/messages/message/pin") == true })
    #expect(transport.requests.allSatisfy { testOrgSlugHeader($0.request) == slug })
  }

  @Test(arguments: [400, 401, 403, 404, 500])
  func pinFailuresRemainVisible(status: Int) async throws {
    let transport = TestTransport([(status, #"{"message":"Pin denied"}"#)])
    await #expect(throws: (any Error).self) {
      try await ChatService().pinMessage(client: makeTestClient(transport), roomId: testRoomId, messageId: "message", organizationSlug: nil)
    }
  }

  @Test func listPreservesUnavailablePinsAndStopsRepeatedCursor() async throws {
    let item = #"{"messageId":"missing","pinnedAt":"2026-01-01T00:00:00.000Z","pinnedBy":null,"message":null}"#
    let body = "{\"data\":[\(item)],\"meta\":{\"timestamp\":\"2026-01-01T00:00:00.000Z\",\"requestId\":\"req\",\"pagination\":{\"cursor\":null,\"limit\":100,\"total\":1,\"nextCursor\":\"next\"}}}"
    let transport = TestTransport([(200, body), (200, body)])
    let client = try makeTestClient(transport)
    let pins = PinnedMessages()
    pins.reset(roomId: testRoomId)
    try await pins.load(client: client, organizationSlug: "team")
    #expect(pins.items.count == 1)
    #expect(pins.items[0].message == nil)
    #expect(pins.nextCursor == "next")
    try await pins.load(client: client, organizationSlug: "team", older: true)
    #expect(pins.items.count == 1)
    #expect(pins.nextCursor == nil)
    #expect(transport.requests[1].request.path?.contains("cursor=next") == true)
    #expect(!pins.isLoading)
    pins.reset(roomId: "other")
    #expect(pins.items.isEmpty)
    #expect(pins.nextCursor == nil)
  }

  @Test func listDecodesMessagePreview() async throws {
    let message = testMessageJSON(id: "message", content: "Pinned preview", sender: testUserSender(name: "Person", email: "person@example.com"))
    let body = """
    {"data":[{"messageId":"message","pinnedAt":"2026-01-01T00:00:00.000Z","pinnedBy":null,"message":\(message)}],"meta":{"timestamp":"2026-01-01T00:00:00.000Z","requestId":"req","pagination":{"cursor":null,"limit":100,"total":1,"nextCursor":null}}}
    """
    let transport = TestTransport([(200, body)])
    let page = try await ChatService().listPinnedMessages(client: makeTestClient(transport), roomId: testRoomId, organizationSlug: nil)
    #expect(page.items.first?.message?.content == "Pinned preview")
  }

  @Test func aFailedFirstPageClearsThePinsLikeWeb() async throws {
    let transport = TestTransport([(200, pinsBody(["a", "b"], next: "c1")), (500, #"{"message":"Down"}"#)])
    let client = try makeTestClient(transport)
    let pins = PinnedMessages()
    pins.reset(roomId: testRoomId)
    try await pins.load(client: client, organizationSlug: nil)
    #expect(pins.items.map(\.messageId) == ["a", "b"])
    #expect(pins.nextCursor == "c1")

    await #expect(throws: (any Error).self) { try await pins.load(client: client, organizationSlug: nil) }
    #expect(pins.items.isEmpty, "Web's setItems([]) on a failed list read.")
    #expect(pins.nextCursor == nil)
    #expect(pins.errorMessage != nil)
    #expect(!pins.isLoading)
  }

  @Test func aFailedOlderPageKeepsThePinsAndShowsTheError() async throws {
    let transport = TestTransport([
      (200, pinsBody(["a", "b"], next: "c1")),
      (500, #"{"message":"Down"}"#),
      (200, pinsBody(["c"], next: nil))
    ])
    let client = try makeTestClient(transport)
    let pins = PinnedMessages()
    pins.reset(roomId: testRoomId)
    try await pins.load(client: client, organizationSlug: nil)

    await #expect(throws: (any Error).self) { try await pins.load(client: client, organizationSlug: nil, older: true) }
    #expect(pins.items.map(\.messageId) == ["a", "b"])
    #expect(pins.nextCursor == "c1")
    #expect(pins.errorMessage != nil)
    #expect(!pins.isLoading)

    try await pins.load(client: client, organizationSlug: nil, older: true)
    #expect(pins.items.map(\.messageId) == ["a", "b", "c"])
    #expect(pins.nextCursor == nil)
    #expect(pins.errorMessage == nil)
    #expect(transport.requests[2].request.path?.contains("cursor=c1") == true)
  }

  @Test func invalidateDropsALatePage() async throws {
    let transport = PausedPinTransport()
    let client = try Client.core(baseURL: #require(URL(string: "https://core.example/v1")), transport: transport)
    let pins = PinnedMessages()
    pins.reset(roomId: testRoomId)
    let revision = pins.revision
    let load = Task { try await pins.load(client: client, organizationSlug: nil) }
    await transport.waitForRequest()
    #expect(pins.isLoading)
    pins.invalidate()
    #expect(!pins.isLoading)
    #expect(pins.revision == revision + 1)
    await transport.release()
    try await load.value
    #expect(pins.items.isEmpty, "The late page belongs to a list that was invalidated.")
    #expect(pins.nextCursor == nil)
    #expect(!pins.isLoading)
  }
}
