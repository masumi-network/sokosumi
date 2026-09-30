import Foundation

/// The mark a jump leaves on the row it landed on (web `room-message-highlight.ts` and the `--chat-jump-*`
/// block in `globals.css`): a search hit, a pin, a quote or a message link. Each list keeps its own, so the
/// room transcript and the open thread mark and end theirs apart. Time is passed in; nothing here reads a clock.
public struct JumpMark: Equatable, Sendable {
  /// Web `ROOM_MESSAGE_HIGHLIGHT_MS`: the longest a landed row stays marked.
  public static let hold: TimeInterval = 4.5
  /// Web `ROOM_MESSAGE_HIGHLIGHT_LEAVE_MS`: the fade once a reader scroll ends the hold early.
  public static let leave: TimeInterval = 0.32
  /// Web `ROOM_MESSAGE_HIGHLIGHT_OPEN_SHARE` and `…_FULL_STRENGTH_SHARE`: the mark opens over the first
  /// tenth of the hold, stays at full strength until 76 % of it, then fades out over the rest.
  static let openShare = 0.1
  static let fullStrengthShare = 0.76

  /// Where the mark is at a moment. Each fading stage carries its linear progress, 0 to 1.
  public enum Stage: Equatable, Sendable {
    case opening(progress: Double)
    case full
    /// The hold's own fade over its last 24 %.
    case closing(progress: Double)
    /// The fade a reader scroll started, over `JumpMark.leave`.
    case leaving(progress: Double)
    case ended
  }

  public let messageId: String
  public let landedAt: Date
  /// When a reader scroll handed the mark to the leave fade.
  public private(set) var leftAt: Date?

  public init(messageId: String, landedAt: Date) {
    self.messageId = messageId
    self.landedAt = landedAt
  }

  /// When the mark is gone: the end of the hold, or of the leave fade.
  public var endsAt: Date {
    leftAt.map { $0.addingTimeInterval(Self.leave) } ?? landedAt.addingTimeInterval(Self.hold)
  }

  public func stage(at now: Date) -> Stage {
    if let leftAt {
      let left = now.timeIntervalSince(leftAt)
      return left < Self.leave ? .leaving(progress: max(0, left) / Self.leave) : .ended
    }
    let held = now.timeIntervalSince(landedAt)
    let open = Self.openShare * Self.hold
    let closing = Self.fullStrengthShare * Self.hold
    switch held {
    case ..<open: return .opening(progress: max(0, held) / open)
    case ..<closing: return .full
    case ..<Self.hold: return .closing(progress: (held - closing) / (Self.hold - closing))
    default: return .ended
    }
  }

  /// A reader scroll in the list that holds the mark (web `fadeOutHighlight`). At full strength the mark
  /// fades out over `leave`; in its opening or closing stretch it ends outright (nil), because the fade
  /// starts from full strength and would snap the row back first. A mark already leaving keeps its one fade.
  public func readerScrolled(at now: Date) -> JumpMark? {
    switch stage(at: now) {
    case .full:
      var leaving = self
      leaving.leftAt = now
      return leaving
    case .leaving:
      return self
    case .opening, .closing, .ended:
      return nil
    }
  }
}
