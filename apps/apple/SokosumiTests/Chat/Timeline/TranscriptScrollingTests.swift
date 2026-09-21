#if os(macOS)
  import AppKit
  import CoreAPI
  @testable import Sokosumi
  import SokosumiAuth
  import SokosumiChat
  import SokosumiWorkspace
  import SwiftUI
  import Testing
  import Vision

  extension NativeWindowTests {
    @MainActor struct TranscriptScrollingTests {
      @Test(arguments: [false, true], [false, true])
      func richHistoryStartsAtBottomAndScrollsUp(thread: Bool, media: Bool) async throws {
        URLProtocol.registerClass(ScrollMediaProtocol.self)
        defer { URLProtocol.unregisterClass(ScrollMediaProtocol.self) }
        let completed = ScrollMediaProtocol.completedRequests
        let state = try fixtureState(thread: thread, media: media)
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
        let scroll = try await loadedTranscriptScrollView(in: host)
        let initialOffset = scroll.contentView.bounds.minY
        #expect(scroll.contentInsets.bottom > 0)
        #expect(abs(distanceFromBottom(scroll)) <= 1)
        #expect(initialOffset > 600)
        try await measureScroll(scroll, host: host, thread: thread, media: media)
        if media {
          #expect(ScrollMediaProtocol.completedRequests > completed)
        }
        // Lazy row estimates rewrite document height, so absolute minY can
        // grow while the reader moves up (CI: 18186 vs initial-400 of 7957).
        // Keep the 400pt bar as distance from the bottom edge.
        #expect(distanceFromBottom(scroll) > 400)
      }

      @Test(arguments: [false, true], [false, true])
      func messageLinkWaitsForPreparedTranscript(thread: Bool, dark: Bool) async throws {
        let state = try fixtureState(thread: thread, media: false)
        let auth = AuthState()
        if thread {
          state.thread.requestJump(to: "fixture-2")
          #expect(state.thread.jumpTarget?.messageId == "fixture-2")
        } else {
          #expect(try await state.openMessage("fixture-2", auth: auth) == .opened)
        }
        let host = NSHostingView(rootView: Group {
          if thread {
            ReplyThreadView()
          } else {
            RoomTimelineView(roomId: "fixture")
          }
        }.background(.background).environmentObject(state).environmentObject(auth).environment(\.colorScheme, dark ? .dark : .light))
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 900, height: 700), styleMask: [.titled], backing: .buffered, defer: false)
        window.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
        window.contentView = host
        window.orderFront(nil)
        defer { window.orderOut(nil) }
        let scroll = try await loadedTranscriptScrollView(in: host)
        for _ in 0 ..< 30 {
          host.layoutSubtreeIfNeeded()
          try await Task.sleep(for: .milliseconds(20))
        }
        if thread {
          #expect(state.thread.jumpTarget?.messageId == "fixture-2")
        } else {
          #expect(state.messageJump == nil)
        }
        #expect(distanceFromBottom(scroll) > 400)
        let bitmap = try #require(host.bitmapImageRepForCachingDisplay(in: host.bounds))
        host.cacheDisplay(in: host.bounds, to: bitmap)
        // Vision text recognition throws on the virtualized CI runner, so there the row-visibility
        // check falls back to the scroll-offset assertion above; locally the OCR check runs.
        if let visibleText = try recognizedLines(in: bitmap) {
          #expect(visibleText.contains { $0.hasPrefix("Message 2:") })
          #expect(!visibleText.contains { $0.hasPrefix("Message 98:") })
        }
        let png = try #require(bitmap.representation(using: .png, properties: [:]))
        try png.write(to: FileManager.default.temporaryDirectory.appendingPathComponent("message-link-navigation-\(thread)-\(dark).png"))
      }

      /// The text Vision reads in the render, or nil where Vision cannot run at all. A missing image is a
      /// failure, not nil. `.fast` is the CPU path, tried once when `.accurate` throws.
      private func recognizedLines(in bitmap: NSBitmapImageRep) throws -> [String]? {
        let image = try #require(bitmap.cgImage)
        for level in [VNRequestTextRecognitionLevel.accurate, .fast] {
          let request = VNRecognizeTextRequest()
          request.recognitionLevel = level
          request.recognitionLanguages = ["en-US"]
          request.usesLanguageCorrection = false
          do {
            try VNImageRequestHandler(cgImage: image).perform([request])
            note("OCR ran (\(level == .accurate ? "accurate" : "fast"))")
            return (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }
          } catch {
            note("OCR unavailable (\(level == .accurate ? "accurate" : "fast")): \(error)")
          }
        }
        return nil
      }

      /// Says which OCR path ran: on stdout, and as an attachment in the result bundle.
      private func note(_ line: String) {
        print(line)
        Attachment.record(line, named: "message-link-ocr-path.txt")
      }

      private func distanceFromBottom(_ scroll: NSScrollView) -> CGFloat {
        let height = scroll.documentView?.frame.height ?? 0
        return height - (scroll.contentView.bounds.maxY - scroll.contentInsets.bottom)
      }

      private func fixtureState(thread: Bool, media: Bool) throws -> WorkspaceState {
        let state = WorkspaceState(clientProvider: { _ in Client.connecting(to: URL(string: "https://example.com")!) })
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
  }
#endif
