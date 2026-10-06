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
  struct JumpLanding {
    let state: WorkspaceState
    let host: NSHostingView<AnyView>
    let window: NSWindow
    let scroll: NSScrollView
    /// What the test saw, attached if it fails.
    let diagnosis: JumpDiagnosis
    /// The room's mark runs on this, landed at its start. The Thread's mark keeps `ThreadSession`'s wall clock: nil.
    var clock: ManualJumpMarkClock?

    /// A second into the hold, inside its full-strength stretch (0.45 s to 3.42 s): the room's clock moves there and
    /// the list draws a few frames of it; for the Thread this waits a second.
    @MainActor func fullStrength() async throws {
      guard let clock else { return try await Task.sleep(for: .seconds(1)) }
      clock.move(to: 1)
      for _ in 0 ..< 5 {
        host.layoutSubtreeIfNeeded()
        try await Task.sleep(for: .milliseconds(20))
      }
    }
  }

  /// A jump mark clock the test moves by hand; sleeps end once it reaches their deadline. It starts far from the wall
  /// clock, so any part of the mark that reads the real time instead draws it wrong and fails the test.
  @MainActor final class ManualJumpMarkClock: JumpMarkClock {
    static let start = Date(timeIntervalSinceReferenceDate: 0)
    private var current = start
    /// Whether anything has asked the time. Only a mark does, landing first, so a list that has read it has marked a
    /// row at `start`.
    private(set) var wasRead = false

    var now: Date {
      wasRead = true
      return current
    }

    /// How far the clock has moved.
    var elapsed: TimeInterval {
      current.timeIntervalSince(Self.start)
    }

    /// To `seconds` after the start.
    func move(to seconds: TimeInterval) {
      current = Self.start.addingTimeInterval(seconds)
    }

    func advance(by seconds: TimeInterval) {
      current.addTimeInterval(seconds)
    }

    func sleep(until deadline: Date) async throws {
      while current < deadline {
        try await Task.sleep(for: .milliseconds(10))
      }
    }
  }

  extension NativeWindowTests {
    /// Row 25b1: the mark a jump leaves (web `room-message-highlight.ts` and the `--chat-jump-*` block in
    /// globals.css) holds for 4.5 s, and a reader scroll at full strength fades it out over 320 ms. The test host
    /// builds no accessibility tree, so the room's mark is read from pixels and the thread's from its jump target.
    @MainActor struct JumpMarkViewTests {
      /// Where the jumps land: deep enough in the hundred-message fixture that no reader scroll in a test reaches
      /// the list's top. Landing on fixture-2 put the Thread's header (its divider, reply count, the fixture's Retry
      /// and the day pill) just above the viewport on GitHub's 1× runner, and the wheel brought it in: the divider kept
      /// the wash column from ever reading clear and the chrome added ink (row 25b2's CI follow-up).
      static let landedId = "fixture-10"

      /// The room transcript, or the thread holding it, with a jump to `landedId` requested. With
      /// `blocksHover`, a clear layer over everything takes the pointer's hover, so no row draws its hover wash
      /// whatever the pointer does; a test that drags the scroller has to reach it and passes false.
      static func landing(thread: Bool, blocksHover: Bool = true) async throws -> JumpLanding {
        let clock = thread ? nil : ManualJumpMarkClock()
        let state = try TranscriptScrollingTests.fixtureState(thread: thread, media: false)
        let auth = AuthState()
        if thread {
          state.thread.requestJump(to: Self.landedId)
        } else {
          #expect(try await state.openMessage(Self.landedId, auth: auth) == .opened)
        }
        let host = NSHostingView(rootView: AnyView(Group {
          if thread {
            ReplyThreadView()
          } else {
            RoomTimelineView(roomId: "fixture")
          }
        }
        .background(.background)
        .overlay {
          if blocksHover {
            Self.hoverBlocker
          }
        }
        .environment(\.jumpMarkClock, clock.map { $0 as any JumpMarkClock } ?? SystemJumpMarkClock())
        .environmentObject(state).environmentObject(auth)))
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 900, height: 700), styleMask: [.titled], backing: .buffered, defer: false)
        window.appearance = NSAppearance(named: .aqua)
        // A pointer resting over the window would draw a row's hover wash, which the pixel reads count.
        window.ignoresMouseEvents = true
        window.contentView = host
        try keepPointerOff(window)
        window.orderFront(nil)
        let scroll = try await loadedTranscriptScrollView(in: host)
        _ = try await waitForView(in: host, timeoutMessage: "The jump did not land: \(TranscriptScrollingTests.distanceFromBottom(scroll)) pt from the bottom") {
          TranscriptScrollingTests.distanceFromBottom(scroll) > 400 ? scroll : nil
        }
        if let clock {
          try await poll(host) { clock.wasRead }
          #expect(clock.wasRead, "The room marked the row it landed on.")
        }
        let diagnosis = JumpDiagnosis(state: state, host: host, scroll: scroll)
        diagnosis.snap("landed")
        return JumpLanding(state: state, host: host, window: window, scroll: scroll, diagnosis: diagnosis, clock: clock)
      }

      /// Rows of the transcript's viewport whose pixel `column` points in differs from the viewport's top row
      /// there. Left of the avatars the only thing drawn is the mark.
      static func markedRows(in host: NSView, scroll: NSScrollView, column: CGFloat) throws -> Int {
        try columnDifferences(in: host, scroll: scroll, column: column).count { $0 > 0.04 }
      }

      /// How strongly the mark draws: the largest difference down the viewport's `column` from its top row.
      private static func washStrength(in host: NSView, scroll: NSScrollView) throws -> CGFloat {
        try columnDifferences(in: host, scroll: scroll, column: 6).max() ?? 0
      }

      /// Each viewport row's colour difference, in `column` points, from the viewport's top row. Only a strip
      /// around the column is drawn: drawing the whole window in software takes a fifth of a second once the
      /// spotlight (row 25b2) blurs the other rows, which is longer than the leave fade these reads have to catch.
      static func columnDifferences(in host: NSView, scroll: NSScrollView, column: CGFloat) throws -> [CGFloat] {
        host.layoutSubtreeIfNeeded()
        let strip = NSRect(x: column - 2, y: 0, width: 4, height: host.bounds.height)
        let bitmap = try #require(host.bitmapImageRepForCachingDisplay(in: strip))
        host.cacheDisplay(in: strip, to: bitmap)
        let scale = CGFloat(bitmap.pixelsHigh) / host.bounds.height
        var frame = scroll.convert(scroll.bounds, to: host)
        if !host.isFlipped {
          frame.origin.y = host.bounds.height - frame.maxY
        }
        let top = Int((frame.minY + 2) * scale), bottom = Int((frame.maxY - scroll.contentInsets.bottom - 2) * scale)
        let pixelX = Int(2 * scale)
        let reference = try #require(bitmap.colorAt(x: pixelX, y: top)?.usingColorSpace(.deviceRGB))
        return (top ..< bottom).map { pixelY in
          guard let color = bitmap.colorAt(x: pixelX, y: pixelY)?.usingColorSpace(.deviceRGB) else { return 0 }
          return abs(color.redComponent - reference.redComponent) + abs(color.greenComponent - reference.greenComponent)
            + abs(color.blueComponent - reference.blueComponent)
        }
      }

      /// A clear layer that is hit by the pointer, so the rows under it never hover.
      static var hoverBlocker: some View {
        Color.clear.contentShape(.rect)
      }

      /// Moves `window` off the pointer. `ignoresMouseEvents` keeps clicks out, but SwiftUI still hovers the row a
      /// scroll brings under the pointer, and with mouse events ignored no exit arrives when the pointer moves on: the
      /// row's hover wash and toolbar stay and the pixel reads count them (CI run 37066842622, where GitHub's runner
      /// leaves its pointer over the window). The window goes to the side of the pointer with more room; where that
      /// side is narrower than the window it runs past the screen's edge, keeping a part on screen, rather than
      /// shrinking, so the layout never changes mid-test.
      static func keepPointerOff(_ window: NSWindow) throws {
        // A pointer someone is moving can land on the new frame; a few tries outrun it.
        for _ in 0 ..< 5 {
          let pointer = NSEvent.mouseLocation
          var frame = window.frame
          guard frame.contains(pointer) else { return }
          let screen = NSScreen.screens.first { $0.frame.contains(pointer) } ?? window.screen ?? NSScreen.main
          let bounds = try #require(screen).visibleFrame
          frame.origin.x = pointer.x - bounds.minX >= bounds.maxX - pointer.x ? pointer.x - 1 - frame.width : pointer.x + 1
          window.setFrame(frame, display: true)
        }
        try #require(!window.frame.contains(NSEvent.mouseLocation), "The window \(window.frame) still holds the pointer at \(NSEvent.mouseLocation), so a scroll would hover a row under it.")
      }

      static func wheel(_ scroll: NSScrollView, host: NSView) throws {
        try keepPointerOff(#require(host.window))
        let event = try #require(CGEvent(scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 1, wheel1: 40, wheel2: 0, wheel3: 0))
        event.setIntegerValueField(.scrollWheelEventScrollPhase, value: 1)
        try scroll.scrollWheel(with: #require(NSEvent(cgEvent: event)))
        host.layoutSubtreeIfNeeded()
      }

      /// Polls until `done` holds or ten seconds pass; a loaded runner can hold the main actor for a while. A poll
      /// that runs out attaches what `diagnosis` saw.
      static func poll(_ host: NSView, diagnosis: JumpDiagnosis? = nil, until done: () throws -> Bool) async throws {
        let deadline = ContinuousClock.now.advanced(by: .seconds(10))
        while try !done() {
          guard ContinuousClock.now < deadline else {
            diagnosis?.attach("poll timed out")
            return
          }
          if let window = host.window {
            try keepPointerOff(window)
          }
          host.layoutSubtreeIfNeeded()
          try await Task.sleep(for: .milliseconds(20))
        }
      }

      /// Web `landOn`'s timer: the mark is gone 4.5 s after the landing, with nobody touching the list.
      @Test func theRoomMarkEndsWhenItsHoldRunsOut() async throws {
        let landing = try await Self.landing(thread: false)
        let (host, window, scroll, clock) = try (landing.host, landing.window, landing.scroll, #require(landing.clock))
        defer { window.orderOut(nil) }
        try await landing.fullStrength()
        try await Self.poll(host, diagnosis: landing.diagnosis) { try Self.markedRows(in: host, scroll: scroll, column: 6) > 40 }
        #expect(try Self.markedRows(in: host, scroll: scroll, column: 6) > 40, "Marked a second in.")
        // 3 s is still the full-strength stretch (to 3.42 s), so the mark has not ended early. Later, the hold's own
        // fade takes the wash under the pixel threshold shortly before 4.5 s.
        clock.move(to: 3)
        try await Task.sleep(for: .milliseconds(100))
        #expect(try Self.markedRows(in: host, scroll: scroll, column: 6) > 40, "Held until its closing fade: marked 3 s in.")
        clock.move(to: JumpMark.hold + 0.1)
        try await Self.poll(host, diagnosis: landing.diagnosis) { try Self.markedRows(in: host, scroll: scroll, column: 6) == 0 }
        #expect(try Self.markedRows(in: host, scroll: scroll, column: 6) == 0, "The hold is over.")
      }

      /// The thread's mark ends with its hold too, and takes the jump target with it.
      @Test func theThreadMarkEndsWhenItsHoldRunsOut() async throws {
        let requested = ContinuousClock.now
        let landing = try await Self.landing(thread: true)
        let (state, host, window) = (landing.state, landing.host, landing.window)
        defer { window.orderOut(nil) }
        try await Task.sleep(for: .seconds(1))
        #expect(state.thread.jumpTarget?.messageId == Self.landedId, "Still held a second in.")
        try await Self.poll(host, diagnosis: landing.diagnosis) { state.thread.jumpTarget == nil }
        let gone = requested.duration(to: ContinuousClock.now)
        #expect(state.thread.jumpTarget == nil, "The hold is over.")
        #expect(gone >= .milliseconds(4500), "Held for the whole hold: gone after \(gone).")
      }

      /// Web `fadeOutHighlight`: a wheel over the list at full strength fades the mark over 320 ms rather than
      /// cutting it. The Thread's mark is read from its jump target. The room's is drawn from view state, so it is
      /// read from pixels: the wheel goes in once the wash holds still, which it does only at full strength, and
      /// the fade shows as frames between full and gone. Under Reduce Motion the leave fade drops the mark at once
      /// (web's `prefers-reduced-motion` block, globals.css), so there it only has to be gone; GitHub's macOS
      /// runners turn Reduce Motion on.
      @Test(arguments: [false, true])
      func aWheelAtFullStrengthFadesTheMarkOut(thread: Bool) async throws {
        let landing = try await Self.landing(thread: thread)
        let (state, host, window, scroll) = (landing.state, landing.host, landing.window, landing.scroll)
        defer { window.orderOut(nil) }
        let full: CGFloat
        if thread {
          try await Self.poll(host, diagnosis: landing.diagnosis) { state.thread.jumpTarget?.mark.map { $0.stage(at: Date()) == .full } == true }
          #expect(state.thread.jumpTarget?.mark?.stage(at: Date()) == .full)
          full = 0
        } else {
          // Past the 450 ms opening, so a paused frame there cannot pass for full strength.
          try await landing.fullStrength()
          var last: CGFloat = -1
          var steady: CGFloat = 0
          try await Self.poll(host, diagnosis: landing.diagnosis) {
            let strength = try Self.washStrength(in: host, scroll: scroll)
            defer { last = strength }
            if strength > 0.04, abs(strength - last) < 0.002 {
              steady = strength
              return true
            }
            return false
          }
          #expect(steady > 0.04, "The landed row reached full strength.")
          full = steady
        }
        let wheeled = ContinuousClock.now
        try Self.wheel(scroll, host: host)
        if thread {
          try await Self.poll(host, diagnosis: landing.diagnosis) { state.thread.jumpTarget?.mark?.leftAt != nil || state.thread.jumpTarget == nil }
          #expect(state.thread.jumpTarget?.mark?.leftAt != nil, "Fading, not cut.")
          try await Self.poll(host, diagnosis: landing.diagnosis) { state.thread.jumpTarget == nil }
          #expect(state.thread.jumpTarget == nil, "The fade is over.")
        } else {
          var partial = false
          try await Self.poll(host, diagnosis: landing.diagnosis) {
            // Through the 320 ms leave fade a frame at a time.
            landing.clock?.advance(by: 0.02)
            let strength = try Self.washStrength(in: host, scroll: scroll)
            if strength > 0.04, strength < full - 0.01 {
              partial = true
            }
            return strength <= 0.04
          }
          #expect(try Self.markedRows(in: host, scroll: scroll, column: 6) == 0, "The mark is gone.")
          if !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion {
            #expect(partial, "Fading, not cut: no frame between full strength and gone.")
          }
        }
        // Well inside the 4.5 s hold: the wheel ended it, not its timer. The room's clock took the wheel 1 s in.
        let gone = landing.clock.map { Duration.seconds($0.elapsed - 1) } ?? wheeled.duration(to: ContinuousClock.now)
        #expect(gone < .seconds(2), "Gone \(gone) after the wheel.")
      }

      /// Web keeps the mark when the scrollbar moves the list, which raises no wheel or touch event. Dragging the
      /// scroller's knob moves the thread and leaves its mark at full strength.
      @Test func aScrollerDragKeepsTheMark() async throws {
        let landing = try await Self.landing(thread: true, blocksHover: false)
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
        #expect(state.thread.jumpTarget?.messageId == Self.landedId)
        let mark = try #require(state.thread.jumpTarget?.mark)
        #expect(mark.leftAt == nil, "The mark stands.")
      }

      /// Three real rows over the window background, with the middle one landed a second ago, so at full
      /// strength. With `spotlight` they sit in a list that casts the jump spotlight (row 25b2), as both lists do.
      static func render(dark: Bool, landed: Bool = true, spotlight: Bool = true) async throws -> NSBitmapImageRep {
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
        let mark = landed ? JumpMark(messageId: "Ben", landedAt: Date().addingTimeInterval(-1)) : nil
        let rows = VStack(alignment: .leading, spacing: 0) {
          ForEach(messages, id: \.id) { message in
            let row = MessageRowView(message: message, isContinuation: false, outbound: nil, onRetry: nil, onRemove: nil,
                                     jumpMark: mark?.messageId == message.id ? mark : nil, horizontalInset: 12)
            if spotlight {
              row.jumpSpotlightRow(messageId: message.id)
            } else {
              row
            }
          }
        }
        let content = Group {
          if spotlight {
            rows.jumpSpotlight(for: mark)
          } else {
            rows
          }
        }
        .padding(.vertical, 12)
        .frame(width: 520, alignment: .leading)
        .background(.background)
        .overlay { Self.hoverBlocker }
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
