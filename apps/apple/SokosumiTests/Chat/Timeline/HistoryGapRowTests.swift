#if os(macOS)
  import AppKit
  import CoreAPI
  @testable import Sokosumi
  import SokosumiAuth
  import SokosumiChat
  import SokosumiWorkspace
  import SwiftUI
  import Synchronization
  import Testing
  import Vision

  extension NativeWindowTests {
    /// Row 04a: the history gap row follows web's `TranscriptBoundaryRow`.
    @MainActor struct HistoryGapRowTests {
      /// Reading toward the gap fills it without a tap, and the rows already on screen stay where they are.
      @Test func aGapRowLoadsItselfOnceItScrollsIntoViewAndKeepsTheReadingPosition() async throws {
        let fixture = try await jumpedFixture(firstFillFails: false, holdFill: true)
        defer {
          GapPageProtocol.pendingResponse.withLock { $0 = nil }
          fixture.session.invalidateAndCancel()
        }
        let state = fixture.state
        let (window, host) = makeWindow(state: state, auth: fixture.auth)
        defer { window.orderOut(nil) }
        let scroll = try await landedTranscript(state: state, host: host)
        #expect(GapPageProtocol.fillRequests == 0, "A gap below the fold does not load until it is in view.")
        #expect(state.timeline.boundaryLoads.status(of: "fixture-70") == .idle)

        try await scrollDownUntilTheGapAsks(scroll)
        #expect(GapPageProtocol.fillRequests == 1)
        #expect(state.timeline.boundaryLoads.status(of: "fixture-70") == .loading)
        // A little further, so the row that asked is fully in view at the bottom while its page is held back.
        for _ in 0 ..< 3 {
          try sendScroll(scroll, delta: -40, phase: 2)
          try await Task.sleep(for: .milliseconds(20))
        }
        try sendScroll(scroll, delta: 0, phase: 4)
        try await Task.sleep(for: .milliseconds(300))
        #expect(GapPageProtocol.fillRequests == 1, "Scrolling on while the page loads does not ask again.")
        host.layoutSubtreeIfNeeded()
        let beforeBitmap = try renderedBitmap(host)
        let before = try #require(beforeBitmap.cgImage)
        let gapRowTop = try gapRowTop(in: beforeBitmap)
        // The rows compared for the reading position: from an eighth of the render to 60 pt above the gap row,
        // at most half way. Points, not pixels: the CI runner renders at 1x.
        let scale = before.height / Int(host.bounds.height)
        let firstRow = before.height / 8
        let lastRow = min(before.height / 2, Int(Double(before.height) * gapRowTop) - 60 * scale)
        try #require(lastRow > firstRow + 100 * scale,
                     "The gap row must leave rows above it to compare: rows \(firstRow)..<\(lastRow) of \(before.height) at \(scale)x, gap row at \(gapRowTop).")

        try #require(state.timeline.messages.count == 60)
        GapPageProtocol.release()
        _ = try await waitForView(in: host, timeoutMessage: "The gap page did not merge; \(state.timeline.messages.count) rows") {
          state.timeline.messages.count == 95 ? scroll : nil
        }
        #expect(state.timeline.historyGapMessageIds.isEmpty, "The page reached the jump window, so the ranges joined.")
        #expect(state.timeline.boundaryLoads.status(of: "fixture-70") == .idle)
        #expect(state.transcriptError == nil)
        #expect(GapPageProtocol.olderRequests == 0, "The row above the oldest range did not load on its own.")
        try await Task.sleep(for: .milliseconds(300))
        host.layoutSubtreeIfNeeded()
        try await expectStableReadingPosition(host, before: before, rows: firstRow ..< lastRow, scale: scale)
      }

      /// Where the gap row sits in the render, as a fraction of the height from the top: the rows compared for
      /// the reading position are the ones above it. Where Vision cannot run, the row is trusted to be in the
      /// lower half, where the scroll left it.
      private func gapRowTop(in bitmap: NSBitmapImageRep) throws -> Double {
        guard let lines = try recognizedText(in: bitmap) else { return 0.5 }
        let read = lines.map(\.text)
        let label = try #require(lines.first { normalized($0.text).contains("messages are missing here") }, "OCR read: \(read)")
        #expect(read.contains { $0.contains("Loading missing messages") }, "OCR read: \(read)")
        return 1 - label.box.maxY
      }

      /// A failed page stays on the row with Try again; no transcript banner, no alert.
      @Test func aFailedGapStaysOnItsRowWithoutAnAlertAndTryAgainReloads() async throws {
        let fixture = try await jumpedFixture(firstFillFails: true, holdFill: false)
        defer { fixture.session.invalidateAndCancel() }
        let state = fixture.state
        let windowsBefore = NSApp.windows.count
        let (window, host) = makeWindow(state: state, auth: fixture.auth)
        defer { window.orderOut(nil) }
        let scroll = try await landedTranscript(state: state, host: host)
        try await scrollDownUntilTheGapAsks(scroll)
        // The row asked the moment its first point came into view; bring the whole row in to read it.
        for _ in 0 ..< 3 {
          try sendScroll(scroll, delta: -40, phase: 2)
          try await Task.sleep(for: .milliseconds(20))
        }
        try sendScroll(scroll, delta: 0, phase: 4)
        _ = try await waitForView(in: host, timeoutMessage: "The failed page did not settle on the row") {
          state.timeline.boundaryLoads.status(of: "fixture-70") == .failed ? scroll : nil
        }
        #expect(GapPageProtocol.fillRequests == 1)
        #expect(state.timeline.historyGapMessageIds == ["fixture-70"], "The gap is kept for Try again.")
        #expect(state.timeline.messages.count == 60)
        #expect(state.transcriptError == nil, "No banner above the transcript.")
        #expect(state.timeline.failedPage == nil)
        for _ in 0 ..< 15 {
          host.layoutSubtreeIfNeeded()
          try await Task.sleep(for: .milliseconds(20))
        }
        #expect(window.attachedSheet == nil, "The jump alert is not presented for a gap failure.")
        #expect(NSApp.windows.count == windowsBefore + 1, "No alert panel opened beside the fixture window.")

        try tryAgain(in: window, host: host, state: state, auth: fixture.auth)
        _ = try await waitForView(in: host, timeoutMessage: "Try again did not start a load; status \(state.timeline.boundaryLoads.status(of: "fixture-70"))") {
          state.timeline.boundaryLoads.status(of: "fixture-70") != .failed ? scroll : nil
        }
        _ = try await waitForView(in: host, timeoutMessage: "The retried page did not merge; \(state.timeline.messages.count) rows") {
          state.timeline.messages.count == 95 ? scroll : nil
        }
        #expect(GapPageProtocol.fillRequests == 2)
        #expect(state.timeline.historyGapMessageIds.isEmpty)
        #expect(state.transcriptError == nil)
        #expect(window.attachedSheet == nil)
      }

      /// Reads the failed row back and clicks Try again where Vision finds it; where Vision cannot run
      /// (the virtualized CI runner) the closure the button runs is called directly.
      private func tryAgain(in window: NSWindow, host: NSView, state: WorkspaceState, auth: AuthState) throws {
        let bitmap = try renderedBitmap(host)
        guard let lines = try recognizedText(in: bitmap) else {
          state.loadHistoryGap(before: "fixture-70", auth: auth)
          note("Try again driven through the row's action; OCR unavailable")
          return
        }
        let read = lines.map(\.text)
        #expect(read.contains { normalized($0).contains("couldn't load messages") }, "OCR read: \(read)")
        #expect(read.contains { $0.contains("Try again") }, "OCR read: \(read)")
        #expect(!read.contains { $0.contains("Load missing messages") }, "OCR read: \(read)")
        let retry = try #require(lines.first { $0.text.contains("Try again") })
        click(in: window, host: host, normalizedBox: retry.box)
        note("Try again clicked at its OCR box")
      }

      /// Sub-pixel / antialias drift is not a product failure. A jump of about a message row is.
      private static let readingPositionBand = 16

      private func expectStableReadingPosition(_ host: NSView, before: CGImage, rows: Range<Int>, scale: Int) async throws {
        let after = try snapshot(host)
        try #require(before.width == after.width && before.height == after.height && before.bitsPerPixel == 32 && after.bitsPerPixel == 32,
                     "The renders must match: \(before.width)x\(before.height)x\(before.bitsPerPixel) and \(after.width)x\(after.height)x\(after.bitsPerPixel).")
        // The detached task records no issues: it has no test to attribute them to.
        let match = try #require(await Task.detached { Self.renderedShift(before: before, after: after, rows: rows, scale: scale) }.value, "The renders have no pixel data.")
        try #require(match.identifiable, "The fixture must render identifiable text.")
        let shift = match.shift
        if abs(shift) > Self.readingPositionBand {
          Attachment.record(before, named: "gap-fill-before.png")
          Attachment.record(after, named: "gap-fill-after.png")
        }
        #expect(abs(shift) <= Self.readingPositionBand,
                "Filling the gap moved the rows above it by \(shift) backing pixels (band is \(Self.readingPositionBand) px).")
      }

      /// The transcript with the jump consumed and its target centered.
      private func landedTranscript(state: WorkspaceState, host: NSView) async throws -> NSScrollView {
        let scroll = try await loadedTranscriptScrollView(in: host)
        _ = try await waitForView(in: host, timeoutMessage: "The jump target did not land") {
          state.messageJump == nil ? scroll : nil
        }
        for _ in 0 ..< 15 {
          host.layoutSubtreeIfNeeded()
          try await Task.sleep(for: .milliseconds(20))
        }
        return scroll
      }

      /// The copy of every state, read back from the render. CI OCR is a no-op, so a second
      /// appearance would not evaluate anything extra there; local OCR still runs.
      @Test func theRowsReadAsWebInEachState() async throws {
        let rows = VStack(spacing: 0) {
          PageBoundaryRow(copy: .transcript(isGap: true), status: .idle) {}
          Divider()
          PageBoundaryRow(copy: .transcript(isGap: true), status: .loading) {}
          Divider()
          PageBoundaryRow(copy: .transcript(isGap: true), status: .failed) {}
          Divider()
          PageBoundaryRow(copy: .transcript(isGap: false), status: .idle) {}
          Divider()
          PageBoundaryRow(copy: .transcript(isGap: false), status: .loading) {}
          Divider()
          PageBoundaryRow(copy: .transcript(isGap: false), status: .failed) {}
        }
        .padding(12)
        .background(.background)
        let host = NSHostingView(rootView: rows)
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 420, height: 420), styleMask: [.titled], backing: .buffered, defer: false)
        window.contentView = host
        window.orderFront(nil)
        defer { window.orderOut(nil) }
        _ = try await waitForView(in: host, timeoutMessage: "The rows did not lay out") {
          host.fittingSize.height > 200 ? host : nil
        }
        for _ in 0 ..< 10 {
          host.layoutSubtreeIfNeeded()
          try await Task.sleep(for: .milliseconds(20))
        }
        let bitmap = try renderedBitmap(host)
        try Attachment.record(#require(bitmap.cgImage), named: "history-gap-rows.png")
        if let lines = try recognizedText(in: bitmap) {
          let read = lines.map(\.text)
          let expected = [
            "Messages are missing here", "Load missing messages", "Loading missing messages",
            "Couldn't load messages.", "Try again", "Load older messages", "Loading older messages"
          ]
          for text in expected {
            #expect(read.contains { normalized($0).contains(normalized(text)) }, "Missing \"\(text)\"; OCR read: \(read)")
          }
          #expect(read.filter { normalized($0).contains("messages are missing here") }.count == 2, "The gap says it in idle and loading, not after a failure; OCR read: \(read)")
          #expect(read.filter { $0.contains("Try again") }.count == 2, "OCR read: \(read)")
        }
      }

      // MARK: - Fixture

      /// The latest page (70…99), then a jump to `fixture-20` that loads 5…34: the history 35…69 is a gap on `fixture-70`.
      private func jumpedFixture(firstFillFails: Bool, holdFill: Bool) async throws -> GapFixture {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [GapPageProtocol.self]
        let session = URLSession(configuration: configuration)
        let client = try Client.connecting(to: #require(URL(string: "https://gap-fixture.invalid/v1")), session: session)
        try GapPageProtocol.reset(GapScript(
          latest: page((70 ..< 100).map(message), cursor: "c70"),
          window: page((5 ..< 35).map(message), cursor: "c5"),
          fill: page((34 ..< 70).map(message), cursor: "c34"),
          target: envelope(message(20)),
          firstFillFails: firstFillFails, holdFill: holdFill
        ))
        let state = WorkspaceState(clientProvider: { _ in client })
        let auth = AuthState()
        state.timeline.reset(roomId: "room")
        _ = try await state.timeline.loadPage(.initial, client: client, organizationSlug: nil, generation: state.timeline.generation)
        #expect(try await state.openMessage("fixture-20", auth: auth) == .opened)
        #expect(state.timeline.historyGapMessageIds == ["fixture-70"])
        #expect(state.timeline.messages.count == 60)
        return GapFixture(state: state, auth: auth, session: session)
      }

      private func makeWindow(state: WorkspaceState, auth: AuthState) -> (NSWindow, NSHostingView<some View>) {
        let host = NSHostingView(rootView: RoomTimelineView(roomId: "room").background(.background).environmentObject(state).environmentObject(auth))
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 900, height: 700), styleMask: [.titled], backing: .buffered, defer: false)
        window.contentView = host
        window.orderFront(nil)
        return (window, host)
      }

      /// Reads down toward the gap. The row asks for its page the moment it is in view.
      private func scrollDownUntilTheGapAsks(_ scroll: NSScrollView) async throws {
        for index in 0 ..< 120 {
          try sendScroll(scroll, delta: -60, phase: index == 0 ? 1 : 2)
          try await Task.sleep(for: .milliseconds(20))
          if GapPageProtocol.fillRequests > 0 {
            return
          }
        }
        Issue.record("The gap row never asked for its page while scrolling \(scroll.contentView.bounds.minY) pt down.")
      }

      private func sendScroll(_ scroll: NSScrollView, delta: Int32, phase: Int64) throws {
        let event = try #require(CGEvent(scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 1, wheel1: delta, wheel2: 0, wheel3: 0))
        event.setIntegerValueField(.scrollWheelEventScrollPhase, value: phase)
        try scroll.scrollWheel(with: #require(NSEvent(cgEvent: event)))
      }

      /// A click at a Vision box: normalized, origin bottom-left, which is the window's own frame for a content view that fills it.
      private func click(in window: NSWindow, host: NSView, normalizedBox box: CGRect) {
        let point = NSPoint(x: box.midX * host.bounds.width, y: box.midY * host.bounds.height)
        for type in [NSEvent.EventType.leftMouseDown, .leftMouseUp] {
          guard let event = NSEvent.mouseEvent(with: type, location: point, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
                                               windowNumber: window.windowNumber, context: nil, eventNumber: 0, clickCount: 1, pressure: 1) else { continue }
          window.sendEvent(event)
        }
      }

      private func renderedBitmap(_ host: NSView) throws -> NSBitmapImageRep {
        let bitmap = try #require(host.bitmapImageRepForCachingDisplay(in: host.bounds))
        host.cacheDisplay(in: host.bounds, to: bitmap)
        return bitmap
      }

      private func snapshot(_ host: NSView) throws -> CGImage {
        try #require(renderedBitmap(host).cgImage)
      }

      /// Vision's lines with their boxes, or nil where Vision cannot run at all (the virtualized CI runner).
      private func recognizedText(in bitmap: NSBitmapImageRep) throws -> [(text: String, box: CGRect)]? {
        let image = try #require(bitmap.cgImage)
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.recognitionLanguages = ["en-US"]
        request.usesLanguageCorrection = false
        do {
          try VNImageRequestHandler(cgImage: image).perform([request])
        } catch {
          note("OCR unavailable (accurate): \(error)")
          return nil
        }
        note("OCR ran (accurate)")
        return (request.results ?? []).compactMap { observation in
          observation.topCandidates(1).first.map { (text: $0.string, box: observation.boundingBox) }
        }
      }

      private func normalized(_ text: String) -> String {
        text.replacingOccurrences(of: "’", with: "'").lowercased()
      }

      private func note(_ line: String) {
        print(line)
        Attachment.record(line, named: "history-gap-row-ocr-path.txt")
      }

      /// Compares the rows above the gap row that entered at the bottom. Lazy stacks estimate their
      /// total height, so visible pixels are compared instead of the scroll offset. Nil without pixel data.
      private nonisolated static func renderedShift(before: CGImage, after: CGImage, rows: Range<Int>, scale: Int) -> (shift: Int, identifiable: Bool)? {
        guard let firstData = before.dataProvider?.data, let secondData = after.dataProvider?.data else { return nil }
        defer { withExtendedLifetime((firstData, secondData)) {} }
        guard let first = CFDataGetBytePtr(firstData), let second = CFDataGetBytePtr(secondData) else { return nil }
        func difference(_ shift: Int) -> Int {
          var total = 0
          for row in stride(from: rows.lowerBound, to: rows.upperBound, by: 3) {
            for column in stride(from: before.width / 12, to: before.width / 3, by: 4) {
              let firstOffset = row * before.bytesPerRow + column * 4
              let secondOffset = (row + shift) * after.bytesPerRow + column * 4
              for component in 0 ..< 4 {
                total += abs(Int(first[firstOffset + component]) - Int(second[secondOffset + component]))
              }
            }
          }
          return total
        }
        guard let shift = (-50 * scale ... 50 * scale).min(by: { difference($0) < difference($1) }) else { return nil }
        return (shift, difference(shift) < difference(shift + 10 * scale))
      }

      private func message(_ index: Int) -> Components.Schemas.ChatRoomMessage {
        var message = chatRoomMessage(from: .init(clientTurnId: "fixture-\(index)", roomId: "room",
                                                  content: "Message \(index): " + String(repeating: "a line of the fixture transcript, ", count: 5),
                                                  sender: .init(id: "user-\(index % 2)", name: "Example", email: "example@example.com", presence: .online)))
        message.id = "fixture-\(index)"
        message.createdAt = Date(timeIntervalSince1970: 1_700_000_000 + Double(index) * 60)
        return message
      }

      private func encoder() -> JSONEncoder {
        let encoder = JSONEncoder()
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "yyyy-MM-dd'T'HH:mm:ss.SSSXXXXX"
        encoder.dateEncodingStrategy = .formatted(formatter)
        return encoder
      }

      private func page(_ messages: [Components.Schemas.ChatRoomMessage], cursor: String?) throws -> Data {
        try JSONSerialization.data(withJSONObject: [
          "data": JSONSerialization.jsonObject(with: encoder().encode(messages)),
          "meta": ["timestamp": "2026-09-22T00:00:00.000Z", "requestId": "fixture",
                   "pagination": ["cursor": NSNull(), "limit": 30, "total": messages.count, "nextCursor": cursor as Any? ?? NSNull()]]
        ])
      }

      private func envelope(_ message: Components.Schemas.ChatRoomMessage) throws -> Data {
        try JSONSerialization.data(withJSONObject: [
          "data": JSONSerialization.jsonObject(with: encoder().encode(message)),
          "meta": ["timestamp": "2026-09-22T00:00:00.000Z", "requestId": "fixture"]
        ])
      }
    }
  }

  private struct GapFixture {
    let state: WorkspaceState
    let auth: AuthState
    let session: URLSession
  }

  private struct GapScript: Sendable {
    var latest = Data()
    var window = Data()
    var fill = Data()
    var target = Data()
    var firstFillFails = false
    var holdFill = false
    var fillRequests = 0
    var olderRequests = 0
  }

  /// Answers the room's history by request shape: the latest page, the jump window, one message, and the
  /// gap page (`cursor=fixture-70`), which can be held back or fail once.
  private final nonisolated class GapPageProtocol: URLProtocol, @unchecked Sendable {
    private struct Answer {
      var data: Data
      var status = 200
      var hold = false
    }

    private static let script = Mutex(GapScript())
    static let pendingResponse = Mutex<(@Sendable () -> Void)?>(nil)
    private let cancelled = Mutex(false)

    static var fillRequests: Int {
      script.withLock { $0.fillRequests }
    }

    static var olderRequests: Int {
      script.withLock { $0.olderRequests }
    }

    static func reset(_ fresh: GapScript) {
      script.withLock { $0 = fresh }
      pendingResponse.withLock { $0 = nil }
    }

    static func release() {
      let response = pendingResponse.withLock { response in
        defer { response = nil }
        return response
      }
      response.map { DispatchQueue.global().async(execute: $0) }
    }

    override static func canInit(with request: URLRequest) -> Bool {
      request.url?.host == "gap-fixture.invalid"
    }

    override static func canonicalRequest(for request: URLRequest) -> URLRequest {
      request
    }

    override func startLoading() {
      guard let url = request.url else { return }
      let query = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
      let cursor = query.first { $0.name == "cursor" }?.value
      let around = query.first { $0.name == "around" }?.value
      let answer: Answer = Self.script.withLock { script in
        if url.path.hasSuffix("/messages/fixture-20") {
          return Answer(data: script.target)
        }
        if around != nil {
          return Answer(data: script.window)
        }
        if cursor == "fixture-70" {
          script.fillRequests += 1
          let fails = script.firstFillFails && script.fillRequests == 1
          return Answer(data: fails ? Data("{}".utf8) : script.fill, status: fails ? 500 : 200, hold: script.holdFill && !fails)
        }
        if cursor != nil {
          script.olderRequests += 1
          return Answer(data: Data("{}".utf8), status: 500)
        }
        return Answer(data: script.latest)
      }
      guard let response = HTTPURLResponse(url: url, statusCode: answer.status, httpVersion: nil, headerFields: ["Content-Type": "application/json"]) else { return }
      let complete: @Sendable () -> Void = { [self] in
        guard !cancelled.withLock({ $0 }) else { return }
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: answer.data)
        client?.urlProtocolDidFinishLoading(self)
      }
      if answer.hold {
        Self.pendingResponse.withLock { $0 = complete }
      } else {
        complete()
      }
    }

    override func stopLoading() {
      cancelled.withLock { $0 = true }
    }
  }
#endif
