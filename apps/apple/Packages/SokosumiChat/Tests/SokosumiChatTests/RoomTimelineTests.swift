import CoreAPI
import Foundation
import HTTPTypes
import OpenAPIRuntime
import SokosumiChat
import Testing

private actor PausedHistoryTransport: ClientTransport {
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
    let row = testMessageJSON(id: "late", content: "Late history", sender: testUserSender(name: "Ada", email: "ada@example.com"))
    return (HTTPResponse(status: .ok), HTTPBody(testMessagesPageBody(messages: [row], nextCursor: nil)))
  }
}

@MainActor
struct RoomTimelineTests {
  private func client(_ transport: some ClientTransport) -> Client {
    Client.connecting(to: URL(string: "https://core.example/v1")!, transport: transport)
  }

  private func row(_ id: String, content: String, date: String = testTimestamp) -> String {
    testMessageJSON(id: id, content: content, sender: testUserSender(name: "Ada", email: "ada@example.com"), createdAt: date)
  }

  @Test func olderPageMergesOverlapAndStopsRepeatedCursor() async throws {
    let transport = TestTransport([
      (200, testMessagesPageBody(messages: [row("b", content: "Newer")], nextCursor: "older")),
      (200, testMessagesPageBody(messages: [row("a", content: "Earlier", date: "2025-12-31T23:59:00.000Z"), row("b", content: "Updated")], nextCursor: "older"))
    ])
    let timeline = RoomTimeline()
    timeline.reset(roomId: testRoomId)
    #expect(try await timeline.loadPage(.initial, client: client(transport), organizationSlug: "acme", generation: timeline.generation))
    #expect(timeline.hasMore)
    #expect(try await timeline.loadPage(.older, client: client(transport), organizationSlug: "acme", generation: timeline.generation))
    #expect(timeline.messages.map(\.id) == ["a", "b"])
    #expect(timeline.messages.last?.content == "Updated")
    #expect(!timeline.hasMore)
    #expect(timeline.cursor == nil)
  }

  @Test func failedOlderPageRetainsMessagesAndRetryCursor() async throws {
    let transport = TestTransport([
      (200, testMessagesPageBody(messages: [row("b", content: "Retained")], nextCursor: "older")),
      (503, "{}"),
      (200, testMessagesPageBody(messages: [row("a", content: "Earlier")], nextCursor: nil))
    ])
    let timeline = RoomTimeline()
    timeline.reset(roomId: testRoomId)
    try await timeline.loadPage(.initial, client: client(transport), organizationSlug: nil, generation: timeline.generation)
    await #expect(throws: ChatServiceError.self) {
      try await timeline.loadPage(.older, client: client(transport), organizationSlug: nil, generation: timeline.generation)
    }
    #expect(timeline.messages.map(\.id) == ["b"])
    #expect(timeline.cursor == "older")
    #expect(timeline.failedPage == .older)
    try await timeline.loadPage(.older, client: client(transport), organizationSlug: nil, generation: timeline.generation)
    #expect(timeline.messages.map(\.id) == ["a", "b"])
  }

  @Test func latePageCannotPopulateDifferentRoom() async throws {
    let transport = PausedHistoryTransport()
    let timeline = RoomTimeline()
    timeline.reset(roomId: testRoomId)
    let generation = timeline.generation
    let task = Task { try await timeline.loadPage(.initial, client: client(transport), organizationSlug: nil, generation: generation) }
    await transport.waitForRequest()
    timeline.reset(roomId: "different")
    await transport.release()
    #expect(try await task.value == false)
    #expect(timeline.roomId == "different")
    #expect(timeline.messages.isEmpty)
    #expect(!timeline.isLoadingOlder)
  }

  @Test func resizingAndExhaustedHistoryDoNotUnpinLatest() {
    var intent = TimelineScrollIntent()
    let resizeLoads = intent.beginAutomaticOlderPage(userIsScrolling: false, isNearTop: true, hasMore: true, isLoading: false)
    #expect(!resizeLoads)
    #expect(intent.followsLatest)
    let exhaustedLoads = intent.beginAutomaticOlderPage(userIsScrolling: true, isNearTop: true, hasMore: false, isLoading: false)
    #expect(!exhaustedLoads)
    #expect(intent.followsLatest)
    let scrollLoads = intent.beginAutomaticOlderPage(userIsScrolling: true, isNearTop: true, hasMore: true, isLoading: false)
    #expect(scrollLoads)
    #expect(!intent.followsLatest)
  }

  @Test func scrollIntentPreservesReadingPositionUntilExplicitReturn() {
    var intent = TimelineScrollIntent()
    #expect(intent.followsLatest)
    intent.userScrolled(distanceFromBottom: 300)
    #expect(!intent.followsLatest)
    intent.followLatest()
    #expect(intent.followsLatest)
    intent.readOlder()
    #expect(!intent.followsLatest)
    intent.userScrolled(distanceFromBottom: 20)
    #expect(intent.followsLatest)
  }
}
