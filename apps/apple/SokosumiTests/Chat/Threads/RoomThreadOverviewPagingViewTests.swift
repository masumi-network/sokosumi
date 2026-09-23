#if os(macOS)
  import AppKit
  import CoreAPI
  import HTTPTypes
  import OpenAPIRuntime
  @testable import Sokosumi
  import SokosumiChat
  import SwiftUI
  import Testing

  extension NativeWindowTests {
    /// Row 24e: the real `RoomThreadOverviewView` pages and fails like web's `ThreadListPanel`. The test host
    /// builds no accessibility tree, so text is read back with Vision (nil on the virtualized CI runner,
    /// where only the pixel and call checks run) and the failure's red is found by its colour.
    @MainActor struct RoomThreadOverviewPagingViewTests {
      @Test(arguments: ThreadOverviewPagingState.allCases, [false, true])
      func theStatesReadAsWeb(state: ThreadOverviewPagingState, dark: Bool) async throws {
        let fixture = try await state.overview()
        defer { Task { await fixture.transport.releaseHolds() } }
        let (window, host) = Self.host(RoomThreadOverviewView(overview: fixture.overview, open: { _ in }, older: {}, markAllRead: {},
                                                              retry: {}, close: {}), height: 330, dark: dark)
        defer { window.orderOut(nil) }
        for _ in 0 ..< 10 {
          host.layoutSubtreeIfNeeded()
          try await Task.sleep(for: .milliseconds(20))
        }
        let bitmap = try fittedBitmap(of: host, in: window)
        try Attachment.record(#require(bitmap.representation(using: .png, properties: [:])),
                              named: "thread-overview-paging-\(state.rawValue)-\(dark ? "dark" : "light").png")
        let red = Self.redPixels(in: bitmap)
        #expect(state == .olderFailed ? red.count > 20 : red.isEmpty, "Only a failed older page is drawn in red: \(red.count) pixels.")

        guard let lines = try RoomThreadOverviewGroupsViewTests.recognizedText(in: bitmap) else { return }
        let texts = lines.map(\.text)
        func top(_ fragment: String) -> CGFloat? {
          lines.first { $0.text.contains(fragment) }.map { (1 - $0.box.maxY) * CGFloat(bitmap.pixelsHigh) }
        }
        func shows(_ fragment: String) -> Bool {
          texts.contains { $0.contains(fragment) }
        }
        if state == .firstPageFailed {
          #expect(shows("Could not load threads. Try again.") && shows("Retry"), "\(texts)")
          for gone in ["Unread", "Earlier", "Release checklist", "Load older threads", "Mark all as read", "No threads yet"] {
            #expect(!shows(gone), "A failed first page clears \(gone): \(texts)")
          }
          return
        }
        let unread = try #require(top("Unread"), "\(texts)")
        let lastRow = try #require(top("Design review notes"), "\(texts)")
        #expect(unread < lastRow, "\(texts)")
        switch state {
        case .loadingOlder:
          let loading = try #require(top("Loading threads"), "\(texts)")
          #expect(loading > lastRow, "The paging row loads at the end of the list: \(texts)")
          #expect(!shows("Load older threads") && shows("Mark all as read"), "\(texts)")
        case .olderFailed:
          let failure = try #require(top("Could not load threads. Try again."), "\(texts)")
          let retry = try #require(top("Load older threads"), "\(texts)")
          #expect(lastRow < failure && failure < retry, "The failure stays on the paging row, the retry under it: \(texts)")
          #expect(!shows("Retry"), "An older page does not raise the list's error: \(texts)")
        case .markingAll:
          let loading = try #require(top("Loading threads"), "\(texts)")
          #expect(loading < unread, "Mark all reads as web's loading label while it runs: \(texts)")
          #expect(!shows("Mark all as read") && top("Load older threads").map { $0 > lastRow } == true, "\(texts)")
        case .firstPageFailed:
          break
        }
      }

      /// Web's `ThreadListLoadMore` loads by itself once it is in view, once per arming.
      @Test func thePagingRowLoadsOnceItIsInView() async throws {
        let overview = try await Self.loaded([.init(preview: "Release checklist", replies: 5, unread: 2), .init(preview: "Design review notes", replies: 4, unread: 0)])
        let calls = OlderPageCalls()
        let (window, host) = Self.host(RoomThreadOverviewView(overview: overview, open: { _ in }, older: { calls.made += 1 }, markAllRead: {},
                                                              retry: {}, close: {}), height: 330, dark: false)
        defer { window.orderOut(nil) }
        _ = try await waitForView(in: host, timeoutMessage: "The paging row in view never asked for the next page") {
          calls.made > 0 ? host : nil
        }
        for _ in 0 ..< 15 {
          host.layoutSubtreeIfNeeded()
          try await Task.sleep(for: .milliseconds(20))
        }
        #expect(calls.made == 1, "One request per arming: \(calls.made).")
      }

      /// Below the fold the row waits until the reader scrolls to it.
      @Test func thePagingRowWaitsUntilItScrollsIntoView() async throws {
        let threads = (1 ... 12).map { ThreadOverviewFixtureRow(preview: "Thread number \($0)", replies: 2, unread: $0 < 3 ? 1 : 0) }
        let overview = try await Self.loaded(threads)
        let calls = OlderPageCalls()
        let (window, host) = Self.host(RoomThreadOverviewView(overview: overview, open: { _ in }, older: { calls.made += 1 }, markAllRead: {},
                                                              retry: {}, close: {}), height: 330, dark: false)
        defer { window.orderOut(nil) }
        for _ in 0 ..< 15 {
          host.layoutSubtreeIfNeeded()
          try await Task.sleep(for: .milliseconds(20))
        }
        #expect(calls.made == 0, "Nothing is asked while the row is below the fold.")
        let scroll = try await waitForView(in: host, timeoutMessage: "No scroll view") { Self.scrollView(in: host) }
        for index in 0 ..< 120 where calls.made == 0 {
          try Self.sendScroll(scroll, delta: -60, phase: index == 0 ? 1 : 2)
          try await Task.sleep(for: .milliseconds(20))
        }
        try Self.sendScroll(scroll, delta: 0, phase: 4)
        for _ in 0 ..< 15 {
          host.layoutSubtreeIfNeeded()
          try await Task.sleep(for: .milliseconds(20))
        }
        #expect(calls.made == 1, "The row asked once it scrolled into view: \(calls.made).")
      }

      /// A failed row stops loading by itself until the reader presses it.
      @Test func aFailedPagingRowWaitsForTheReader() async throws {
        let fixture = try await ThreadOverviewPagingState.olderFailed.overview()
        let calls = OlderPageCalls()
        let (window, host) = Self.host(RoomThreadOverviewView(overview: fixture.overview, open: { _ in }, older: { calls.made += 1 }, markAllRead: {},
                                                              retry: {}, close: {}), height: 330, dark: false)
        defer { window.orderOut(nil) }
        for _ in 0 ..< 25 {
          host.layoutSubtreeIfNeeded()
          try await Task.sleep(for: .milliseconds(20))
        }
        #expect(calls.made == 0)
      }

      // MARK: Helpers

      private static func loaded(_ threads: [ThreadOverviewFixtureRow]) async throws -> RoomThreadOverview {
        let transport = try ScriptedOverviewTransport([.answer(200, threadOverviewPageBody(threads, nextCursor: "older"))])
        let overview = RoomThreadOverview()
        try await overview.load(client: Client.connecting(to: #require(URL(string: "https://example.com")), transport: transport), roomId: "room", organizationSlug: nil)
        try #require(overview.items.count == threads.count)
        return overview
      }

      private static func host(_ view: RoomThreadOverviewView, height: CGFloat, dark: Bool) -> (NSWindow, NSView) {
        let host = NSHostingView(rootView: view
          .frame(width: 280, height: height).background(.background)
          .environment(\.colorScheme, dark ? .dark : .light))
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 280, height: height), styleMask: [.titled], backing: .buffered, defer: false)
        window.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
        window.contentView = host
        window.orderFront(nil)
        return (window, host)
      }

      private static func scrollView(in view: NSView) -> NSScrollView? {
        if let scroll = view as? NSScrollView {
          return scroll
        }
        return view.subviews.lazy.compactMap { scrollView(in: $0) }.first
      }

      private static func sendScroll(_ scroll: NSScrollView, delta: Int32, phase: Int64) throws {
        let event = try #require(CGEvent(scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 1, wheel1: delta, wheel2: 0, wheel3: 0))
        event.setIntegerValueField(.scrollWheelEventScrollPhase, value: phase)
        try scroll.scrollWheel(with: #require(NSEvent(cgEvent: event)))
      }

      /// Pixels clearly red (origin top left): the older-page failure's text.
      private static func redPixels(in bitmap: NSBitmapImageRep) -> [(x: Int, y: Int)] {
        var result: [(x: Int, y: Int)] = []
        for row in 0 ..< bitmap.pixelsHigh {
          for column in 0 ..< bitmap.pixelsWide {
            guard let color = bitmap.colorAt(x: column, y: row)?.usingColorSpace(.sRGB) else { continue }
            if color.redComponent > 0.6, color.redComponent - max(color.greenComponent, color.blueComponent) > 0.3 {
              result.append((column, row))
            }
          }
        }
        return result
      }
    }
  }

  /// The overview states row 24e renders, each over the mixed 24d fixture with an older page to load.
  enum ThreadOverviewPagingState: String, CaseIterable, CustomTestStringConvertible {
    case loadingOlder = "loading-older", olderFailed = "older-failed", firstPageFailed = "first-page-failed", markingAll = "marking-all"

    var testDescription: String {
      rawValue
    }

    /// An overview put into this state through a scripted Core; a held request stays open until released.
    @MainActor
    func overview() async throws -> (overview: RoomThreadOverview, transport: ScriptedOverviewTransport) {
      let page = try threadOverviewPageBody([.init(preview: "Release checklist", replies: 5, unread: 2),
                                             .init(preview: "Design review notes", replies: 4, unread: 0)], nextCursor: "older")
      let transport = switch self {
      case .loadingOlder: try ScriptedOverviewTransport([.answer(200, page), .hold(200, threadOverviewPageBody([], nextCursor: nil))])
      case .olderFailed: ScriptedOverviewTransport([.answer(200, page), .answer(500, "{}")])
      case .firstPageFailed: ScriptedOverviewTransport([.answer(200, "not json")])
      case .markingAll: ScriptedOverviewTransport([.answer(200, page), .hold(200, #"{"data":{"markedCount":1},"meta":{"timestamp":"2026-09-23T12:00:00.000Z","requestId":"fixture"}}"#)])
      }
      let client = try Client.connecting(to: #require(URL(string: "https://example.com")), transport: transport)
      let overview = RoomThreadOverview()
      _ = try? await overview.load(client: client, roomId: "room", organizationSlug: nil)
      switch self {
      case .loadingOlder:
        Task { try await overview.load(client: client, roomId: "room", organizationSlug: nil, older: true) }
        await transport.waitForHold()
      case .olderFailed:
        _ = try? await overview.load(client: client, roomId: "room", organizationSlug: nil, older: true)
      case .markingAll:
        Task { try await overview.markAllRead(client: client, roomId: "room", organizationSlug: nil, looked: {}) }
        await transport.waitForHold()
      case .firstPageFailed:
        break
      }
      return (overview, transport)
    }
  }

  @MainActor private final class OlderPageCalls {
    var made = 0
  }

  /// Answers each request in turn; a held answer waits for `releaseHolds`.
  actor ScriptedOverviewTransport: ClientTransport {
    enum Step {
      case answer(Int, String)
      case hold(Int, String)
    }

    private var steps: [Step]
    private var held: [CheckedContinuation<Void, Never>] = []
    private var arrivals: [CheckedContinuation<Void, Never>] = []

    init(_ steps: [Step]) {
      self.steps = steps
    }

    func waitForHold() async {
      if !held.isEmpty {
        return
      }
      await withCheckedContinuation { arrivals.append($0) }
    }

    func releaseHolds() {
      held.forEach { $0.resume() }
      held = []
    }

    func send(_: HTTPRequest, body _: HTTPBody?, baseURL _: URL, operationID _: String) async throws -> (HTTPResponse, HTTPBody?) {
      guard !steps.isEmpty else {
        return (HTTPResponse(status: .internalServerError), HTTPBody("{}"))
      }
      switch steps.removeFirst() {
      case let .answer(code, body):
        return (HTTPResponse(status: .init(code: code)), HTTPBody(body))
      case let .hold(code, body):
        await withCheckedContinuation { continuation in
          held.append(continuation)
          arrivals.forEach { $0.resume() }
          arrivals = []
        }
        return (HTTPResponse(status: .init(code: code)), HTTPBody(body))
      }
    }
  }
#endif
