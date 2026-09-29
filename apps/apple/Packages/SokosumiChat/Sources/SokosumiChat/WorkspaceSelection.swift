import CoreAPI
import Foundation

/// Workspace the window sits in. Personal omits `X-Organization-Slug`;
/// an organization sends it.
public enum WorkspaceSelection: Hashable, Sendable {
  case personal
  case organization(id: String, slug: String)

  /// Nil selects personal (header omitted); set is PUT as the preference.
  public var organizationId: String? {
    switch self {
    case .personal: nil
    case let .organization(id, _): id
    }
  }

  /// Nil selects personal (header omitted); set is sent as the slug header.
  public var organizationSlug: String? {
    switch self {
    case .personal: nil
    case let .organization(_, slug): slug
    }
  }
}

/// What launch reads: access gate plus organizations. Notably NOT persisted —
/// launch must not PUT a default preference (that yanks cross-client state
/// and turns every flaky upload into a dead window).
struct InitialWorkspaceState: Sendable {
  var access: Components.Schemas.WorkspaceAccess
  var organizations: [Components.Schemas.Organization]
  /// Session user: id excludes yourself from Direct names, name/email feed
  /// the sidebar "me" section and Settings.
  var currentUser: Components.Schemas.User
  var currentUserId: String {
    currentUser.id
  }

  /// Server-resolved preference, matched to the accessible workspace list.
  var defaultSelection: WorkspaceSelection
}
