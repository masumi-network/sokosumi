#if os(macOS)
  import AppKit
  import CoreAPI
  @testable import Sokosumi
  import SokosumiAuth
  import SokosumiChat
  import SokosumiWorkspace
  import SwiftUI
  import Testing

  private struct HoverDelayHost: View {
    let flag: TranscriptScrollActivity
    let delay: Duration
    let row: MessageRowView

    var body: some View {
      row
        .environment(\.transcriptScrollActivity, flag)
        .environment(\.messageHoverDelay, delay)
    }
  }

  extension NativeWindowTests {
    /// M8: a row's hover fill and action bar show once the pointer has rested on it, never while the transcript
    /// scrolls, and go at once when scrolling starts. The test host builds no accessibility tree, so the chrome is
    /// read from pixels: the band above the row where the bar reaches, and the row's leading margin, which only the
    /// hover fill paints.
    @MainActor struct MessageHoverDelayTests {
      private static let top: CGFloat = 24
      private static let contentTop = top + 8
      private static let width: CGFloat = 560

      private static func message() -> Components.Schemas.ChatRoomMessage {
        var message = chatRoomMessage(from: .init(clientTurnId: "hover", roomId: "room_1",
                                                  content: "Should we try to make a plugin for this? There aren't that many right now.",
                                                  createdAt: Date(timeIntervalSince1970: 1_790_251_200),
                                                  sender: .init(id: "user_2", name: "Phil", email: "phil@example.com", presence: .online)))
        message.id = "message_1"
        return message
      }

      private static func host(delay: Duration, flag: TranscriptScrollActivity) async throws -> (NSHostingView<AnyView>, NSWindow) {
        let row = MessageRowView(message: message(), isContinuation: false, outbound: nil, onRetry: nil, onRemove: nil,
                                 onReply: {}, onQuote: {}, horizontalInset: 12)
        let host = NSHostingView(rootView: AnyView(HoverDelayHost(flag: flag, delay: delay, row: row)
            .padding(.top, top)
            .padding(.bottom, 8)
            .frame(width: width, alignment: .topLeading)
            .background(.background)
            .environmentObject(WorkspaceState()).environmentObject(AuthState())
            .environment(\.colorScheme, .light)
            .environment(\.locale, Locale(identifier: "en_US"))))
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: width, height: 160), styleMask: [.titled], backing: .buffered, defer: false)
        window.appearance = NSAppearance(named: .aqua)
        window.contentView = host
        window.makeKeyAndOrderFront(nil)
        for _ in 0 ..< 8 {
          host.layoutSubtreeIfNeeded()
          try await Task.sleep(for: .milliseconds(20))
        }
        window.setContentSize(host.fittingSize)
        host.layoutSubtreeIfNeeded()
        return (host, window)
      }

      private static func draw(_ host: NSView) throws -> NSBitmapImageRep {
        host.layoutSubtreeIfNeeded()
        let bitmap = try #require(host.bitmapImageRepForCachingDisplay(in: host.bounds))
        host.cacheDisplay(in: host.bounds, to: bitmap)
        return bitmap
      }

      private static func luminance(_ bitmap: NSBitmapImageRep, _ column: Int, _ row: Int) -> CGFloat {
        guard let color = bitmap.colorAt(x: column, y: row)?.usingColorSpace(.deviceRGB) else { return 0 }
        return 0.2126 * color.redComponent + 0.7152 * color.greenComponent + 0.0722 * color.blueComponent
      }

      /// What the hover changed against the unhovered drawing: the action bar above the row, the fill in its margin.
      private static func chrome(_ drawn: NSBitmapImageRep, plain: NSBitmapImageRep) -> (bar: Bool, fill: Bool) {
        let scale = CGFloat(drawn.pixelsWide) / width
        let band = Int((top - 6) * scale) ..< Int((contentTop - 2) * scale)
        let bar = (0 ..< drawn.pixelsWide).contains { column in
          band.contains { abs(luminance(drawn, column, $0) - luminance(plain, column, $0)) > 0.06 }
        }
        let margin = Int(4 * scale)
        let fill = (Int(contentTop * scale) ..< drawn.pixelsHigh - Int(10 * scale)).contains {
          abs(luminance(drawn, margin, $0) - luminance(plain, margin, $0)) > 0.015
        }
        return (bar, fill)
      }

      /// Draws until the chrome shows or `timeout` passes.
      private static func waitForChrome(_ host: NSView, plain: NSBitmapImageRep, timeout: Duration = .seconds(2)) async throws -> (bar: Bool, fill: Bool) {
        let clock = ContinuousClock()
        let deadline = clock.now.advanced(by: timeout)
        var seen = try chrome(draw(host), plain: plain)
        while !(seen.bar && seen.fill), clock.now < deadline {
          try await Task.sleep(for: .milliseconds(20))
          seen = try chrome(draw(host), plain: plain)
        }
        return seen
      }

      private static var pointer: NSPoint {
        NSPoint(x: width / 2, y: contentTop + 20)
      }

      /// Passing over a row draws nothing until the pointer has rested there for the delay.
      @Test func aPassingPointerDrawsNoChrome() async throws {
        let (host, window) = try await Self.host(delay: .seconds(60), flag: TranscriptScrollActivity())
        defer { window.orderOut(nil) }
        let plain = try Self.draw(host)
        try await hover(Self.pointer, in: host, window: window)
        let seen = try Self.chrome(Self.draw(host), plain: plain)
        #expect(!seen.bar, "No action bar before the pointer rests")
        #expect(!seen.fill, "No hover fill before the pointer rests")
      }

      /// Resting for the delay shows both.
      @Test func aRestingPointerShowsTheChrome() async throws {
        let (host, window) = try await Self.host(delay: .milliseconds(200), flag: TranscriptScrollActivity())
        defer { window.orderOut(nil) }
        let plain = try Self.draw(host)
        try await hover(Self.pointer, in: host, window: window)
        let seen = try await Self.waitForChrome(host, plain: plain)
        #expect(seen.bar, "The action bar shows after the rest")
        #expect(seen.fill, "The hover fill shows after the rest")
      }

      /// A row under a resting pointer stays plain while the transcript scrolls.
      @Test func nothingShowsWhileTheTranscriptScrolls() async throws {
        let flag = TranscriptScrollActivity()
        flag.isScrolling = true
        let (host, window) = try await Self.host(delay: .milliseconds(20), flag: flag)
        defer { window.orderOut(nil) }
        let plain = try Self.draw(host)
        try await hover(Self.pointer, in: host, window: window)
        let seen = try await Self.waitForChrome(host, plain: plain, timeout: .milliseconds(400))
        #expect(!seen.bar, "No action bar while scrolling")
        #expect(!seen.fill, "No hover fill while scrolling")
      }

      /// Shown chrome goes on the first update after scrolling starts, and comes back once the list stops under the
      /// still-resting pointer.
      @Test func scrollingHidesTheChromeAtOnce() async throws {
        let flag = TranscriptScrollActivity()
        let (host, window) = try await Self.host(delay: .milliseconds(20), flag: flag)
        defer { window.orderOut(nil) }
        let plain = try Self.draw(host)
        try await hover(Self.pointer, in: host, window: window)
        let shown = try await Self.waitForChrome(host, plain: plain)
        try #require(shown.bar && shown.fill, "The chrome showed before scrolling")
        flag.isScrolling = true
        let scrolling = try Self.chrome(Self.draw(host), plain: plain)
        #expect(!scrolling.bar, "The action bar hides when scrolling starts")
        #expect(!scrolling.fill, "The hover fill hides when scrolling starts")
        flag.isScrolling = false
        let settled = try await Self.waitForChrome(host, plain: plain)
        #expect(settled.bar && settled.fill, "The chrome returns once the list stops: \(settled)")
      }

      /// The bar is built only while the pointer is on the row (or focus or the picker holds it): every realized row
      /// carried a hidden one, and with it two variants of eight controls for SwiftUI to lay out and hit-test on
      /// every scroll step (M6). The bar brings its own right-click area (M7), so a row hosts two context-menu views
      /// while it has a bar and one without.
      @Test func onlyARowUnderThePointerBuildsItsActionBar() async throws {
        let (host, window) = try await Self.host(delay: .seconds(60), flag: TranscriptScrollActivity())
        defer { window.orderOut(nil) }
        func menuAreas(_ view: NSView) -> Int {
          (view is MessageContextMenuView ? 1 : 0) + view.subviews.reduce(0) { $0 + menuAreas($1) }
        }
        host.layoutSubtreeIfNeeded()
        #expect(menuAreas(host) == 1, "A row nobody points at builds no bar: \(menuAreas(host)) context-menu views")
        try await hover(Self.pointer, in: host, window: window)
        host.layoutSubtreeIfNeeded()
        #expect(menuAreas(host) == 2, "The row under the pointer builds its bar, still hidden until the rest: \(menuAreas(host))")
      }

      /// The real room and Thread: a row hovered before a wheel gesture keeps no fill while the gesture moves the list,
      /// for a trackpad's phased events and a mouse wheel's unphased ones.
      @Test(arguments: [(thread: false, phased: true), (thread: false, phased: false), (thread: true, phased: true)])
      func theTranscriptHidesHoverChromeWhileScrolling(thread: Bool, phased: Bool) async throws {
        let state = try TranscriptScrollingTests.fixtureState(thread: thread, media: false)
        let host = NSHostingView(rootView: Group {
          if thread {
            ReplyThreadView()
          } else {
            RoomTimelineView(roomId: "fixture")
          }
        }
        .environment(\.messageHoverDelay, .milliseconds(20))
        .background(.background)
        .environment(\.colorScheme, .light)
        .environmentObject(state).environmentObject(AuthState()))
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 900, height: 700), styleMask: [.titled], backing: .buffered, defer: false)
        window.appearance = NSAppearance(named: .aqua)
        window.contentView = host
        window.makeKeyAndOrderFront(nil)
        defer { window.orderOut(nil) }
        let scroll = try await loadedTranscriptScrollView(in: host)
        _ = try await waitForView(in: host, timeoutMessage: "The transcript anchored at its bottom") {
          abs(TranscriptScrollingTests.distanceFromBottom(scroll)) <= 1 && scroll.contentView.bounds.minY > 600 ? scroll : nil
        }
        try await Task.sleep(for: .milliseconds(200))
        let plain = try Self.draw(host)
        // Top-left origin: the NSHostingView is flipped.
        try await hover(NSPoint(x: 450, y: 250), in: host, window: window)
        var filled = try Self.marginFill(Self.draw(host), plain: plain)
        for _ in 0 ..< 50 where !filled {
          try await Task.sleep(for: .milliseconds(20))
          filled = try Self.marginFill(Self.draw(host), plain: plain)
        }
        try #require(filled, "The resting pointer filled its row before the gesture")
        let start = scroll.contentView.bounds.minY
        var filledWhileScrolling: [Int] = []
        for index in 0 ..< 12 {
          let wheel = try #require(CGEvent(scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 1, wheel1: 40, wheel2: 0, wheel3: 0))
          if phased {
            wheel.setIntegerValueField(.scrollWheelEventScrollPhase, value: index == 0 ? 1 : 2)
          }
          try scroll.scrollWheel(with: #require(NSEvent(cgEvent: wheel)))
          try await Task.sleep(for: .milliseconds(16))
          if index > 0, try Self.marginFill(Self.draw(host), plain: nil) {
            filledWhileScrolling.append(index)
          }
        }
        #expect(scroll.contentView.bounds.minY < start - 100, "The wheel moved the list: \(start) → \(scroll.contentView.bounds.minY)")
        #expect(filledWhileScrolling.isEmpty, "Hover fill drawn during the gesture at events \(filledWhileScrolling)")
      }

      /// Whether any row's hover fill shows in the gutter between the avatars and the text (x = 50 pt in the room and
      /// the Thread alike), above the composer. Without `plain`, against the gutter's own background at the top.
      private static func marginFill(_ drawn: NSBitmapImageRep, plain: NSBitmapImageRep?) -> Bool {
        let scale = CGFloat(drawn.pixelsWide) / 900
        let margin = Int(50 * scale)
        let rows = Int(20 * scale) ..< Int(450 * scale)
        let background = luminance(plain ?? drawn, margin, Int(10 * scale))
        return rows.contains { row in
          let reference = plain.map { luminance($0, margin, row) } ?? background
          return abs(luminance(drawn, margin, row) - reference) > 0.015
        }
      }
    }
  }
#endif
