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
        LegacyScrollers.swap()
        defer { LegacyScrollers.swap() }
        // A failed swizzle leaves overlay scrollers, and a plain 40 pt scroll still moves the pixels by 40.
        #expect(NSScroller.preferredScrollerStyle == .legacy)
        let state = try TranscriptScrollingTests.fixtureState(thread: true, media: false)
        let auth = AuthState()
        state.thread.requestJump(to: "fixture-2")
        let host = NSHostingView(rootView: AnyView(ReplyThreadView()
            .background(.background)
            // Takes the pointer's hover, so no row draws its hover wash into the pixels compared.
            .overlay { Color.clear.contentShape(.rect) }
            .environmentObject(state).environmentObject(auth)))
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 900, height: 700), styleMask: [.titled], backing: .buffered, defer: false)
        window.appearance = NSAppearance(named: .aqua)
        window.ignoresMouseEvents = true
        window.contentView = host
        window.orderFront(nil)
        defer { window.orderOut(nil) }
        let scroll = try await loadedTranscriptScrollView(in: host)
        _ = try await waitForView(in: host, timeoutMessage: "The jump did not land") {
          state.thread.jumpTarget?.mark != nil && TranscriptScrollingTests.distanceFromBottom(scroll) > 400 ? scroll : nil
        }
        // The mark's wash would differ between the two captures.
        state.thread.clearJump()
        try await Task.sleep(for: .milliseconds(500))
        host.layoutSubtreeIfNeeded()
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

      /// How far the content moved down, in points: the shift that best lines `after` up with `before`.
      private static func contentShift(from before: [[Double]], to after: [[Double]]) -> Int {
        let height = min(before.count, after.count)
        return (-300 ... 300).min { error(before, after, height, $0) < error(before, after, height, $1) } ?? 0
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

  /// Stands in for `NSScroller.preferredScrollerStyle` while a test needs the legacy scrollers GitHub's runner has.
  private final class LegacyScrollers: NSObject {
    @objc static func legacyStyle() -> Int {
      NSScroller.Style.legacy.rawValue
    }

    static func swap() {
      guard let original = class_getClassMethod(NSScroller.self, #selector(getter: NSScroller.preferredScrollerStyle)),
            let replacement = class_getClassMethod(LegacyScrollers.self, #selector(legacyStyle)) else { return }
      method_exchangeImplementations(original, replacement)
      NotificationCenter.default.post(name: NSScroller.preferredScrollerStyleDidChangeNotification, object: nil)
    }
  }
#endif
