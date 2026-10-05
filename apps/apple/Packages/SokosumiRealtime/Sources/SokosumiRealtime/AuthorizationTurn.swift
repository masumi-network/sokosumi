import Foundation

/// One token authorization at a time for a capability-gated channel. A request made while one
/// is in flight is queued and runs when that one settles, so a reconnect landing mid-authorize
/// never issues a second token request; a result from before a reset is stale.
struct AuthorizationTurn {
  private var current: UUID?
  private var queued = false

  mutating func reset() {
    current = nil
    queued = false
  }

  /// Nil while another authorization is in flight (the request is queued).
  mutating func begin() -> UUID? {
    guard current == nil else {
      queued = true
      return nil
    }
    let id = UUID()
    current = id
    return id
  }

  /// False for a result that belongs to an earlier turn.
  mutating func finish(_ id: UUID) -> Bool {
    guard current == id else { return false }
    current = nil
    return true
  }

  /// True once when a request arrived during authorization.
  mutating func takeQueued() -> Bool {
    defer { queued = false }
    return queued
  }
}
