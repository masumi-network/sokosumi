import Foundation

/// Where a room's compose drafts are saved. `organizationId` is nil for a room shown in every workspace (ADR 0059);
/// `legacyOrganizationId` is the Organization such a room's drafts were saved under before ADR 0059.
public struct ComposeDraftScope: Hashable, Sendable {
  public var organizationId: String?
  public var legacyOrganizationId: String?

  public init(organizationId: String?, legacyOrganizationId: String? = nil) {
    self.organizationId = organizationId
    self.legacyOrganizationId = legacyOrganizationId
  }
}

/// Local text drafts, isolated by account, workspace, and room.
public struct SavedComposeDraft {
  private let defaults: UserDefaults
  private let key: String
  private let legacyKey: String?

  public init(
    userId: String,
    organizationId: String?,
    roomId: String,
    parentMessageId: String? = nil,
    defaults: UserDefaults = .standard
  ) {
    self.init(userId: userId, scope: .init(organizationId: organizationId), roomId: roomId, parentMessageId: parentMessageId,
              defaults: defaults)
  }

  public init(
    userId: String,
    scope: ComposeDraftScope,
    roomId: String,
    parentMessageId: String? = nil,
    defaults: UserDefaults = .standard
  ) {
    self.defaults = defaults
    key = Self.key(userId: userId, organizationId: scope.organizationId, roomId: roomId, parentMessageId: parentMessageId)
    if scope.organizationId == nil, let legacy = scope.legacyOrganizationId {
      legacyKey = Self.key(userId: userId, organizationId: legacy, roomId: roomId, parentMessageId: parentMessageId)
    } else {
      legacyKey = nil
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

  /// Moves a draft saved under the legacy pre-ADR-0059 key to this draft's key: once, and only into an empty slot.
  public func moveLegacyDraft() {
    guard let oldKey = legacyKey else { return }
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
