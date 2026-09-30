#if os(macOS)
  import AppKit
  import CoreAPI
  @testable import Sokosumi
  import SokosumiAuth
  import SokosumiChat
  import SokosumiWorkspace
  import SwiftUI
  import Testing

  /// A jump that has landed in a hosted transcript, and what the test drives it through.
  private struct JumpLanding {
    let state: WorkspaceState
    let host: NSHostingView<AnyView>
    let window: NSWindow
    let scroll: NSScrollView
  }

  extension NativeWindowTests {
    /// Row 25b1: the mark a jump leaves (web `room-message-highlight.ts` and the `--chat-jump-*` block in
    /// globals.css) holds for 4.5 s, and a reader scroll at full strength fades it out over 320 ms. The test host
    /// builds no accessibility tree, so the room's mark is read from pixels and the thread's from its jump target.
    @MainActor struct JumpMarkViewTests {
      /// The room transcript, or the thread holding fixture-2, with a jump to fixture-2 requested.
      private static func landing(thread: Bool) async throws -> JumpLanding {
        let state = try TranscriptScrollingTests.fixtureState(thread: thread, media: false)
        let auth = AuthState()
        if thread {
          state.thread.requestJump(to: "fixture-2")
        } else {
          #expect(try await state.openMessage("fixture-2", auth: auth) == .opened)
        }
        let host = NSHostingView(rootView: AnyView(Group {
          if thread {
            ReplyThreadView()
          } else {
            RoomTimelineView(roomId: "fixture")
          }
        }.background(.background).environmentObject(state).environmentObject(auth)))
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 900, height: 700), styleMask: [.titled], backing: .buffered, defer: false)
        window.appearance = NSAppearance(named: .aqua)
        // A pointer resting over the window would draw a row's hover wash, which the pixel reads count.
        window.ignoresMouseEvents = true
        window.contentView = host
        window.orderFront(nil)
        let scroll = try await loadedTranscriptScrollView(in: host)
        _ = try await waitForView(in: host, timeoutMessage: "The jump did not land: \(TranscriptScrollingTests.distanceFromBottom(scroll)) pt from the bottom") {
          TranscriptScrollingTests.distanceFromBottom(scroll) > 400 ? scroll : nil
        }
        return JumpLanding(state: state, host: host, window: window, scroll: scroll)
      }

      /// Rows of the transcript's viewport whose pixel `column` points in differs from the viewport's top row
      /// there. Left of the avatars the only thing drawn is the mark.
      private static func markedRows(in host: NSView, scroll: NSScrollView, column: CGFloat) throws -> Int {
        host.layoutSubtreeIfNeeded()
        let bitmap = try #require(host.bitmapImageRepForCachingDisplay(in: host.bounds))
        host.cacheDisplay(in: host.bounds, to: bitmap)
        let scale = CGFloat(bitmap.pixelsWide) / host.bounds.width
        var frame = scroll.convert(scroll.bounds, to: host)
        if !host.isFlipped {
          frame.origin.y = host.bounds.height - frame.maxY
        }
        let top = Int((frame.minY + 2) * scale), bottom = Int((frame.maxY - scroll.contentInsets.bottom - 2) * scale)
        let pixelX = Int(column * scale)
        let reference = try #require(bitmap.colorAt(x: pixelX, y: top)?.usingColorSpace(.deviceRGB))
        return (top ..< bottom).count { pixelY in
          guard let color = bitmap.colorAt(x: pixelX, y: pixelY)?.usingColorSpace(.deviceRGB) else { return false }
          return abs(color.redComponent - reference.redComponent) + abs(color.greenComponent - reference.greenComponent)
            + abs(color.blueComponent - reference.blueComponent) > 0.04
        }
      }

      private static func wheel(_ scroll: NSScrollView, host: NSView) throws {
        let event = try #require(CGEvent(scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 1, wheel1: 40, wheel2: 0, wheel3: 0))
        event.setIntegerValueField(.scrollWheelEventScrollPhase, value: 1)
        try scroll.scrollWheel(with: #require(NSEvent(cgEvent: event)))
        host.layoutSubtreeIfNeeded()
      }

      /// Polls until `done` holds or ten seconds pass; a loaded runner can hold the main actor for a while.
      private static func poll(_ host: NSView, until done: () throws -> Bool) async throws {
        let deadline = ContinuousClock.now.advanced(by: .seconds(10))
        while try !done(), ContinuousClock.now < deadline {
          host.layoutSubtreeIfNeeded()
          try await Task.sleep(for: .milliseconds(20))
        }
      }

      /// Web `landOn`'s timer: the mark is gone 4.5 s after the landing, with nobody touching the list.
      @Test func theRoomMarkEndsWhenItsHoldRunsOut() async throws {
        let landing = try await Self.landing(thread: false)
        let (host, window, scroll) = (landing.host, landing.window, landing.scroll)
        defer { window.orderOut(nil) }
        _ = try await waitForView(in: host, timeoutMessage: "The landed row was never marked") {
          (try? Self.markedRows(in: host, scroll: scroll, column: 6)).map { $0 > 40 } == true ? scroll : nil
        }
        let marked = ContinuousClock.now
        try await Task.sleep(until: marked.advanced(by: .seconds(1)))
        #expect(try Self.markedRows(in: host, scroll: scroll, column: 6) > 40, "Still marked a second in.")
        try await Self.poll(host) { try Self.markedRows(in: host, scroll: scroll, column: 6) == 0 }
        let gone = marked.duration(to: ContinuousClock.now)
        #expect(try Self.markedRows(in: host, scroll: scroll, column: 6) == 0, "The hold is over.")
        // The hold's own fade takes the wash under the pixel threshold shortly before 4.5 s.
        #expect(gone > .seconds(3), "Held until its closing fade: gone after \(gone).")
      }

      /// The thread's mark ends with its hold too, and takes the jump target with it.
      @Test func theThreadMarkEndsWhenItsHoldRunsOut() async throws {
        let requested = ContinuousClock.now
        let landing = try await Self.landing(thread: true)
        let (state, host, window) = (landing.state, landing.host, landing.window)
        defer { window.orderOut(nil) }
        try await Task.sleep(for: .seconds(1))
        #expect(state.thread.jumpTarget?.messageId == "fixture-2", "Still held a second in.")
        try await Self.poll(host) { state.thread.jumpTarget == nil }
        let gone = requested.duration(to: ContinuousClock.now)
        #expect(state.thread.jumpTarget == nil, "The hold is over.")
        #expect(gone >= .milliseconds(4500), "Held for the whole hold: gone after \(gone).")
      }

      /// Web `fadeOutHighlight`: a wheel over the list at full strength fades the mark over 320 ms rather than
      /// cutting it.
      @Test(arguments: [false, true])
      func aWheelAtFullStrengthFadesTheMarkOut(thread: Bool) async throws {
        let landing = try await Self.landing(thread: thread)
        let (state, host, window, scroll) = (landing.state, landing.host, landing.window, landing.scroll)
        defer { window.orderOut(nil) }
        if !thread {
          _ = try await waitForView(in: host, timeoutMessage: "The landed row was never marked") {
            (try? Self.markedRows(in: host, scroll: scroll, column: 6)).map { $0 > 40 } == true ? scroll : nil
          }
        }
        try await Task.sleep(for: .seconds(1))
        let wheeled = ContinuousClock.now
        try Self.wheel(scroll, host: host)
        if thread {
          try await Self.poll(host) { state.thread.jumpTarget?.mark?.leftAt != nil || state.thread.jumpTarget == nil }
          #expect(state.thread.jumpTarget?.mark?.leftAt != nil, "Fading, not cut.")
          try await Self.poll(host) { state.thread.jumpTarget == nil }
          #expect(state.thread.jumpTarget == nil, "The fade is over.")
        } else {
          try await Task.sleep(for: .milliseconds(40))
          let marked = try Self.markedRows(in: host, scroll: scroll, column: 6)
          // The fade draws from the clock, so a runner that held the main actor past it has nothing left to see.
          if wheeled.duration(to: ContinuousClock.now) < .milliseconds(200) {
            #expect(marked > 40, "Fading, not cut.")
          }
          try await Self.poll(host) { try Self.markedRows(in: host, scroll: scroll, column: 6) == 0 }
          #expect(try Self.markedRows(in: host, scroll: scroll, column: 6) == 0, "The fade is over.")
        }
        // Well inside the 4.5 s hold: the wheel ended it, not its timer.
        let gone = wheeled.duration(to: ContinuousClock.now)
        #expect(gone < .seconds(2), "Gone \(gone) after the wheel.")
      }

      /// Web keeps the mark when the scrollbar moves the list, which raises no wheel or touch event. Dragging the
      /// scroller's knob moves the thread and leaves its mark at full strength.
      @Test func aScrollerDragKeepsTheMark() async throws {
        let landing = try await Self.landing(thread: true)
        let (state, host, window, scroll) = (landing.state, landing.host, landing.window, landing.scroll)
        defer { window.orderOut(nil) }
        window.ignoresMouseEvents = false
        scroll.scrollerStyle = .legacy
        host.layoutSubtreeIfNeeded()
        let scroller = try #require(scroll.verticalScroller)
        try await Task.sleep(for: .seconds(1))
        let knob = scroller.rect(for: .knob)
        #expect(knob.height > 0, "The scroller shows a knob: \(knob)")
        let start = scroller.convert(NSPoint(x: knob.midX, y: knob.midY), to: nil)
        func mouse(_ type: NSEvent.EventType, down: CGFloat) throws -> NSEvent {
          try #require(NSEvent.mouseEvent(with: type, location: NSPoint(x: start.x, y: start.y - down), modifierFlags: [],
                                          timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: window.windowNumber,
                                          context: nil, eventNumber: 0, clickCount: 1, pressure: 1))
        }
        let before = scroll.contentView.bounds.minY
        // Through the app's queue, as a pointer's events arrive: the press reaches the scroller, and the knob's
        // tracking loop reads the rest.
        for (type, down) in [(NSEvent.EventType.leftMouseDown, 0.0), (.leftMouseDragged, 40), (.leftMouseDragged, 120), (.leftMouseUp, 120)] {
          try NSApp.postEvent(mouse(type, down: down), atStart: false)
        }
        for _ in 0 ..< 10 {
          host.layoutSubtreeIfNeeded()
          try await Task.sleep(for: .milliseconds(20))
        }
        #expect(scroll.contentView.bounds.minY - before > 50, "The drag moved the thread: \(before) to \(scroll.contentView.bounds.minY)")
        #expect(state.thread.jumpTarget?.messageId == "fixture-2")
        let mark = try #require(state.thread.jumpTarget?.mark)
        #expect(mark.leftAt == nil, "The mark stands.")
      }

      /// The mark in both lights, drawn by the real row at full strength over the window background.
      private static func render(dark: Bool) async throws -> NSBitmapImageRep {
        let messages = ["Ada", "Ben", "Grace"].enumerated().map { index, name in
          var message = chatRoomMessage(from: .init(
            clientTurnId: name, roomId: "room_1", content: "\(name) wrote a message the jump can land on, with a second sentence to wrap.",
            createdAt: Date(timeIntervalSince1970: 1_790_251_200 + Double(index) * 60),
            sender: .init(id: "user_\(name.lowercased())", name: name, email: "\(name.lowercased())@example.com", presence: .offline)
          ))
          message.id = name
          message.metadata = nil
          return message
        }
        let content = VStack(alignment: .leading, spacing: 0) {
          ForEach(messages, id: \.id) { message in
            MessageRowView(message: message, isContinuation: false, outbound: nil, onRetry: nil, onRemove: nil,
                           jumpMark: message.id == "Ben" ? JumpMark(messageId: "Ben", landedAt: Date().addingTimeInterval(-1)) : nil,
                           horizontalInset: 12)
          }
        }
        .padding(.vertical, 12)
        .frame(width: 520, alignment: .leading)
        .background(.background)
        .environmentObject(WorkspaceState()).environmentObject(AuthState())
        .environment(\.colorScheme, dark ? .dark : .light)
        let host = NSHostingView(rootView: content)
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 520, height: 300), styleMask: [.titled], backing: .buffered, defer: false)
        window.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
        window.contentView = host
        window.orderFront(nil)
        defer { window.orderOut(nil) }
        for _ in 0 ..< 10 {
          host.layoutSubtreeIfNeeded()
          try await Task.sleep(for: .milliseconds(20))
        }
        return try fittedBitmap(of: host, in: window)
      }

      /// Web's wash with the rail at the row's leading edge: the rail is the accent at full strength, the wash
      /// under the text a light tint of it, and the rows around the mark stay on the window background.
      @Test(arguments: [false, true])
      func rendersTheMarkOverTheWindowBackground(dark: Bool) async throws {
        let bitmap = try await Self.render(dark: dark)
        try Attachment.record(#require(bitmap.representation(using: .png, properties: [:])), named: "jump-mark-\(dark ? "dark" : "light").png")
        let scale = CGFloat(bitmap.pixelsWide) / 520
        let corner = try #require(bitmap.colorAt(x: 2, y: bitmap.pixelsHigh - 2)?.usingColorSpace(.deviceRGB))
        #expect(corner.alphaComponent == 1, "Hosted over the window background: alpha \(corner.alphaComponent)")
        #expect(dark ? corner.brightnessComponent < 0.5 : corner.brightnessComponent > 0.5)
        func difference(atX column: CGFloat, row: Int) throws -> CGFloat {
          let color = try #require(bitmap.colorAt(x: Int(column * scale), y: row)?.usingColorSpace(.deviceRGB))
          return abs(color.redComponent - corner.redComponent) + abs(color.greenComponent - corner.greenComponent)
            + abs(color.blueComponent - corner.blueComponent)
        }
        let middle = bitmap.pixelsHigh / 2
        #expect(try difference(atX: 1, row: middle) > 0.4, "The rail draws in the accent.")
        #expect(try (0.04 ... 0.4).contains(difference(atX: 8, row: middle)), "The wash is a tint.")
        #expect(try difference(atX: 1, row: Int(14 * scale)) < 0.02, "The first row is not marked.")
        #expect(try difference(atX: 1, row: bitmap.pixelsHigh - Int(14 * scale)) < 0.02, "The last row is not marked.")
      }
    }
  }
#endif
