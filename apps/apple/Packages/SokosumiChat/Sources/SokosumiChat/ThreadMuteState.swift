import Foundation

/// The reader's mute on one thread (ADR 0030; web `ThreadMuteButton`).
///
/// Unknown until Core answers, and then no control shows: a parent without a live reply is not a thread,
/// and a failed read stays unknown too. A toggle answers at once, blocks the next toggle until Core
/// settles it, takes Core's answer and reverts on failure.
public struct ThreadMuteState: Equatable, Sendable {
  public enum Failure: Equatable, Sendable {
    case mute
    case unmute

    /// Web's action copy for the failed direction.
    public var message: String {
      switch self {
      case .mute: "Could not mute this thread."
      case .unmute: "Could not unmute this thread."
      }
    }
  }

  public let roomId: String
  public let parentMessageId: String
  public private(set) var isMuted: Bool?
  public private(set) var isPending = false
  public private(set) var failure: Failure?

  public init(roomId: String, parentMessageId: String) {
    self.roomId = roomId
    self.parentMessageId = parentMessageId
  }

  /// Read only while unknown, so a reply landing mid-toggle cannot race the write it would overtake.
  public var needsRead: Bool {
    isMuted == nil
  }

  public mutating func read(mutedAt: Date?) {
    guard isMuted == nil else { return }
    isMuted = mutedAt != nil
  }

  /// Answers the click and returns the state to ask Core for, or nil when there is nothing to toggle yet
  /// or a write is still running.
  public mutating func beginToggle() -> Bool? {
    guard let isMuted, !isPending else { return nil }
    self.isMuted = !isMuted
    isPending = true
    failure = nil
    return !isMuted
  }

  /// Core's answer is the truth; the optimistic value was only a guess.
  public mutating func settle(mutedAt: Date?) {
    guard isPending else { return }
    isMuted = mutedAt != nil
    isPending = false
  }

  public mutating func fail() {
    guard isPending, let isMuted else { return }
    self.isMuted = !isMuted
    isPending = false
    failure = isMuted ? .mute : .unmute
  }

  public mutating func dismissFailure() {
    failure = nil
  }
}
