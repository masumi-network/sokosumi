import CoreAPI
import Foundation

/// Persists the selected workspace across launches (per Mac, via
/// UserDefaults). There is no Core GET for the preference, so the server
/// value can't be read back — the local id wins when it still exists,
/// otherwise the default applies. A stale id from another account simply
/// misses and falls back.
/// Not Sendable (`UserDefaults` isn't): only touch from the main actor.
public struct SavedWorkspaceSelection {
  private let defaults: UserDefaults
  private let key = "sokosumi.selectedWorkspaceId"

  /// `suiteName` isolates tests from real preferences.
  public init(defaults: UserDefaults = .standard) {
    self.defaults = defaults
  }

  public func save(_ id: String) {
    defaults.set(id, forKey: key)
  }

  public func load() -> String? {
    defaults.string(forKey: key)
  }

  public func clear() {
    defaults.removeObject(forKey: key)
  }
}

/// Resolve the launch selection: the saved id when it still exists
/// (`"personal"` or an organization id), else personal-first / first-org.
public func resolveInitialSelection(
  hasPersonalWorkspace: Bool,
  organizations: [Components.Schemas.Organization],
  savedId: String?
) -> WorkspaceSelection {
  if let savedId {
    if savedId == "personal", hasPersonalWorkspace {
      return .personal
    }
    if let match = organizations.first(where: { $0.id == savedId }) {
      return .organization(id: match.id, slug: match.slug)
    }
  }
  if hasPersonalWorkspace {
    return .personal
  }
  if let first = organizations.first {
    return .organization(id: first.id, slug: first.slug)
  }
  return .personal
}
