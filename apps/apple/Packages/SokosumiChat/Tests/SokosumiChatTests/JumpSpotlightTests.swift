import Foundation
import SokosumiChat
import Testing

/// Row 25b2: the spotlight a jump mark casts over the rest of its list (web `chat-jump-dim` and
/// `chat-jump-undim` in globals.css, read at `b6fedb0b4`): every other row steps back to opacity 0.5 with a
/// 1.5 px blur (0.36 and 2.5 px in dark) on the mark's clock, and comes back over the leave fade. Reduced motion
/// has none. Fixed ids and times; a linear curve unless a test says otherwise.
struct JumpSpotlightTests {
  private static let landed = Date(timeIntervalSince1970: 1_800_000_000)
  private static let mark = JumpMark(messageId: "msg-4", landedAt: landed)

  private static func at(_ seconds: TimeInterval) -> Date {
    landed.addingTimeInterval(seconds)
  }

  private static func spotlight(_ mark: JumpMark, at seconds: TimeInterval, dark: Bool = false, reduceMotion: Bool = false,
                                easing: (Double) -> Double = { $0 }) -> JumpSpotlight {
    JumpSpotlight(stage: mark.stage(at: at(seconds)), dark: dark, reduceMotion: reduceMotion, easing: easing)
  }

  /// Web's `--chat-jump-dim-opacity` and `--chat-jump-dim-blur`: dark takes more of both.
  @Test func steppedAllTheWayBackItIsWebsDim() {
    #expect(JumpSpotlight.steppedBack(dark: false) == JumpSpotlight(stage: .full, dark: false, reduceMotion: false) { $0 })
    #expect(JumpSpotlight.steppedBack(dark: false).opacity == 0.5)
    #expect(JumpSpotlight.steppedBack(dark: false).blurRadius == 1.5)
    #expect(JumpSpotlight.steppedBack(dark: true).opacity == 0.36)
    #expect(JumpSpotlight.steppedBack(dark: true).blurRadius == 2.5)
    #expect(JumpSpotlight.none.opacity == 1)
    #expect(JumpSpotlight.none.blurRadius == 0)
  }

  /// `chat-jump-dim` runs the mark's stops: in over the first 10 % of the hold, held to 76 %, back out by its
  /// end. The points sit just off 450 ms and 3420 ms, as `JumpMarkTests` does.
  @Test(arguments: [
    (0.0, 1.0, 0.0),
    (0.225, 0.75, 0.75),
    (0.451, 0.5, 1.5),
    (2.0, 0.5, 1.5),
    (3.419, 0.5, 1.5),
    (3.96, 0.75, 0.75),
    (4.5, 1.0, 0.0),
    (9.0, 1.0, 0.0)
  ])
  func theOtherRowsStepBackOnTheMarksClock(seconds: TimeInterval, opacity: Double, blurRadius: Double) {
    let spotlight = Self.spotlight(Self.mark, at: seconds)
    #expect(abs(spotlight.opacity - opacity) < 0.000_01, "Opacity at \(seconds) s: \(spotlight.opacity)")
    #expect(abs(spotlight.blurRadius - blurRadius) < 0.000_01, "Blur at \(seconds) s: \(spotlight.blurRadius)")
  }

  /// Dark steps further back over the same clock.
  @Test func darkStepsFurtherBack() {
    #expect(Self.spotlight(Self.mark, at: 2, dark: true) == .steppedBack(dark: true))
    let half = Self.spotlight(Self.mark, at: 0.225, dark: true)
    #expect(abs(half.opacity - 0.68) < 0.000_01)
    #expect(abs(half.blurRadius - 1.25) < 0.000_01)
  }

  /// `chat-jump-undim`: a reader scroll at full strength brings the rows back over the 320 ms leave fade, from
  /// where the hold kept them.
  @Test func aReaderScrollBringsTheRowsBackOverTheLeaveFade() throws {
    let leaving = try #require(Self.mark.readerScrolled(at: Self.at(1)))
    #expect(Self.spotlight(leaving, at: 1) == .steppedBack(dark: false))
    let half = Self.spotlight(leaving, at: 1.16)
    #expect(abs(half.opacity - 0.75) < 0.000_01)
    #expect(abs(half.blurRadius - 0.75) < 0.000_01)
    #expect(Self.spotlight(leaving, at: 1.321) == .none)
  }

  /// Web's keyframes run `ease-out` between their stops; the curve shapes each stretch, in and back out.
  @Test func theCurveShapesEachStretch() throws {
    let squared: (Double) -> Double = { $0 * $0 }
    let opening = Self.spotlight(Self.mark, at: 0.225, easing: squared)
    #expect(abs(opening.opacity - 0.875) < 0.000_01, "A quarter of the way back: \(opening.opacity)")
    let closing = Self.spotlight(Self.mark, at: 3.96, easing: squared)
    #expect(abs(closing.opacity - 0.625) < 0.000_01, "Three quarters back still: \(closing.opacity)")
    let leaving = try #require(Self.mark.readerScrolled(at: Self.at(1)))
    #expect(abs(Self.spotlight(leaving, at: 1.16, easing: squared).blurRadius - 1.125) < 0.000_01)
  }

  /// Web's `prefers-reduced-motion` block: no spotlight at any point of the hold or the leave.
  @Test(arguments: [0.0, 0.225, 2.0, 3.96, 4.5])
  func reducedMotionHasNoSpotlight(seconds: TimeInterval) throws {
    #expect(Self.spotlight(Self.mark, at: seconds, dark: true, reduceMotion: true) == .none)
    let leaving = try #require(Self.mark.readerScrolled(at: Self.at(2)))
    #expect(Self.spotlight(leaving, at: 2.1, reduceMotion: true) == .none)
  }

  /// A second jump into the same list restarts the hold, so the rows start stepping back again from rest.
  @Test func aSecondLandingStartsTheStepBackAgain() {
    let again = JumpMark(messageId: "msg-9", landedAt: Self.at(2))
    #expect(Self.spotlight(Self.mark, at: 2).opacity == 0.5)
    #expect(Self.spotlight(again, at: 2) == .none)
    #expect(abs(Self.spotlight(again, at: 2.225).opacity - 0.75) < 0.000_01)
    #expect(Self.spotlight(again, at: 2.451).opacity == 0.5)
  }
}
