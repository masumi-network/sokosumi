import CoreAPI

/// Why chat stays closed: Core's workspaces list is empty, so setup finishes
/// on the web (ADR 0051).
public enum WorkspaceGate: Equatable, Sendable {
  /// No workspace yet, but organization invitations are waiting.
  case pendingInvites
  /// No workspace and no invitations.
  case identityOnboarding

  /// Nil when the person has a workspace to open.
  init?(_ workspaces: Components.Schemas.UserWorkspaces) {
    guard workspaces.workspaces.isEmpty else { return nil }
    self = workspaces.pendingInvitationCount > 0 ? .pendingInvites : .identityOnboarding
  }
}
