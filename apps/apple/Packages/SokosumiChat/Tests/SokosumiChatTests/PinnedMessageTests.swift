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

@MainActor struct PinnedMessageTests {
  @Test func openingPanelDuringCancelledPrefetchStillLoadsPins() async throws {
    let transport = PausedPinTransport()
    let client = try Client.connecting(to: #require(URL(string: "https://core.example/v1")), transport: transport)
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
}
