import Foundation

/// Local text drafts, isolated by account, workspace, and room.
public struct SavedComposeDraft {
  private let defaults: UserDefaults
  private let key: String

  public init(
    userId: String,
    organizationId: String?,
    roomId: String,
    parentMessageId: String? = nil,
    defaults: UserDefaults = .standard
  ) {
    self.defaults = defaults
    // Length prefixes avoid collisions even when identifiers contain separators.
    var parts = [userId, organizationId == nil ? "personal" : "organization", organizationId ?? "", roomId]
    if let parentMessageId {
      parts += ["thread", parentMessageId]
    }
    key = "sokosumi.composeDraft.v1." + parts.map { "\($0.utf8.count):\($0)" }.joined()
  }

  public func load() -> String {
    defaults.string(forKey: key) ?? ""
  }

  public func save(_ text: String) {
    if text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
      defaults.removeObject(forKey: key)
    } else {
      defaults.set(text, forKey: key)
    }
  }
}
