#if os(macOS)
  import AppKit
  import CoreAPI
  @testable import Sokosumi
  import SokosumiAuth
  import SokosumiChat
  import SokosumiWorkspace
  import SwiftUI
  import Testing

  @MainActor struct TranscriptScrollingTests {
    @Test(arguments: [false, true])
    func richHistoryStartsAtBottomAndScrollsUp(thread: Bool) async throws {
      let state = WorkspaceState()
      state.timeline.reset(roomId: "fixture")
      state.timeline.failInitialLoad(message: "", generation: state.timeline.generation)
      state.timeline.messages = (0 ..< 100).map { index in
        var message = chatRoomMessage(from: .init(clientTurnId: "fixture-\(index)", roomId: "fixture", content: "Message \(index): " + String(repeating: "A paragraph with **bold text**, a [link](https://example.com), and inline `code`.\n\n", count: 8), sender: .init(id: "fixture-\(index % 2)", name: "Example", email: "example@example.com", presence: .online)))
        message.id = "fixture-\(index)"
        return message
      }
      if thread {
        let parent = try #require(state.timeline.messages.first)
        state.thread.open(parent)
        state.thread.timeline.failInitialLoad(message: "", generation: state.thread.timeline.generation)
        state.thread.timeline.messages = state.timeline.messages.dropFirst().map { message in
          var reply = message
          reply.parentMessageId = parent.id
          return reply
        }
      }
      let host = NSHostingView(rootView: Group {
        if thread {
          ReplyThreadView()
        } else {
          RoomTimelineView(roomId: "fixture")
        }
      }.environmentObject(state).environmentObject(AuthState()))
      let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 900, height: 700), styleMask: [.titled], backing: .buffered, defer: false)
      window.contentView = host
      window.orderFront(nil)
      defer { window.orderOut(nil) }
      try await Task.sleep(for: .milliseconds(500))
      func scrollViews(_ view: NSView) -> [NSScrollView] {
        (view as? NSScrollView).map { [$0] } ?? view.subviews.flatMap(scrollViews)
      }
      let scroll = try #require(scrollViews(host).max(by: { $0.frame.height < $1.frame.height }))
      let initialOffset = scroll.contentView.bounds.minY
      let contentHeight = try #require(scroll.documentView?.frame.height)
      #expect(abs(contentHeight - scroll.contentView.bounds.maxY) <= 1)
      #expect(initialOffset > 600)
      for index in 0 ..< 30 {
        let scrollEvent = try #require(CGEvent(scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 1, wheel1: 20, wheel2: 0, wheel3: 0))
        scrollEvent.setIntegerValueField(.scrollWheelEventScrollPhase, value: index == 0 ? 1 : 2)
        let event = try #require(NSEvent(cgEvent: scrollEvent))
        scroll.scrollWheel(with: event)
        host.layoutSubtreeIfNeeded()
        try await Task.sleep(for: .milliseconds(16))
      }
      #expect(scroll.contentView.bounds.minY < initialOffset - 400)
    }
  }
#endif
