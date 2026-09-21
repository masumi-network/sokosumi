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
      let (search, _) = try await answeredSearch()
      // The model selects the first hit with each answer, which the view used to be handed as a binding.
      #expect(search.selectedId == "first")
      let render = try await render(search, query: "matching", jumpingId: loading ? "first" : nil, dark: dark)
      try render.png.write(to: URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("room-search-\(dark ? "dark" : "light")\(loading ? "-loading" : "").png"))
    }

    /// Row 23a: while a refined query is out the panel is the settled panel, pixel for pixel — the hits stay
    /// and no "Searching…" row pushes them down.
    @Test(arguments: [false, true])
    func refiningKeepsTheHitsOnScreen(dark: Bool) async throws {
      let (search, transport) = try await answeredSearch()
      let settled = try await render(search, query: "matching", jumpingId: nil, dark: dark)

      let client = try Client.connecting(to: #require(URL(string: "https://example.com")), transport: transport)
      let refining = Task { await search.search(query: "matching reply", roomId: "room", client: client, organizationSlug: nil) }
      await transport.waitForHeldRequest()
      let presentation = search.presentation(for: "matching reply")
      #expect(search.isLoading && presentation.isRefining)
      #expect(presentation.placeholder == nil && presentation.results.map(\.id) == ["first", "reply"])
      let stale = try await render(search, query: "matching reply", jumpingId: nil, dark: dark)
      #expect(differingBytes(stale.pixels, settled.pixels) == 0)
      Attachment.record(stale.png, named: "room-search-refining-\(dark ? "dark" : "light").png")

      await transport.release()
      await refining.value
      #expect(search.results.map(\.id) == ["reply"] && search.selectedId == "reply")
      let replaced = try await render(search, query: "matching reply", jumpingId: nil, dark: dark)
      #expect(differingBytes(replaced.pixels, settled.pixels) > 1000)
    }

    /// Row 23a: with nothing to keep, the first search reads "Searching…".
    @Test(arguments: [false, true])
    func firstSearchShowsTheLoadingRow(dark: Bool) async throws {
      let transport = SearchFixtureTransport(bodies: [])
      let search = RoomSearch(debounce: .zero)
      let client = try Client.connecting(to: #require(URL(string: "https://example.com")), transport: transport)
      let idle = try await render(search, query: "", jumpingId: nil, dark: dark)
      let first = Task { await search.search(query: "matching", roomId: "room", client: client, organizationSlug: nil) }
      await transport.waitForHeldRequest()
      let presentation = search.presentation(for: "matching")
      #expect(presentation.placeholder == .loading && presentation.results.isEmpty && !presentation.isRefining)
      let loading = try await render(search, query: "matching", jumpingId: nil, dark: dark)
      #expect(differingBytes(loading.pixels, idle.pixels) > 1000)
      Attachment.record(loading.png, named: "room-search-first-loading-\(dark ? "dark" : "light").png")
      await transport.release()
      await first.value
    }

    // MARK: - Helpers

    /// A search for "matching" answered with two hits; the transport holds every later request.
    private func answeredSearch() async throws -> (RoomSearch, SearchFixtureTransport) {
      let sender = Components.Schemas.ChatRoomUserParticipant(id: "user", name: "Alexandra Long Display Name", email: "alexandra@example.com", presence: .online)
      var first = chatRoomMessage(from: OutboundShell(clientTurnId: "first", roomId: "room", content: "A longer search result that wraps across multiple lines without overlapping the sender or timestamp. The preview should stop after two lines.", sender: sender))
      first.id = "first"
      // Old enough that the relative timestamp cannot tick over between two renders.
      first.createdAt = Date(timeIntervalSinceNow: -400 * 86400)
      var reply = first
      reply.id = "reply"
      reply.parentMessageId = "parent"
      reply.content = "A matching reply inside an older thread."
      let transport = try SearchFixtureTransport(bodies: [page([first, reply]), page([reply])])
      let search = RoomSearch(debounce: .zero)
      try await search.search(query: "matching", roomId: "room", client: Client.connecting(to: #require(URL(string: "https://example.com")), transport: transport), organizationSlug: nil)
      try #require(search.results.count == 2, Comment(rawValue: String(reflecting: search.failure)))
      return (search, transport)
    }

    private func page(_ messages: [Components.Schemas.ChatRoomMessage]) throws -> String {
      let encoder = JSONEncoder()
      encoder.dateEncodingStrategy = .custom { date, encoder in
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        var value = encoder.singleValueContainer()
        try value.encode(formatter.string(from: date))
      }
      let rows = try #require(String(bytes: encoder.encode(messages), encoding: .utf8))
      return "{\"data\":\(rows),\"meta\":{\"timestamp\":\"2026-09-15T12:00:00.000Z\",\"requestId\":\"fixture\",\"pagination\":{\"cursor\":null,\"limit\":50,\"total\":\(messages.count),\"nextCursor\":null}}}"
    }

    private func render(_ search: RoomSearch, query: String, jumpingId: String?, dark: Bool) async throws -> (png: Data, pixels: [UInt8]) {
      let content = RoomSearchResultsView(search: search, query: query, jumpingId: jumpingId, jumpError: nil, select: { _ in }, retry: {}, close: {})
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
      let data = try #require(bitmap.bitmapData)
      let pixels = Array(UnsafeBufferPointer(start: data, count: bitmap.bytesPerRow * bitmap.pixelsHigh))
      return try (#require(bitmap.representation(using: .png, properties: [:])), pixels)
    }

    private func differingBytes(_ lhs: [UInt8], _ rhs: [UInt8]) -> Int {
      guard lhs.count == rhs.count else { return max(lhs.count, rhs.count) }
      return zip(lhs, rhs).count { $0 != $1 }
    }
  }

  /// Answers the first request at once; holds each later one until released, then answers from `bodies` in order.
  private actor SearchFixtureTransport: ClientTransport {
    private var bodies: [String]
    private var answersAtOnce: Bool
    private var held: CheckedContinuation<Void, Never>?
    private var observer: CheckedContinuation<Void, Never>?

    init(bodies: [String]) {
      self.bodies = bodies
      answersAtOnce = !bodies.isEmpty
    }

    func waitForHeldRequest() async {
      if held != nil {
        return
      }
      await withCheckedContinuation { observer = $0 }
    }

    func release() {
      held?.resume()
      held = nil
    }

    func send(_: HTTPRequest, body _: HTTPBody?, baseURL _: URL, operationID _: String) async throws -> (HTTPResponse, HTTPBody?) {
      if answersAtOnce {
        answersAtOnce = false
      } else {
        await withCheckedContinuation {
          held = $0
          observer?.resume()
          observer = nil
        }
      }
      guard !bodies.isEmpty else { return (HTTPResponse(status: .internalServerError), HTTPBody("{}")) }
      return (HTTPResponse(status: .ok), HTTPBody(bodies.removeFirst()))
    }
  }
#endif
