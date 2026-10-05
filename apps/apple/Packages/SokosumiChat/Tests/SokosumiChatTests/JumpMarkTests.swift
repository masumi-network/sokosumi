import Foundation
import SokosumiChat
import Testing

/// Row 25b1: the jump mark's clock (web `room-message-highlight.ts`, read at `8a24feff5`): a 4.5 s hold that
/// opens over its first 10 %, holds, and fades out from 76 %; a reader scroll at full strength hands it to a
/// 320 ms fade, and in either end of the hold ends it outright. Fixed ids and times.
struct JumpMarkTests {
  private static let landed = Date(timeIntervalSince1970: 1_800_000_000)
  private static let mark = JumpMark(messageId: "msg-4", landedAt: landed)

  private static func at(_ seconds: TimeInterval) -> Date {
    landed.addingTimeInterval(seconds)
  }

  /// Web's hold: `chat-jump-wash`, `chat-jump-rail` and `chat-jump-dim` all stop at 10 % and 76 % of 4500 ms.
  /// The points sit just off 450 ms and 3420 ms, as web's own tests do (`Math.ceil`, `Math.floor`): a `Date`
  /// this far from its reference cannot hold those instants exactly.
  @Test(arguments: [
    (0.0, JumpMark.Stage.opening(progress: 0)),
    (0.225, .opening(progress: 0.5)),
    (0.451, .full),
    (2.0, .full),
    (3.419, .full),
    (3.4201, .closing(progress: 0.0001 / 1.08)),
    (3.96, .closing(progress: 0.5)),
    (4.5, .ended),
    (9.0, .ended)
  ])
  func theHoldOpensHoldsAndFadesOut(seconds: TimeInterval, stage: JumpMark.Stage) {
    #expect(Self.mark.stage(at: Self.at(seconds)).isClose(to: stage), "At \(seconds) s: \(Self.mark.stage(at: Self.at(seconds)))")
  }

  /// Web `landOn`'s timer drops the mark when the hold ends.
  @Test func theHoldEndsAfterFourAndAHalfSeconds() {
    #expect(Self.mark.endsAt == Self.at(4.5))
  }

  /// Web `fadeOutHighlight`: a scroll inside the full-strength stretch fades the mark over 320 ms and drops it then.
  @Test(arguments: [0.451, 1.0, 3.419])
  func aReaderScrollAtFullStrengthFadesTheMarkOut(seconds: TimeInterval) throws {
    let leaving = try #require(Self.mark.readerScrolled(at: Self.at(seconds)))
    #expect(leaving.messageId == "msg-4")
    #expect(leaving.leftAt == Self.at(seconds))
    #expect(leaving.stage(at: Self.at(seconds)).isClose(to: .leaving(progress: 0)))
    #expect(leaving.stage(at: Self.at(seconds + 0.16)).isClose(to: .leaving(progress: 0.5)))
    #expect(leaving.stage(at: Self.at(seconds + 0.321)) == .ended)
    #expect(abs(leaving.endsAt.timeIntervalSince(Self.at(seconds + 0.32))) < 0.000_001)
  }

  /// Web: a scroll while the hold is still opening the mark, or already fading it, ends it outright; the leave
  /// fade would first snap the row back to full strength.
  @Test(arguments: [0.0, 0.2, 0.449, 3.421, 4.0, 4.499])
  func aReaderScrollInEitherEndOfTheHoldEndsTheMarkOutright(seconds: TimeInterval) {
    #expect(Self.mark.readerScrolled(at: Self.at(seconds)) == nil)
  }

  /// Web stops watching once the mark is leaving: a second scroll keeps the one fade and its end.
  @Test func aSecondScrollKeepsTheOneFade() throws {
    let leaving = try #require(Self.mark.readerScrolled(at: Self.at(1)))
    #expect(leaving.readerScrolled(at: Self.at(1.1)) == leaving)
    #expect(leaving.readerScrolled(at: Self.at(1.3)) == leaving)
  }

  /// A scroll after the mark is gone has nothing to end.
  @Test func aReaderScrollAfterTheHoldLeavesNothing() {
    #expect(Self.mark.readerScrolled(at: Self.at(4.5)) == nil)
  }

  /// Web's second jump into the same list replaces the mark and restarts the hold, even on the same row.
  @Test func aSecondLandingRestartsTheHold() {
    let again = JumpMark(messageId: "msg-4", landedAt: Self.at(2))
    #expect(again != Self.mark)
    #expect(again.stage(at: Self.at(2)).isClose(to: .opening(progress: 0)))
    #expect(again.endsAt == Self.at(6.5))
  }
}

private extension JumpMark.Stage {
  /// Equal stages, with progress compared to a microsecond's worth of rounding.
  func isClose(to other: JumpMark.Stage) -> Bool {
    switch (self, other) {
    case let (.opening(lhs), .opening(rhs)), let (.closing(lhs), .closing(rhs)), let (.leaving(lhs), .leaving(rhs)):
      abs(lhs - rhs) < 0.000_01
    default:
      self == other
    }
  }
}
