import Foundation
import SokosumiChat

/// Membership props and local revocations bound the room channels a token
/// may activate. A late authorization must never restore a revoked room.
struct RoomSubscriptionMembership {
  enum FollowUp { case none, immediate, delayed }
  private var members: Set<String> = []
  private var revoked: Set<String> = []
  private var authorization: UUID?
  private var queued = false
  private(set) var needsRetry = false
  private(set) var generation = UUID()

  mutating func update(_ roomIds: Set<String>) {
    guard members != roomIds else { return }
    members = roomIds
    revoked.formIntersection(roomIds)
    generation = UUID()
  }

  mutating func revoke(_ roomId: String) {
    revoked.insert(roomId)
    generation = UUID()
  }

  mutating func beginAuthorization() -> UUID {
    generation = UUID()
    return generation
  }

  mutating func requestAuthorization() -> UUID? {
    guard authorization == nil else { queued = true
      return nil
    }
    needsRetry = false
    let id = beginAuthorization()
    authorization = id
    return id
  }

  mutating func finishAuthorization(_ id: UUID, failed: Bool) -> FollowUp {
    guard authorization == id else { return .none }
    authorization = nil
    if queued {
      queued = false
      return .immediate
    }
    needsRetry = failed
    return failed ? .delayed : .none
  }

  mutating func resetScope() {
    members = []
    revoked = []
    generation = UUID()
    needsRetry = false
  }

  func authorizedRooms(capability: String?, generation expected: UUID) -> Set<String>? {
    guard expected == generation else { return nil }
    let allowed = roomIdsFromCapability(capability).map { members.intersection($0) } ?? members
    return allowed.subtracting(revoked)
  }
}

/// Nil means malformed/missing capability (web falls back to membership).
/// An empty set is a valid token granting no explicit room subscriptions.
func roomIdsFromCapability(_ capability: String?) -> Set<String>? {
  guard let capability, let data = capability.data(using: .utf8),
        let map = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
  return Set(map.compactMap { channel, operations in
    guard let operations = operations as? [Any],
          operations.contains(where: { $0 as? String == "subscribe" }) else { return nil }
    return parseChatRoomId(fromChannelName: channel)
  })
}
