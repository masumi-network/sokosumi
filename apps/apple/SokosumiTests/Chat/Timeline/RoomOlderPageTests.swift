#if os(macOS)
  import AppKit
  import CoreAPI
  @testable import Sokosumi
  import SokosumiAuth
  import SokosumiChat
  import SokosumiWorkspace
  import SwiftUI
  import Testing

  extension NativeWindowTests {
    /// M6: inserting rows above the realized ones makes the lazy list measure every realized row again, a dropped frame
    /// in mid-flick. An older page's rows wait for the reader's scroll to rest, then land above the rows on screen
    /// without moving them (row 04).
    @MainActor struct RoomOlderPageTests {
      /// The reader rests at the top when the page arrives: it lands at once and the rows on screen stay put.
      @Test func anOlderPageKeepsTheReadingPosition() async throws {
        let (state, session) = try await fixture()
        defer {
          TranscriptPageProtocol.pendingResponse.withLock { $0 = nil }
          session.invalidateAndCancel()
        }
        let (window, host) = makeWindow(state)
        defer { window.orderOut(nil) }
        let scroll = try await loadedTranscriptScrollView(in: host)
        #expect(TranscriptPageProtocol.requests.withLock { $0 } == 1, "Initial layout must not drain older pages.")
        try await scrollUntilTheOlderPageIsAsked(scroll, pastTheTop: true)
        try sendTranscriptScroll(scroll, delta: 0, phase: 4)
        // Settle elastic scrolling before measuring the pending page insertion.
        try await Task.sleep(for: .milliseconds(300))
        host.layoutSubtreeIfNeeded()
        let before = try TranscriptReadingPosition.snapshot(host)
        let height = documentHeight(scroll)
        let beforeOffset = scroll.contentView.bounds.minY
        try TranscriptPageProtocol.releaseHeldPage()
        _ = try await waitForView(in: host, timeoutMessage: "The older page's rows did not land: document \(documentHeight(scroll)) pt, was \(height) pt") {
          documentHeight(scroll) > height + 500 ? scroll : nil
        }
        try await Task.sleep(for: .milliseconds(300))
        host.layoutSubtreeIfNeeded()
        Attachment.record("before: offset \(beforeOffset) pt of \(height) pt; after: offset \(scroll.contentView.bounds.minY) pt of \(documentHeight(scroll)) pt",
                          named: "landed-page-offsets.txt")
        try await TranscriptReadingPosition.expectStable(host, before: before)
      }

      /// The page arrives while the reader still drives the scroll: its rows wait, no further page is asked for while
      /// they do, and they land once the scroll ends.
      @Test func anOlderPageWaitsForTheScrollToRest() async throws {
        let (state, session) = try await fixture()
        defer {
          TranscriptPageProtocol.pendingResponse.withLock { $0 = nil }
          session.invalidateAndCancel()
        }
        let (window, host) = makeWindow(state)
        defer { window.orderOut(nil) }
        let scroll = try await loadedTranscriptScrollView(in: host)
        try await scrollUntilTheOlderPageIsAsked(scroll)
        let height = documentHeight(scroll)
        try TranscriptPageProtocol.releaseHeldPage()
        // Fingers still on the trackpad, rocking a little at the top. (A gesture of zero deltas reads as idle.)
        for index in 0 ..< 30 {
          try sendTranscriptScroll(scroll, delta: index.isMultiple(of: 2) ? 3 : -3, phase: 2)
          host.layoutSubtreeIfNeeded()
          try await Task.sleep(for: .milliseconds(20))
        }
        try #require(state.timeline.messages.count == 60, "The page merged into the timeline.")
        #expect(abs(documentHeight(scroll) - height) < 100,
                "The page's rows wait while the reader scrolls: document \(documentHeight(scroll)) pt, was \(height) pt.")
        #expect(TranscriptPageProtocol.requests.withLock { $0 } == 2, "No further page is asked for while one waits.")
        // A visible message keeps receiving chunks even though the older prefix waits.
        let streamingIndex = try #require(state.timeline.messages.firstIndex { $0.id == "message-40" })
        state.timeline.messages[streamingIndex].content = "**Streaming while paging**"
        var streamed = false
        for index in 0 ..< 30 {
          try sendTranscriptScroll(scroll, delta: index.isMultiple(of: 2) ? 3 : -3, phase: 2)
          host.layoutSubtreeIfNeeded()
          try await Task.sleep(for: .milliseconds(20))
          if await hostedTexts(in: host).contains(where: { $0.contains("Streaming while paging") }) {
            streamed = true
            break
          }
        }
        #expect(streamed, "Visible Markdown updates while the older page stays deferred.")
        #expect(abs(documentHeight(scroll) - height) < 100, "Streaming must not release the older prefix.")
        let before = try TranscriptReadingPosition.snapshot(host)
        let beforeOffset = scroll.contentView.bounds.minY
        try sendTranscriptScroll(scroll, delta: 0, phase: 4)
        _ = try await waitForView(in: host, timeoutMessage: "The waiting rows did not land once the scroll ended: document \(documentHeight(scroll)) pt, was \(height) pt") {
          documentHeight(scroll) > height + 500 ? scroll : nil
        }
        try await Task.sleep(for: .milliseconds(300))
        host.layoutSubtreeIfNeeded()
        Attachment.record("before: offset \(beforeOffset) pt of \(height) pt; after: offset \(scroll.contentView.bounds.minY) pt of \(documentHeight(scroll)) pt",
                          named: "held-page-offsets.txt")
        try await TranscriptReadingPosition.expectStable(host, before: before)
      }

      private func makeWindow(_ state: WorkspaceState) -> (NSWindow, NSView) {
        let host = NSHostingView(rootView: RoomTimelineView(roomId: "room").environmentObject(state).environmentObject(AuthState()))
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 900, height: 700), styleMask: [.titled], backing: .buffered, defer: false)
        window.ignoresMouseEvents = true
        window.contentView = host
        window.orderFront(nil)
        return (window, host)
      }

      private func documentHeight(_ scroll: NSScrollView) -> CGFloat {
        scroll.documentView?.frame.height ?? 0
      }

      /// Wheels up, in a gesture that has not ended, until the room asks for its older page; with `pastTheTop`, on
      /// against the top edge, where a reader who flicks up rests (and where the CI runner's reader stopped).
      private func scrollUntilTheOlderPageIsAsked(_ scroll: NSScrollView, pastTheTop: Bool = false) async throws {
        for index in 0 ..< 80 {
          try sendTranscriptScroll(scroll, delta: 80, phase: index == 0 ? 1 : 2)
          try await Task.sleep(for: .milliseconds(20))
          if TranscriptPageProtocol.requests.withLock({ $0 }) > 1 {
            for _ in 0 ..< (pastTheTop ? 3 : 0) {
              try sendTranscriptScroll(scroll, delta: 80, phase: 2)
              try await Task.sleep(for: .milliseconds(20))
            }
            return
          }
        }
        Issue.record("The room never asked for its older page.")
      }

      /// Room `room`: the latest page (rows 40–69) is loaded; Core holds two older pages, 10–39 and 0–9.
      private func fixture() async throws -> (WorkspaceState, URLSession) {
        let session = TranscriptPageProtocol.session()
        let client = try Client.connecting(to: #require(URL(string: "https://\(TranscriptPageProtocol.host)/v1")), session: session)
        let state = WorkspaceState(clientProvider: { _ in client })
        try TranscriptPageProtocol.serve([
          TranscriptPageProtocol.page((40 ..< 70).map(message), cursor: "c40"),
          TranscriptPageProtocol.page((10 ..< 40).map(message), cursor: "c10"),
          TranscriptPageProtocol.page((0 ..< 10).map(message), cursor: nil)
        ])
        state.timeline.reset(roomId: "room")
        _ = try await state.timeline.loadPage(.initial, client: client, organizationSlug: nil, generation: state.timeline.generation)
        try #require(state.timeline.messages.count == 30 && state.transcriptHasMore)
        return (state, session)
      }

      private func message(_ index: Int) -> Components.Schemas.ChatRoomMessage {
        var message = chatRoomMessage(from: .init(clientTurnId: "message-\(index)", roomId: "room",
                                                  content: "Message \(index)\n" + String(repeating: "\(index) ", count: 12),
                                                  createdAt: Date(),
                                                  sender: .init(id: "user-\(index % 2)", name: "Example", email: "example@example.com", presence: .online)))
        message.id = "message-\(index)"
        message.createdAt = Date(timeIntervalSince1970: 1_700_000_000 + Double(index))
        return message
      }
    }
  }
#endif
