#if os(macOS)
  import AppKit
  @testable import Sokosumi
  import SokosumiChat
  import SwiftUI
  import Testing

  extension NativeWindowTests {
    /// Row 25b2: while a list holds a jump mark, every other message row in it steps back (web's spotlight,
    /// `chat-jump-dim` and `chat-jump-undim` in globals.css) and comes back when the mark ends. Read from pixels:
    /// the text of the rows away from the mark puts down less ink while it holds. GitHub's macOS runners turn
    /// Reduce Motion on, under which web casts no spotlight, so there the ink has to stay as it is.
    @MainActor struct JumpSpotlightViewTests {
      private static var reduceMotion: Bool {
        NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
      }

      /// Right of every line of the fixture's text: only a mark's wash draws there, in either list.
      private static let washColumn: CGFloat = 700

      private static func capture(_ host: NSView, scroll: NSScrollView) throws -> SpotlightViewport {
        host.layoutSubtreeIfNeeded()
        let bitmap = try #require(host.bitmapImageRepForCachingDisplay(in: host.bounds))
        host.cacheDisplay(in: host.bounds, to: bitmap)
        let scale = CGFloat(bitmap.pixelsWide) / host.bounds.width
        var frame = scroll.convert(scroll.bounds, to: host)
        if !host.isFlipped {
          frame.origin.y = host.bounds.height - frame.maxY
        }
        let top = Int((frame.minY + 2) * scale), bottom = Int((frame.maxY - scroll.contentInsets.bottom - 2) * scale)
        let pixels = try Pixels(bitmap)
        let washX = Int(washColumn * scale)
        let reference = pixels.color(x: washX, y: top)
        var washed: [Bool] = [], ink: [CGFloat] = []
        for pixelY in top ..< bottom {
          let ground = pixels.color(x: washX, y: pixelY)
          washed.append(Pixels.difference(ground, reference) > 0.04)
          // The text column of both lists: right of the avatars, left of the wash column.
          ink.append(stride(from: Int(60 * scale), to: Int(640 * scale), by: 1).reduce(0) { $0 + Pixels.difference(pixels.color(x: $1, y: pixelY), ground) })
        }
        return SpotlightViewport(washed: washed, ink: ink)
      }

      /// A mark at full strength steps the rows around it back, and they come back once its hold runs out.
      @Test(arguments: [false, true])
      func theOtherRowsStepBackWhileTheMarkHolds(thread: Bool) async throws {
        let landing = try await JumpMarkViewTests.landing(thread: thread)
        let (state, host, window, scroll) = (landing.state, landing.host, landing.window, landing.scroll)
        defer { window.orderOut(nil) }
        let washed = { try Self.capture(host, scroll: scroll).washed.count { $0 } }
        if landing.clock != nil {
          try await landing.fullStrength()
        }
        try await JumpMarkViewTests.poll(host, diagnosis: landing.diagnosis) { try washed() > 40 }
        // Inside the full-strength stretch (0.45 s to 3.42 s of the hold).
        if landing.clock == nil {
          try await landing.fullStrength()
        }
        let held = try Self.capture(host, scroll: scroll)
        landing.diagnosis.snap("held")
        let away = held.washed.indices.filter { !held.washed[$0] }
        #expect(away.count > 200, "Rows away from the mark are in view: \(away.count) pixel rows")
        landing.clock?.move(to: JumpMark.hold + 0.1)
        try await JumpMarkViewTests.poll(host, diagnosis: landing.diagnosis) { try washed() == 0 && (!thread || state.thread.jumpTarget == nil) }
        try await Task.sleep(for: .milliseconds(100))
        let after = try Self.capture(host, scroll: scroll)
        let gone = after.washed.allSatisfy { !$0 }
        #expect(gone, "The mark is gone.")
        let dimmed = held.meanInk(away), rest = after.meanInk(away)
        #expect(rest > 1, "The rows put down ink at rest: \(rest)")
        if !Self.expectSpotlight(held: dimmed, rest: rest, "Stepped back while the mark held") || !gone {
          landing.diagnosis.attach("ink check failed")
        }
      }

      /// Web's spotlight: the ink held well under the ink at rest, or the same under Reduce Motion, which casts none.
      private static func expectSpotlight(held: CGFloat, rest: CGFloat, _ claim: String) -> Bool {
        let passed = reduceMotion ? abs(held / rest - 1) < 0.1 : held < 0.75 * rest
        #expect(passed, "\(reduceMotion ? "Reduce Motion casts no spotlight" : claim): \(held) held, \(rest) after.")
        return passed
      }

      /// A reader scroll at full strength brings the rows back with the mark's leave fade, well inside the hold.
      @Test(arguments: [false, true])
      func aWheelBringsTheRowsBack(thread: Bool) async throws {
        let landing = try await JumpMarkViewTests.landing(thread: thread)
        let (state, host, window, scroll) = (landing.state, landing.host, landing.window, landing.scroll)
        defer { window.orderOut(nil) }
        if landing.clock != nil {
          try await landing.fullStrength()
        }
        try await JumpMarkViewTests.poll(host, diagnosis: landing.diagnosis) { try Self.capture(host, scroll: scroll).washed.count { $0 } > 40 }
        if landing.clock == nil {
          try await landing.fullStrength()
        }
        let dimmed = try Self.capture(host, scroll: scroll).meanInk()
        landing.diagnosis.snap("held")
        let wheeled = ContinuousClock.now
        try JumpMarkViewTests.wheel(scroll, host: host)
        landing.diagnosis.snap("after wheel")
        try await JumpMarkViewTests.poll(host, diagnosis: landing.diagnosis) {
          // Through the 320 ms leave fade a frame at a time.
          landing.clock?.advance(by: 0.02)
          return try Self.capture(host, scroll: scroll).washed.allSatisfy { !$0 } && (!thread || state.thread.jumpTarget == nil)
        }
        // The room's clock took the wheel 1 s in.
        let gone = landing.clock.map { Duration.seconds($0.elapsed - 1) } ?? wheeled.duration(to: ContinuousClock.now)
        try await Task.sleep(for: .milliseconds(100))
        let rest = try Self.capture(host, scroll: scroll).meanInk()
        #expect(gone < .seconds(2), "The mark and the spotlight ended \(gone) after the wheel, not with the hold.")
        if !Self.expectSpotlight(held: dimmed, rest: rest, "Back at rest after the wheel") {
          landing.diagnosis.attach("ink check failed")
        }
      }

      /// Ink of the top row's text in a render of three rows (Ada, Ben landed, Grace).
      private static func topRowInk(_ bitmap: NSBitmapImageRep) throws -> CGFloat {
        let pixels = try Pixels(bitmap)
        let scale = CGFloat(bitmap.pixelsWide) / 520
        let ground = pixels.color(x: 2, y: bitmap.pixelsHigh - 2)
        let rowHeight = (CGFloat(bitmap.pixelsHigh) - 24 * scale) / 3
        return stride(from: Int(12 * scale), to: Int(12 * scale + rowHeight), by: 1).reduce(0) { sum, pixelY in
          stride(from: Int(52 * scale), to: Int(500 * scale), by: 1).reduce(sum) { $0 + Pixels.difference(pixels.color(x: $1, y: pixelY), ground) }
        }
      }

      /// The landed row at full strength with its neighbours stepped back, in both lights over the window
      /// background: the neighbour's text puts down well under the ink it does with no mark in its list.
      @Test(arguments: [false, true])
      func rendersTheSpotlightAroundTheLandedRow(dark: Bool) async throws {
        let marked = try await JumpMarkViewTests.render(dark: dark)
        try Attachment.record(#require(marked.representation(using: .png, properties: [:])), named: "jump-spotlight-\(dark ? "dark" : "light").png")
        let resting = try await JumpMarkViewTests.render(dark: dark, landed: false)
        #expect(marked.pixelsHigh == resting.pixelsHigh, "The spotlight moves nothing.")
        let dimmed = try Self.topRowInk(marked), rest = try Self.topRowInk(resting)
        #expect(rest > 1, "The row puts down ink at rest: \(rest)")
        if Self.reduceMotion {
          #expect(abs(dimmed / rest - 1) < 0.02, "Reduce Motion casts no spotlight: \(dimmed) marked, \(rest) resting.")
        } else {
          #expect(dimmed < 0.75 * rest, "The neighbour stepped back: \(dimmed) marked, \(rest) resting.")
        }
      }

      /// With no mark in the list, the spotlight leaves every row exactly as it draws without one.
      @Test(arguments: [false, true])
      func atRestTheRowsDrawAsBefore(dark: Bool) async throws {
        let withSpotlight = try await JumpMarkViewTests.render(dark: dark, landed: false)
        let without = try await JumpMarkViewTests.render(dark: dark, landed: false, spotlight: false)
        #expect(withSpotlight.pixelsWide == without.pixelsWide && withSpotlight.pixelsHigh == without.pixelsHigh)
        let lhs = try Pixels(withSpotlight), rhs = try Pixels(without)
        var largest: CGFloat = 0
        for pixelY in 0 ..< min(withSpotlight.pixelsHigh, without.pixelsHigh) {
          for pixelX in 0 ..< min(withSpotlight.pixelsWide, without.pixelsWide) {
            largest = max(largest, Pixels.difference(lhs.color(x: pixelX, y: pixelY), rhs.color(x: pixelX, y: pixelY)))
          }
        }
        #expect(largest < 0.02, "Largest pixel difference at rest: \(largest)")
      }
    }
  }

  /// One capture of a hosted list's viewport, a pixel row at a time: whether a mark's wash lies under it, and how
  /// much ink the row's text puts down.
  private struct SpotlightViewport {
    let washed: [Bool]
    let ink: [CGFloat]

    /// Mean ink of the pixel rows `rows` picks, or of every row the wash leaves alone.
    func meanInk(_ rows: [Int]? = nil) -> CGFloat {
      let picked = rows ?? washed.indices.filter { !washed[$0] }
      return picked.isEmpty ? 0 : picked.map { ink[$0] }.reduce(0, +) / CGFloat(picked.count)
    }
  }

  /// An 8-bit bitmap's colour channels, read straight from its bytes: thousands of reads per row would be slow
  /// through `colorAt`.
  private struct Pixels {
    private let bitmap: NSBitmapImageRep
    private let bytes: UnsafeMutablePointer<UInt8>
    private let firstColor: Int

    init(_ bitmap: NSBitmapImageRep) throws {
      try #require(bitmap.bitsPerSample == 8 && bitmap.samplesPerPixel >= 3, "8-bit colour: \(bitmap.bitsPerSample) bits, \(bitmap.samplesPerPixel) samples")
      self.bitmap = bitmap
      bytes = try #require(bitmap.bitmapData)
      firstColor = bitmap.hasAlpha && bitmap.bitmapFormat.contains(.alphaFirst) ? 1 : 0
    }

    /// The three colour channels at a pixel, 0 to 1, in the bitmap's own order.
    func color(x pixelX: Int, y pixelY: Int) -> SIMD3<Double> {
      let offset = pixelY * bitmap.bytesPerRow + pixelX * (bitmap.bitsPerPixel / 8) + firstColor
      return SIMD3(Double(bytes[offset]), Double(bytes[offset + 1]), Double(bytes[offset + 2])) / 255
    }

    static func difference(_ lhs: SIMD3<Double>, _ rhs: SIMD3<Double>) -> CGFloat {
      let delta = lhs - rhs
      return CGFloat(abs(delta.x) + abs(delta.y) + abs(delta.z))
    }
  }
#endif
