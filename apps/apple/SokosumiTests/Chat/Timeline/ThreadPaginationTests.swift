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

  extension NativeWindowTests {
    @MainActor struct ThreadPaginationTests {
      @Test(arguments: [false, true], [false, true])
      func scrollingToOlderRepliesLoadsOnePage(fails: Bool, continuesScrolling: Bool) async throws {
        let (state, session) = try await fixture(fails: fails)
        defer {
          ThreadPageProtocol.pendingResponse.withLock { $0 = nil }
          session.invalidateAndCancel()
        }
        let host = NSHostingView(rootView: ReplyThreadView().environmentObject(state).environmentObject(AuthState()))
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 900, height: 700), styleMask: [.titled], backing: .buffered, defer: false)
        window.ignoresMouseEvents = true
        window.contentView = host
        window.orderFront(nil)
        defer { window.orderOut(nil) }
        let scroll = try await loadedTranscriptScrollView(in: host)
        #expect(ThreadPageProtocol.requests.withLock { $0 } == 1, "Initial layout must not drain older pages.")
        try await scrollToBoundary(scroll, continuesScrolling: continuesScrolling)
        host.layoutSubtreeIfNeeded()
        let before = try snapshot(host)
        try #require(state.thread.timeline.messages.count == 30)
        let response = try #require(ThreadPageProtocol.pendingResponse.withLock { response in
          defer { response = nil }
          return response
        })
        DispatchQueue.global().async(execute: response)
        for _ in 0 ..< 100 {
          if state.thread.timeline.messages.count == 59 || state.thread.timeline.errorMessage != nil {
            break
          }
          try await Task.sleep(for: .milliseconds(20))
        }
        #expect(ThreadPageProtocol.requests.withLock { $0 } == 2)
        if fails {
          #expect(state.thread.timeline.errorMessage != nil)
          #expect(state.thread.timeline.messages.count == 30)
          for index in 0 ..< 5 {
            try sendScroll(scroll, delta: 80, phase: index == 0 ? 1 : 2)
            try await Task.sleep(for: .milliseconds(20))
          }
          try sendScroll(scroll, delta: 0, phase: 4)
          #expect(ThreadPageProtocol.requests.withLock { $0 } == 2, "A failed page needs an explicit retry, not another automatic request.")
          return
        }
        #expect(state.thread.timeline.messages.count == 59)
        #expect(!state.thread.timeline.hasMore)
        try await Task.sleep(for: .milliseconds(300))
        host.layoutSubtreeIfNeeded()
        try await expectStableReadingPosition(host, before: before)
      }

      @Test func searchTargetScrollsToAnOlderPreparedReply() async throws {
        let (state, session) = try await fixture(fails: false)
        defer {
          state.reset()
          session.invalidateAndCancel()
        }
        let host = NSHostingView(rootView: ReplyThreadView().environmentObject(state).environmentObject(AuthState()))
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 900, height: 700), styleMask: [.titled], backing: .buffered, defer: false)
        window.ignoresMouseEvents = true
        window.contentView = host
        window.orderFront(nil)
        defer { window.orderOut(nil) }
        let scroll = try await loadedTranscriptScrollView(in: host)
        let initialOffset = scroll.contentView.bounds.minY
        let target = try #require(state.thread.timeline.messages.first?.id)
        state.thread.requestJump(to: target)
        for _ in 0 ..< 50 {
          if scroll.contentView.bounds.minY < initialOffset - 200 {
            break
          }
          try await Task.sleep(for: .milliseconds(20))
        }
        #expect(scroll.contentView.bounds.minY < initialOffset - 200)
        #expect(state.thread.jumpTarget?.messageId == target)
      }

      private func expectStableReadingPosition(_ host: NSView, before: CGImage) async throws {
        let after = try snapshot(host)
        // Lazy stacks estimate their total height. Compare visible pixels instead of that estimate.
        let shift = try await Task.detached { try Self.renderedShift(before: before, after: after) }.value
        if abs(shift) > 2 {
          Attachment.record(before, named: "pagination-before")
          Attachment.record(after, named: "pagination-after")
        }
        #expect(abs(shift) <= 2, "Prepending replies moved visible text by \(shift) backing pixels.")
      }

      private func scrollToBoundary(_ scroll: NSScrollView, continuesScrolling: Bool) async throws {
        for index in 0 ..< 80 {
          try sendScroll(scroll, delta: 80, phase: index == 0 ? 1 : 2)
          try await Task.sleep(for: .milliseconds(20))
          if ThreadPageProtocol.requests.withLock({ $0 }) > 1 {
            break
          }
        }
        if continuesScrolling {
          for _ in 0 ..< 8 {
            try sendScroll(scroll, delta: 80, phase: 2)
            try await Task.sleep(for: .milliseconds(20))
          }
        }
        try sendScroll(scroll, delta: 0, phase: 4)
        // Settle elastic scrolling before measuring the pending page insertion.
        try await Task.sleep(for: .milliseconds(300))
      }

      private func snapshot(_ host: NSView) throws -> CGImage {
        let image = try #require(host.bitmapImageRepForCachingDisplay(in: host.bounds))
        host.cacheDisplay(in: host.bounds, to: image)
        return try #require(image.cgImage)
      }

      private nonisolated static func renderedShift(before: CGImage, after: CGImage) throws -> Int {
        let firstData = try #require(before.dataProvider?.data)
        let secondData = try #require(after.dataProvider?.data)
        defer { withExtendedLifetime((firstData, secondData)) {} }
        let first = try #require(CFDataGetBytePtr(firstData))
        let second = try #require(CFDataGetBytePtr(secondData))
        try #require(before.width == after.width && before.height == after.height)
        try #require(before.bitsPerPixel == after.bitsPerPixel && before.bitsPerPixel == 32)
        /// Compare lower visible replies: at the top, the upper half includes the changing page boundary.
        func difference(_ shift: Int) -> Int {
          var total = 0
          for row in stride(from: before.height / 2, to: before.height * 2 / 3, by: 3) {
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
        let shift = try #require((-100 ... 100).min { difference($0) < difference($1) })
        try #require(difference(shift) < difference(shift + 20), "The fixture must render identifiable text.")
        return shift
      }

      private func fixture(fails: Bool) async throws -> (WorkspaceState, URLSession) {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [ThreadPageProtocol.self]
        let session = URLSession(configuration: configuration)
        let client = try Client.connecting(to: #require(URL(string: "https://thread-fixture.invalid/v1")), session: session)
        let state = WorkspaceState(clientProvider: { _ in client })
        state.timeline.reset(roomId: "room")
        state.timeline.failInitialLoad(message: "", generation: state.timeline.generation)
        let parent = message(0, parent: nil)
        state.timeline.messages = [parent]
        state.thread.open(parent)
        let initial = try page((30 ..< 60).map { message($0, parent: parent.id) }, cursor: "older")
        let older = try page((1 ..< 30).map { message($0, parent: parent.id) }, cursor: nil)
        ThreadPageProtocol.responses.withLock { $0 = [initial, older] }
        ThreadPageProtocol.requests.withLock { $0 = 0 }
        ThreadPageProtocol.fails.withLock { $0 = fails }
        _ = try await state.thread.timeline.loadPage(.initial, client: client, organizationSlug: nil, generation: state.thread.timeline.generation)
        return (state, session)
      }

      private func sendScroll(_ scroll: NSScrollView, delta: Int32, phase: Int64) throws {
        let event = try #require(CGEvent(scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 1, wheel1: delta, wheel2: 0, wheel3: 0))
        event.setIntegerValueField(.scrollWheelEventScrollPhase, value: phase)
        try scroll.scrollWheel(with: #require(NSEvent(cgEvent: event)))
      }

      private func message(_ index: Int, parent: String?) -> Components.Schemas.ChatRoomMessage {
        var message = chatRoomMessage(from: .init(clientTurnId: "reply-\(index)", roomId: "room", parentMessageId: parent,
                                                  content: "Reply \(index)\n" + String(repeating: "\(index) ", count: 12),
                                                  sender: .init(id: "user-\(index % 2)", name: "Example", email: "example@example.com", presence: .online)))
        message.id = "reply-\(index)"
        message.threadReplyCount = parent == nil ? 59 : 0
        message.createdAt = Date(timeIntervalSince1970: 1_700_000_000 + Double(index))
        return message
      }

      private func page(_ messages: [Components.Schemas.ChatRoomMessage], cursor: String?) throws -> Data {
        let encoder = JSONEncoder()
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "yyyy-MM-dd'T'HH:mm:ss.SSSXXXXX"
        encoder.dateEncodingStrategy = .formatted(formatter)
        return try JSONSerialization.data(withJSONObject: [
          "data": JSONSerialization.jsonObject(with: encoder.encode(messages)),
          "meta": ["timestamp": "2026-09-14T00:00:00.000Z", "requestId": "fixture",
                   "pagination": ["cursor": NSNull(), "limit": 30, "total": messages.count, "nextCursor": cursor as Any? ?? NSNull()]]
        ])
      }
    }
  }

  private final nonisolated class ThreadPageProtocol: URLProtocol, @unchecked Sendable {
    static let responses = Mutex<[Data]>([])
    static let requests = Mutex(0)
    static let fails = Mutex(false)
    static let pendingResponse = Mutex<(@Sendable () -> Void)?>(nil)
    private let cancelled = Mutex(false)
    override static func canInit(with request: URLRequest) -> Bool {
      request.url?.host == "thread-fixture.invalid"
    }

    override static func canonicalRequest(for request: URLRequest) -> URLRequest {
      request
    }

    override func startLoading() {
      // The thread view reads its mute (row 24b); only reply pages are counted and scripted here.
      guard request.url?.path.hasSuffix("/messages") == true else {
        if let url = request.url, let response = HTTPURLResponse(url: url, statusCode: 404, httpVersion: nil, headerFields: nil) {
          client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
          client?.urlProtocolDidFinishLoading(self)
        }
        return
      }
      let number = Self.requests.withLock { $0 += 1
        return $0
      }
      let data = Self.responses.withLock { $0.isEmpty ? Data() : $0.removeFirst() }
      guard let url = request.url, let response = HTTPURLResponse(url: url, statusCode: number > 1 && Self.fails.withLock { $0 } ? 500 : 200, httpVersion: nil,
                                                                  headerFields: ["Content-Type": "application/json"]) else { return }
      let complete: @Sendable () -> Void = { [self] in
        guard !cancelled.withLock({ $0 }) else { return }
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: data)
        client?.urlProtocolDidFinishLoading(self)
      }
      if number == 1 {
        complete()
      } else {
        Self.pendingResponse.withLock { $0 = complete }
      }
    }

    override func stopLoading() {
      cancelled.withLock { $0 = true }
    }
  }
#endif
