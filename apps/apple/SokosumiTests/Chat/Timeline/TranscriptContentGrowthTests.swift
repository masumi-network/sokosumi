#if os(macOS)
  import AppKit
  import CoreAPI
  @testable import Sokosumi
  import SokosumiAuth
  import SokosumiChat
  import SokosumiWorkspace
  import SwiftUI
  import Testing

  private enum TranscriptGrowthPosition {
    case pinned
    case scrolledUp
    case activeScroll
  }

  extension NativeWindowTests {
    @MainActor struct TranscriptContentGrowthTests {
      /// Content already filling the viewport stays pinned to the newest edge when it grows.
      @Test func growingNewestMessageWhilePinnedStaysAtBottom() async throws {
        try await assertGrowth(position: .pinned, thread: false, lines: 10)
      }

      /// Growing a message above the fold must not yank the reader to the newest edge.
      @Test func appendingWhileScrolledUpDoesNotJump() async throws {
        try await assertGrowth(position: .scrolledUp, thread: false, lines: 10)
      }

      /// Same claim while a scroll gesture is still active (no phase-ended event).
      @Test func appendingDuringActiveScrollDoesNotJump() async throws {
        try await assertGrowth(position: .activeScroll, thread: false, lines: 10)
      }

      /// A taller growth still pins when the reader is at the bottom.
      @Test func tallNewestMessageGrowthStaysPinned() async throws {
        try await assertGrowth(position: .pinned, thread: false, lines: 20)
      }

      /// Reply-thread timeline is a distinct document; growth there must pin independently of the room.
      @Test func threadReplyGrowthStaysPinned() async throws {
        try await assertGrowth(position: .pinned, thread: true, lines: 10)
      }

      private func assertGrowth(position: TranscriptGrowthPosition, thread: Bool, lines: Int) async throws {
        let readingHistory = position == .scrolledUp || position == .activeScroll
        let state = fixtureState(thread: thread)
        let host = NSHostingView(rootView: Group {
          if thread {
            ReplyThreadView()
          } else {
            RoomTimelineView(roomId: "growth")
          }
        }.environmentObject(state).environmentObject(AuthState()))
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 900, height: 700), styleMask: [.titled], backing: .buffered, defer: false)
        window.contentView = host
        window.orderFront(nil)
        defer { window.orderOut(nil) }
        let scroll = try await loadedTranscriptScrollView(in: host)
        if readingHistory {
          for index in 0 ..< 10 {
            let event = try #require(CGEvent(scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 1, wheel1: 60, wheel2: 0, wheel3: 0))
            event.setIntegerValueField(.scrollWheelEventScrollPhase, value: index == 0 ? 1 : 2)
            try scroll.scrollWheel(with: #require(NSEvent(cgEvent: event)))
            try await Task.sleep(for: .milliseconds(16))
          }
          if position != .activeScroll {
            let end = try #require(CGEvent(scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 1, wheel1: 0, wheel2: 0, wheel3: 0))
            end.setIntegerValueField(.scrollWheelEventScrollPhase, value: 4)
            try scroll.scrollWheel(with: #require(NSEvent(cgEvent: end)))
          }
        }
        try await Task.sleep(for: .milliseconds(300))
        let offset = scroll.contentView.bounds.minY
        let originalHeight = try #require(scroll.documentView?.frame.height)
        let index = readingHistory ? 40 : 49
        if thread {
          state.thread.timeline.messages[index].content += String(repeating: "\nMore loaded content", count: lines)
        } else {
          state.timeline.messages[index].content += String(repeating: "\nMore loaded content", count: lines)
        }
        // Drive layout before yielding so deferred scroll corrections run before assertions.
        for _ in 0 ..< 25 {
          host.layoutSubtreeIfNeeded()
          try await Task.sleep(for: .milliseconds(20))
        }
        let newHeight = try #require(scroll.documentView?.frame.height)
        #expect(newHeight > originalHeight + (lines == 10 ? 100 : 200))
        if readingHistory {
          #expect(abs(scroll.contentView.bounds.minY - offset) <= 1)
        } else {
          let height = try #require(scroll.documentView?.frame.height)
          #expect(abs(height - (scroll.contentView.bounds.maxY - scroll.contentInsets.bottom)) <= 1)
        }
      }

      private func fixtureState(thread: Bool) -> WorkspaceState {
        let state = WorkspaceState()
        state.timeline.reset(roomId: "growth")
        state.timeline.failInitialLoad(message: "", generation: state.timeline.generation)
        state.timeline.messages = (0 ..< 50).map { index in
          var message = chatRoomMessage(from: .init(clientTurnId: "growth-\(index)", roomId: "growth", content: "Message \(index)", sender: .init(id: "user-\(index % 2)", name: "Example", email: "example@example.com", presence: .online)))
          message.id = "growth-\(index)"
          return message
        }
        if thread, let parent = state.timeline.messages.first {
          state.thread.open(parent)
          state.thread.timeline.failInitialLoad(message: "", generation: state.thread.timeline.generation)
          state.thread.timeline.messages = state.timeline.messages.map { message in
            var reply = message
            reply.id = "reply-\(message.id)"
            reply.parentMessageId = parent.id
            return reply
          }
        }
        return state
      }
    }
  }
#endif
