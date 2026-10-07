import Foundation
import SokosumiChat

/// Which room's typing channel this socket may use (ADR 0033). Subscribing waits for a token
/// that grants `subscribe` on exactly that channel, and publishing for one that also grants
/// `publish`; a result from an earlier authorization or an earlier room is stale.
struct RoomTypingScope {
  enum Outcome: Equatable {
    case stale
    case granted(roomId: String, canPublish: Bool)
    /// Token lacks the grant, or authorization failed; `failed` says which.
    case denied(roomId: String, failed: Bool)
  }

  private(set) var roomId: String?
  private(set) var canPublish = false
  private var turn = AuthorizationTurn()

  mutating func setRoom(_ id: String?) {
    roomId = id
    canPublish = false
    turn.reset()
  }

  /// Nil without an open room, or while another authorization is in flight (the request is
  /// queued and runs when that one settles).
  mutating func requestAuthorization() -> UUID? {
    guard roomId != nil else { return nil }
    return turn.begin()
  }

  mutating func finishAuthorization(_ id: UUID, capability: String?, failed: Bool) -> Outcome {
    guard let roomId, turn.finish(id) else { return .stale }
    let grant = failed ? nil : chatTypingGrant(in: capability, roomId: roomId)
    canPublish = grant?.canPublish ?? false
    return grant.map { .granted(roomId: roomId, canPublish: $0.canPublish) } ?? .denied(roomId: roomId, failed: failed)
  }

  /// True once when a request arrived during authorization.
  mutating func takeQueued() -> Bool {
    turn.takeQueued()
  }
}
