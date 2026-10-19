import CoreAPI

/// `DirectStreamSession` prefixes both rows of a coworker stream it draws before Core stores them.
let directStreamIdPrefix = "stream:"

/// What a transcript row is, decided once from its id, its outbound shell and its status fields. Every per-message
/// rule (react, quote, edit, reply, copy link) reads this instead of re-checking the id prefixes and fields itself.
public enum MessageKind: Equatable, Sendable {
  /// Stored by Core and still there.
  case confirmed
  /// A send this client has not had confirmed yet.
  case pending
  /// A send that failed; Retry and Remove live on it.
  case failed
  /// A coworker stream's user turn or reply, drawn before Core stores either.
  case streaming
  /// A membership or Group name change row.
  case statusRow
  /// Deleted: only a Thread root keeps a row, "This message was deleted".
  case deleted

  public init(_ message: Components.Schemas.ChatRoomMessage, outbound: OutboundShell? = nil) {
    if message.id.hasPrefix(directStreamIdPrefix) {
      self = .streaming
    } else if isOutboundLocalMessage(message) {
      self = outbound?.status == .failed ? .failed : .pending
    } else if isRoomStatusMessage(message) {
      self = .statusRow
    } else if message.deletedAt != nil {
      self = .deleted
    } else {
      self = .confirmed
    }
  }

  /// A send in flight or failed: the outbox owns the row until Core answers.
  public var isOutbound: Bool {
    self == .pending || self == .failed
  }

  /// Only this client has the row; Core has not stored it.
  public var isLocal: Bool {
    isOutbound || self == .streaming
  }
}
