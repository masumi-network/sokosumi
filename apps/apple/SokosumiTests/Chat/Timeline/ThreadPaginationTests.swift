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
    @MainActor struct ThreadPaginationTests {
      @Test func scrollingToOlderRepliesLoadsOnePage() async throws {
        let (state, session) = try await fixture()
        defer {
          TranscriptPageProtocol.pendingResponse.withLock { $0 = nil }
          session.invalidateAndCancel()
        }
        let host = NSHostingView(rootView: ReplyThreadView().environmentObject(state).environmentObject(AuthState()))
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 900, height: 700), styleMask: [.titled], backing: .buffered, defer: false)
        window.ignoresMouseEvents = true
        window.contentView = host
        window.orderFront(nil)
        defer { window.orderOut(nil) }
        let scroll = try await loadedTranscriptScrollView(in: host)
        #expect(TranscriptPageProtocol.requests.withLock { $0 } == 1, "Initial layout must not drain older pages.")
        try await scrollToBoundary(scroll)
        host.layoutSubtreeIfNeeded()
        let before = try TranscriptReadingPosition.snapshot(host)
        try #require(state.thread.timeline.messages.count == 30)
        try TranscriptPageProtocol.releaseHeldPage()
        for _ in 0 ..< 100 {
          if state.thread.timeline.messages.count == 59 {
            break
          }
          try await Task.sleep(for: .milliseconds(20))
        }
        #expect(TranscriptPageProtocol.requests.withLock { $0 } == 2)
        #expect(state.thread.timeline.messages.count == 59)
        #expect(!state.thread.timeline.hasMore)
        try await Task.sleep(for: .milliseconds(300))
        host.layoutSubtreeIfNeeded()
        try await TranscriptReadingPosition.expectStable(host, before: before)
      }

      @Test func searchTargetScrollsToAnOlderPreparedReply() async throws {
        let (state, session) = try await fixture()
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

      private func scrollToBoundary(_ scroll: NSScrollView) async throws {
        for index in 0 ..< 80 {
          try sendScroll(scroll, delta: 80, phase: index == 0 ? 1 : 2)
          try await Task.sleep(for: .milliseconds(20))
          if TranscriptPageProtocol.requests.withLock({ $0 }) > 1 {
            break
          }
        }
        try sendScroll(scroll, delta: 0, phase: 4)
        // Settle elastic scrolling before measuring the pending page insertion.
        try await Task.sleep(for: .milliseconds(300))
      }

      private func fixture() async throws -> (WorkspaceState, URLSession) {
        let session = TranscriptPageProtocol.session()
        let client = try Client.connecting(to: #require(URL(string: "https://\(TranscriptPageProtocol.host)/v1")), session: session)
        let state = WorkspaceState(clientProvider: { _ in client })
        state.timeline.reset(roomId: "room")
        state.timeline.failInitialLoad(message: "", generation: state.timeline.generation)
        let parent = message(0, parent: nil)
        state.timeline.messages = [parent]
        state.thread.open(parent)
        // The thread view also reads its mute (row 24b); only reply pages are counted and scripted.
        try TranscriptPageProtocol.serve([
          TranscriptPageProtocol.page((30 ..< 60).map { message($0, parent: parent.id) }, cursor: "older"),
          TranscriptPageProtocol.page((1 ..< 30).map { message($0, parent: parent.id) }, cursor: nil)
        ])
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
                                                  createdAt: Date(),
                                                  sender: .init(id: "user-\(index % 2)", name: "Example", email: "example@example.com", presence: .online)))
        message.id = "reply-\(index)"
        message.threadReplyCount = parent == nil ? 59 : 0
        message.createdAt = Date(timeIntervalSince1970: 1_700_000_000 + Double(index))
        return message
      }
    }
  }
#endif
