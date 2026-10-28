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
    formerOrganizationId: String? = nil,
    defaults: UserDefaults = .standard
  ) {
    self.defaults = defaults
    key = Self.key(userId: userId, organizationId: organizationId, roomId: roomId, parentMessageId: parentMessageId)
    // A room shown in every workspace (ADR 0059) was keyed by the workspace's Organization before; move that draft once.
    if organizationId == nil, let formerOrganizationId {
      moveDraft(from: Self.key(userId: userId, organizationId: formerOrganizationId, roomId: roomId, parentMessageId: parentMessageId))
    }
  }

  private static func key(userId: String, organizationId: String?, roomId: String, parentMessageId: String?) -> String {
    // Length prefixes avoid collisions even when identifiers contain separators.
    var parts = [userId, organizationId == nil ? "personal" : "organization", organizationId ?? "", roomId]
    if let parentMessageId {
      parts += ["thread", parentMessageId]
    }
    return "sokosumi.composeDraft.v1." + parts.map { "\($0.utf8.count):\($0)" }.joined()
  }

  private func moveDraft(from oldKey: String) {
    for suffix in ["", ".attachments"] where defaults.object(forKey: key + suffix) == nil {
      guard let old = defaults.object(forKey: oldKey + suffix) else { continue }
      defaults.set(old, forKey: key + suffix)
      defaults.removeObject(forKey: oldKey + suffix)
    }
  }

  func loadAttachments() -> [ComposeAttachment] {
    guard let data = defaults.data(forKey: key + ".attachments") else { return [] }
    return (try? JSONDecoder().decode([ComposeAttachment].self, from: data)) ?? []
  }

  func saveAttachments(_ attachments: [ComposeAttachment]) {
    if attachments.isEmpty {
      defaults.removeObject(forKey: key + ".attachments")
    } else if let data = try? JSONEncoder().encode(attachments) {
      defaults.set(data, forKey: key + ".attachments")
    }
  }

  public func load() -> String {
    defaults.string(forKey: key) ?? ""
  }

  /// Retain text entered after sending when the earlier request fails.
  public func restoreFailedSend(_ text: String, preserving current: String) -> String {
    let restored = current.isEmpty ? text : text + "\n\n" + current
    save(restored)
    return restored
  }

  public func save(_ text: String) {
    if text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
      defaults.removeObject(forKey: key)
    } else {
      defaults.set(text, forKey: key)
    }
  }
}
