import Foundation
import SokosumiChat

/// Which organization's presence channel this socket may enter (ADR 0003).
/// Entering waits for a token that grants `presence` on that channel; a
/// result from an earlier authorization or an earlier organization is stale.
struct OrgPresenceScope {
  enum Outcome: Equatable {
    case stale
    case granted(String)
    /// Token lacks the grant, or authorization failed; `failed` says which.
    case denied(failed: Bool)
  }

  private(set) var organizationId: String?
  private(set) var isGranted = false
  private var authorization: UUID?
  private var queued = false

  mutating func setOrganization(_ id: String?) {
    organizationId = id
    isGranted = false
    authorization = nil
    queued = false
  }

  /// Nil while personal, or while another authorization is in flight (the
  /// request is queued and runs when that one settles).
  mutating func requestAuthorization() -> UUID? {
    guard organizationId != nil else { return nil }
    guard authorization == nil else {
      queued = true
      return nil
    }
    let id = UUID()
    authorization = id
    return id
  }

  mutating func finishAuthorization(_ id: UUID, capability: String?, failed: Bool) -> Outcome {
    guard authorization == id, let organizationId else { return .stale }
    authorization = nil
    let granted = !failed && (organizationIds(grantedPresenceIn: capability) ?? []).contains(organizationId)
    isGranted = granted
    return granted ? .granted(organizationId) : .denied(failed: failed)
  }

  /// True once when a request arrived during authorization.
  mutating func takeQueued() -> Bool {
    defer { queued = false }
    return queued
  }
}
