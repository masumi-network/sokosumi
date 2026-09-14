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
  @MainActor struct TranscriptContentGrowthTests {
    @Test(arguments: ["bottom", "visible", "active"])
    func growingMessagePreservesReadingPosition(position: String) async throws {
      let readingHistory = position != "bottom"
      let state = fixtureState()
      let host = NSHostingView(rootView: RoomTimelineView(roomId: "growth")
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
      if readingHistory {
        for index in 0 ..< 10 {
          let event = try #require(CGEvent(scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 1, wheel1: 60, wheel2: 0, wheel3: 0))
          event.setIntegerValueField(.scrollWheelEventScrollPhase, value: index == 0 ? 1 : 2)
          try scroll.scrollWheel(with: #require(NSEvent(cgEvent: event)))
          try await Task.sleep(for: .milliseconds(16))
        }
        if position != "active" {
          let end = try #require(CGEvent(scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 1, wheel1: 0, wheel2: 0, wheel3: 0))
          end.setIntegerValueField(.scrollWheelEventScrollPhase, value: 4)
          try scroll.scrollWheel(with: #require(NSEvent(cgEvent: end)))
        }
      }
      try await Task.sleep(for: .milliseconds(300))
      let offset = scroll.contentView.bounds.minY
      let originalHeight = try #require(scroll.documentView?.frame.height)
      let index = readingHistory ? 40 : 49
      state.timeline.messages[index].content += String(repeating: "\nMore loaded content", count: 10)
      try await Task.sleep(for: .milliseconds(500))
      host.layoutSubtreeIfNeeded()
      let newHeight = try #require(scroll.documentView?.frame.height)
      #expect(newHeight > originalHeight + 100)
      if readingHistory {
        #expect(abs(scroll.contentView.bounds.minY - offset) <= 1)
      } else {
        let height = try #require(scroll.documentView?.frame.height)
        #expect(abs(height - (scroll.contentView.bounds.maxY - scroll.contentInsets.bottom)) <= 1)
      }
    }

    private func fixtureState() -> WorkspaceState {
      let state = WorkspaceState()
      state.timeline.reset(roomId: "growth")
      state.timeline.failInitialLoad(message: "", generation: state.timeline.generation)
      state.timeline.messages = (0 ..< 50).map { index in
        var message = chatRoomMessage(from: .init(clientTurnId: "growth-\(index)", roomId: "growth", content: "Message \(index)", sender: .init(id: "user-\(index % 2)", name: "Example", email: "example@example.com", presence: .online)))
        message.id = "growth-\(index)"
        return message
      }
      return state
    }
  }
#endif
