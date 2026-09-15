#if os(macOS)
  import AppKit
  import CoreAPI
  import HTTPTypes
  import OpenAPIRuntime
  @testable import Sokosumi
  import SokosumiChat
  import SwiftUI
  import Testing

  @MainActor struct RoomSearchViewTests {
    @Test(arguments: [false, true], [false, true])
    func resultPanelRendersAtMinimumInspectorWidth(dark: Bool, loading: Bool) async throws {
      let sender = Components.Schemas.ChatRoomUserParticipant(id: "user", name: "Alexandra Long Display Name", email: "alexandra@example.com", presence: .online)
      var first = chatRoomMessage(from: OutboundShell(clientTurnId: "first", roomId: "room", content: "A longer search result that wraps across multiple lines without overlapping the sender or timestamp. The preview should stop after two lines.", sender: sender))
      first.id = "first"
      var reply = first
      reply.id = "reply"
      reply.parentMessageId = "parent"
      reply.content = "A matching reply inside an older thread."
      let encoder = JSONEncoder()
      encoder.dateEncodingStrategy = .custom { date, encoder in
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        var value = encoder.singleValueContainer()
        try value.encode(formatter.string(from: date))
      }
      let rows = try #require(String(bytes: encoder.encode([first, reply]), encoding: .utf8))
      let transport = SearchFixtureTransport(body: "{\"data\":\(rows),\"meta\":{\"timestamp\":\"2026-09-15T12:00:00.000Z\",\"requestId\":\"fixture\",\"pagination\":{\"cursor\":null,\"limit\":50,\"total\":2,\"nextCursor\":null}}}")
      let search = RoomSearch()
      try await search.search(query: "matching", roomId: "room", client: Client.connecting(to: #require(URL(string: "https://example.com")), transport: transport), organizationSlug: nil)
      try #require(search.results.count == 2, Comment(rawValue: String(reflecting: search.failure)))
      let content = RoomSearchResultsView(search: search, query: "matching", selectedId: .constant("first"), jumpingId: loading ? "first" : nil, jumpError: nil, select: { _ in }, retry: {}, close: {})
        .frame(width: 280, height: 420).background(.background)
        .environment(\.colorScheme, dark ? .dark : .light)
      let host = NSHostingView(rootView: content)
      host.frame = NSRect(x: 0, y: 0, width: 280, height: 420)
      for _ in 0 ..< 10 {
        host.layoutSubtreeIfNeeded()
        try await Task.sleep(for: .milliseconds(20))
      }
      #expect(host.fittingSize.width <= 280)
      let bitmap = try #require(host.bitmapImageRepForCachingDisplay(in: host.bounds))
      host.cacheDisplay(in: host.bounds, to: bitmap)
      let png = try #require(bitmap.representation(using: .png, properties: [:]))
      try png.write(to: URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("room-search-\(dark ? "dark" : "light")\(loading ? "-loading" : "").png"))
    }
  }

  private nonisolated struct SearchFixtureTransport: ClientTransport {
    let body: String
    func send(_: HTTPRequest, body _: HTTPBody?, baseURL _: URL, operationID _: String) async throws -> (HTTPResponse, HTTPBody?) {
      (HTTPResponse(status: .ok), HTTPBody(body))
    }
  }
#endif
