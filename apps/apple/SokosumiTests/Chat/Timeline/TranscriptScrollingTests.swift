#if os(macOS)
  import AppKit
  import CoreAPI
  @testable import Sokosumi
  import SokosumiAuth
  import SokosumiChat
  import SokosumiWorkspace
  import SwiftUI
  import Testing

  @Suite(.serialized)
  @MainActor struct TranscriptScrollingTests {
    @Test(arguments: [false, true], [false, true])
    func richHistoryStartsAtBottomAndScrollsUp(thread: Bool, media: Bool) async throws {
      URLProtocol.registerClass(ScrollMediaProtocol.self)
      defer { URLProtocol.unregisterClass(ScrollMediaProtocol.self) }
      let completed = ScrollMediaProtocol.completedRequests
      let state = try fixtureState(thread: thread, media: media)
      var visibleIds: [String] = []
      let host = NSHostingView(rootView: Group {
        if thread {
          ReplyThreadView()
        } else {
          RoomTimelineView(roomId: "fixture")
        }
      }.onScrollTargetVisibilityChange(idType: String.self, threshold: 0.1) { visibleIds = $0 }
        .environmentObject(state).environmentObject(AuthState()))
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
      #expect(scroll.contentInsets.bottom > 0)
      #expect(abs(contentHeight - (scroll.contentView.bounds.maxY - scroll.contentInsets.bottom)) <= 1)
      #expect(initialOffset > 600)
      try await measureScroll(scroll, host: host, thread: thread, media: media)
      if media {
        #expect(ScrollMediaProtocol.completedRequests > completed)
      }
      if thread {
        #expect(scroll.contentView.bounds.minY < initialOffset - 400)
      } else {
        // Lazy row estimates change the document origin. Compare what the
        // reader sees rather than offsets from two different layouts.
        let after = try #require(visibleIds.compactMap { Int($0.dropFirst("fixture-".count)) }.max())
        #expect(after < state.timeline.messages.count - 2)
      }
    }

    private func fixtureState(thread: Bool, media: Bool) throws -> WorkspaceState {
      let state = WorkspaceState()
      state.timeline.reset(roomId: "fixture")
      state.timeline.failInitialLoad(message: "", generation: state.timeline.generation)
      state.timeline.messages = fixtureMessages(media: media)
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
      return state
    }

    private func fixtureMessages(media: Bool) -> [Components.Schemas.ChatRoomMessage] {
      let fixtureId = UUID().uuidString
      return (0 ..< 100).map { index in
        var message = chatRoomMessage(from: .init(clientTurnId: "fixture-\(index)", roomId: "fixture", content: "Message \(index): " + String(repeating: "A paragraph with **bold text**, a [link](https://example.com), and inline `code`.\n\n", count: media ? 2 : 8), sender: .init(id: "fixture-\(index % 2)", name: "Example", email: "example@example.com", presence: .online)))
        message.id = "fixture-\(index)"
        if media {
          let url = "https://scroll-fixture.invalid/\(fixtureId)-image-\(index).png"
          if index.isMultiple(of: 2) {
            message.content += "\n\n![Fixture](\(url))"
          } else {
            message.unfurls = [.init(url: "https://example.com/article", title: "Fixture preview", description: "Delayed media", imageUrl: url)]
          }
        }
        return message
      }
    }

    private func measureScroll(_ scroll: NSScrollView, host: NSView, thread: Bool, media: Bool) async throws {
      let clock = ContinuousClock()
      var layoutDurations: [Duration] = []
      var stepDurations: [Duration] = []
      for index in 0 ..< 120 {
        let start = clock.now
        let scrollEvent = try #require(CGEvent(scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 1, wheel1: 60, wheel2: 0, wheel3: 0))
        scrollEvent.setIntegerValueField(.scrollWheelEventScrollPhase, value: index == 0 ? 1 : 2)
        let event = try #require(NSEvent(cgEvent: scrollEvent))
        scroll.scrollWheel(with: event)
        host.layoutSubtreeIfNeeded()
        layoutDurations.append(start.duration(to: clock.now))
        try await Task.sleep(for: .milliseconds(16))
        stepDurations.append(start.duration(to: clock.now))
      }
      // Host event/layout and scheduling costs, not display frame times.
      let layout = layoutDurations.sorted()
      let steps = stepDurations.sorted()
      let p95 = (steps.count - 1) * 95 / 100
      let last = steps.count - 1
      let report = "SCROLL_BASELINE media=\(media) thread=\(thread) layout_p95=\(layout[p95]) layout_max=\(layout[last]) step_p95=\(steps[p95]) step_max=\(steps[last])"
      let output = FileManager.default.temporaryDirectory.appendingPathComponent("scroll-baseline-\(media)-\(thread)-\(ProcessInfo.processInfo.processIdentifier).txt")
      try report.write(to: output, atomically: true, encoding: .utf8)
    }
  }
#endif
