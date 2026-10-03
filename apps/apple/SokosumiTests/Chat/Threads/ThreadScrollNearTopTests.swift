#if os(macOS)
  import AppKit
  @testable import Sokosumi
  import SokosumiAuth
  import SokosumiWorkspace
  import SwiftUI
  import Testing

  extension NativeWindowTests {
    /// A reader near the top of a long Thread, where the LazyVStack still holds estimated heights for the rows above
    /// the viewport. With legacy scrollers (GitHub's runner, a mouse, or "Always show scroll bars"), a jump to the
    /// second reply lands at offset 436 and a 40 pt reader scroll takes the offset to 167: the parent's estimate is
    /// replaced by its measured height, and SwiftUI moves the offset by the difference so the visible rows stay put.
    /// CI run 37106441624 read that offset as a 269 pt jump; the captures show a 40 pt move.
    @MainActor struct ThreadScrollNearTopTests {
      @Test func aReaderScrollMovesTheContentByTheScrollWhileTheRowsAboveAreMeasured() async throws {
        let state = try TranscriptScrollingTests.fixtureState(thread: true, media: false)
        let auth = AuthState()
        let host = NSHostingView(rootView: AnyView(ReplyThreadView()
            .background(.background)
            // Takes the pointer's hover, so no row draws its hover wash into the pixels compared.
            .overlay { Color.clear.contentShape(.rect) }
            .environmentObject(state).environmentObject(auth)))
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 900, height: 700), styleMask: [.titled], backing: .buffered, defer: false)
        window.appearance = NSAppearance(named: .aqua)
        window.ignoresMouseEvents = true
        window.contentView = host
        try JumpMarkViewTests.keepPointerOff(window)
        window.orderFront(nil)
        defer { window.orderOut(nil) }
        let scroll = try await loadedTranscriptScrollView(in: host)
        let restoreScrollers = try LegacyScrollers.pin(scroll)
        defer { restoreScrollers() }
        host.layoutSubtreeIfNeeded()
        // Overlay scrollers would leave the content 900 pt wide, and a plain 40 pt scroll still moves the pixels by 40.
        try #require(scroll.scrollerStyle == .legacy)
        state.thread.requestJump(to: "fixture-2")
        _ = try await waitForView(in: host, timeoutMessage: "The jump did not land") {
          state.thread.jumpTarget?.mark != nil && TranscriptScrollingTests.distanceFromBottom(scroll) > 400 ? scroll : nil
        }
        // The mark's wash would differ between the two captures.
        state.thread.clearJump()
        try await Task.sleep(for: .milliseconds(500))
        host.layoutSubtreeIfNeeded()
        try JumpMarkViewTests.keepPointerOff(window)
        let before = try Self.bands(host: host, scroll: scroll)
        let offsetBefore = scroll.contentView.bounds.minY

        // What a scroller drag or a wheel does to the clip view; one layout pass, as before the next frame draws.
        scroll.contentView.scroll(to: NSPoint(x: 0, y: offsetBefore - 40))
        scroll.reflectScrolledClipView(scroll.contentView)
        host.layoutSubtreeIfNeeded()

        let offsetAfter = scroll.contentView.bounds.minY
        let moved = try Self.contentShift(from: before, to: Self.bands(host: host, scroll: scroll))
        // Overlay scrollers land this jump near 593 pt. Legacy scrollers land near 436, then measuring the
        // parent pulls the offset down by about 269 pt (CI 436 to 167) while the pixels move only 40.
        // `moved == 40` alone also passes when that measurement never happens.
        #expect(offsetBefore < 520, "Legacy landing offset was \(offsetBefore) pt, not near 436.")
        #expect(offsetBefore - offsetAfter > 200, "Offset \(offsetBefore) to \(offsetAfter) is a plain scroll, not the measurement correction.")
        #expect(moved == 40, "A 40 pt scroll moved the visible rows by \(moved) pt (offset \(offsetBefore) to \(offsetAfter)).")
      }

      /// The viewport above the composer, one row per point, as the mean grey of each 16 pt band across.
      private static func bands(host: NSView, scroll: NSScrollView) throws -> [[Double]] {
        var frame = scroll.convert(scroll.bounds, to: host)
        frame.size.height -= scroll.contentInsets.bottom
        if !host.isFlipped {
          frame.origin.y += scroll.contentInsets.bottom
        }
        let bitmap = try #require(host.bitmapImageRepForCachingDisplay(in: frame))
        host.cacheDisplay(in: frame, to: bitmap)
        let data = try #require(bitmap.bitmapData)
        let scale = CGFloat(bitmap.pixelsWide) / frame.width
        let band = Int(16 * scale), samples = bitmap.samplesPerPixel
        return (0 ..< Int(frame.height)).map { row in
          let line = data + Int(CGFloat(row) * scale) * bitmap.bytesPerRow
          return stride(from: 0, to: bitmap.pixelsWide - band, by: band).map { start in
            (start ..< start + band).reduce(0.0) { sum, pixel in
              sum + Double(Int(line[pixel * samples]) + Int(line[pixel * samples + 1]) + Int(line[pixel * samples + 2]))
            } / Double(band * 3 * 255)
          }
        }
      }

      /// How far the content moved down, in points: the shift that best lines `after` up with `before`. The
      /// fixture's messages repeat every 230 pt, so the best shift has to beat every other one by half.
      private static func contentShift(from before: [[Double]], to after: [[Double]]) throws -> Int {
        let height = min(before.count, after.count)
        let ranked = (-300 ... 300).map { ($0, error(before, after, height, $0)) }.sorted { $0.1 < $1.1 }
        let best = try #require(ranked.first)
        let runnerUp = try #require(ranked.first { abs($0.0 - best.0) > 2 })
        try #require(best.1 * 2 < runnerUp.1, "No unique shift: \(best.0) pt scores \(best.1), \(runnerUp.0) pt scores \(runnerUp.1).")
        return best.0
      }

      private static func error(_ before: [[Double]], _ after: [[Double]], _ height: Int, _ shift: Int) -> Double {
        let rows = max(0, -shift) ..< min(height, height - shift)
        guard rows.count > height / 3 else { return .infinity }
        return rows.reduce(0.0) { sum, row in
          sum + zip(before[row], after[row + shift]).reduce(0.0) { $0 + abs($1.0 - $1.1) }
        } / Double(rows.count)
      }
    }
  }

  /// Legacy scrollers (GitHub's runner) for one scroll view. SwiftUI sets a scroll view's `scrollerStyle` back to the
  /// preferred overlay style, and AppKit cannot take a subclass of its scroll view, so `scrollerStyle` answers legacy
  /// for `scroll` alone until the returned closure restores it; other views, in suites running in parallel too,
  /// keep the system's style.
  private enum LegacyScrollers {
    static func pin(_ scroll: NSScrollView) throws -> () -> Void {
      typealias Getter = @convention(c) (NSScrollView, Selector) -> Int
      typealias Setter = @convention(c) (NSScrollView, Selector, Int) -> Void
      let getSelector = #selector(getter: NSScrollView.scrollerStyle), setSelector = #selector(setter: NSScrollView.scrollerStyle)
      let base: AnyClass = try #require(object_getClass(scroll))
      let getter = try #require(class_getInstanceMethod(base, getSelector)), setter = try #require(class_getInstanceMethod(base, setSelector))
      let originalGet = method_getImplementation(getter), originalSet = method_getImplementation(setter)
      let get = unsafeBitCast(originalGet, to: Getter.self), set = unsafeBitCast(originalSet, to: Setter.self)
      let legacy = NSScroller.Style.legacy.rawValue
      weak var pinned = scroll
      let pinnedGet: @convention(block) (NSScrollView) -> Int = { view in view === pinned ? legacy : get(view, getSelector) }
      let pinnedSet: @convention(block) (NSScrollView, Int) -> Void = { view, style in set(view, setSelector, view === pinned ? legacy : style) }
      method_setImplementation(getter, imp_implementationWithBlock(pinnedGet))
      method_setImplementation(setter, imp_implementationWithBlock(pinnedSet))
      scroll.scrollerStyle = .legacy
      return {
        method_setImplementation(getter, originalGet)
        method_setImplementation(setter, originalSet)
      }
    }
  }
#endif
