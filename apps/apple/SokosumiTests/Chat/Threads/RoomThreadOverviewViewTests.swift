#if os(macOS)
  import AppKit
  import CoreAPI
  import HTTPTypes
  import OpenAPIRuntime
  @testable import Sokosumi
  import SokosumiChat
  import SwiftUI
  import Testing

  @MainActor struct RoomThreadOverviewViewTests {
    @Test(arguments: [false, true])
    func threadPanelRendersAtMinimumInspectorWidth(dark: Bool) async throws {
      let sender = Components.Schemas.ChatRoomUserParticipant(id: "user", name: "Alexandra Long Display Name", email: "alexandra@example.com", presence: .online)
      var first = chatRoomMessage(from: OutboundShell(clientTurnId: "first", roomId: "room", content: "A longer thread preview that wraps across multiple lines without overlapping the sender or timestamp. The preview should stop after two lines.", sender: sender))
      first.id = "first"
      var second = first
      second.id = "second"
      second.content = "The attachment preview is ready for another look."
      let threads = [
        Components.Schemas.ChatRoomThread(parentMessage: first, replyCount: 4, lastReplyAt: Date().addingTimeInterval(-3600), unreadReplyCount: 2, hasLooked: true),
        Components.Schemas.ChatRoomThread(parentMessage: second, replyCount: 1, lastReplyAt: Date().addingTimeInterval(-7200), unreadReplyCount: 0, hasLooked: true)
      ]
      let encoder = JSONEncoder()
      encoder.dateEncodingStrategy = .custom { date, encoder in
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        var value = encoder.singleValueContainer()
        try value.encode(formatter.string(from: date))
      }
      let rows = try #require(String(bytes: encoder.encode(threads), encoding: .utf8))
      let transport = ThreadOverviewFixtureTransport(body: "{\"data\":\(rows),\"meta\":{\"timestamp\":\"2026-09-15T12:00:00.000Z\",\"requestId\":\"fixture\",\"pagination\":{\"cursor\":null,\"limit\":50,\"total\":2,\"nextCursor\":null}}}")
      let overview = RoomThreadOverview()
      try await overview.load(client: Client.connecting(to: #require(URL(string: "https://example.com")), transport: transport), roomId: "room", organizationSlug: nil)
      try #require(overview.items.count == 2)
      let content = RoomThreadOverviewView(overview: overview, open: { _ in }, older: {}, markAllRead: {}, retry: {}, close: {})
        .frame(width: 280, height: 420).background(.background)
        .environment(\.colorScheme, dark ? .dark : .light)
      let host = NSHostingView(rootView: content)
      host.frame = NSRect(x: 0, y: 0, width: 280, height: 420)
      for _ in 0 ..< 10 {
        host.layoutSubtreeIfNeeded()
        try await Task.sleep(for: .milliseconds(20))
      }
      #expect(host.fittingSize.width <= 280)
    }
  }

  private nonisolated struct ThreadOverviewFixtureTransport: ClientTransport {
    let body: String
    func send(_: HTTPRequest, body _: HTTPBody?, baseURL _: URL, operationID _: String) async throws -> (HTTPResponse, HTTPBody?) {
      (HTTPResponse(status: .ok), HTTPBody(body))
    }
  }
#endif
