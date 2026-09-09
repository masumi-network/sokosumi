import Foundation

/// Storage for the per-install Ably `clientInstanceId` (ADR 0003).
/// The app persists one behind this; tests inject an in-memory store.
public protocol AblyClientInstanceIdStore: Sendable {
  func load() -> String?
  func save(_ id: String)
}

/// `UserDefaults`-backed store. One id per install: standard defaults
/// survive relaunches, so this Mac stays one `{userId}:{instanceId}` device.
/// `UserDefaults` is thread-safe; the unchecked conformance covers the
/// missing `Sendable` annotation on `NSUserDefaults`.
public struct UserDefaultsAblyClientInstanceIdStore: AblyClientInstanceIdStore, @unchecked Sendable {
  private static let key = "sokosumi.ablyClientInstanceId"
  private let defaults: UserDefaults

  public init(defaults: UserDefaults = .standard) {
    self.defaults = defaults
  }

  public func load() -> String? {
    defaults.string(forKey: Self.key)
  }

  public func save(_ id: String) {
    defaults.set(id, forKey: Self.key)
  }
}

/// In-memory store for tests.
public final class MemoryAblyClientInstanceIdStore: AblyClientInstanceIdStore, @unchecked Sendable {
  private var stored: String?

  public init(stored: String? = nil) {
    self.stored = stored
  }

  public func load() -> String? {
    stored
  }

  public func save(_ id: String) {
    stored = id
  }
}

/// Ably instance-id rule shared with Core (`ABLY_CLIENT_INSTANCE_ID_PATTERN`):
/// opaque, 8–64 chars of letters, digits, `_` or `-`.
public func isValidAblyClientInstanceId(_ id: String) -> Bool {
  guard id.count >= 8, id.count <= 64 else { return false }
  return id.allSatisfy { $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "_" || $0 == "-") }
}

/// Stable per-install id: the persisted value when valid, else a fresh
/// 16-hex-char id that is saved before returning. Reused across launches,
/// so token `clientId` stays `{userId}:{same instance}` (ADR 0003).
/// Mirrors web `getOrCreateAblyClientInstanceId` (per tab there, per install
/// here — one Mac is one device).
public func getOrCreateAblyClientInstanceId(
  store: AblyClientInstanceIdStore,
  makeId: () -> String = { UUID().uuidString.replacingOccurrences(of: "-", with: "").prefix(16).lowercased() }
) -> String {
  if let existing = store.load(), isValidAblyClientInstanceId(existing) {
    return existing
  }
  let candidate = makeId()
  // An injected generator may hand back garbage; never persist it — a UUID
  // hex fallback is always valid.
  let id = isValidAblyClientInstanceId(candidate)
    ? candidate
    : String(UUID().uuidString.replacingOccurrences(of: "-", with: "").prefix(16).lowercased())
  store.save(id)
  return id
}

/// Multi-device presence client id (`{userId}:{instanceId}`, ADR 0003).
/// The tracer never enters presence, but the token binds this client id.
public func ablyPresenceClientId(userId: String, instanceId: String) -> String {
  "\(userId):\(instanceId)"
}
