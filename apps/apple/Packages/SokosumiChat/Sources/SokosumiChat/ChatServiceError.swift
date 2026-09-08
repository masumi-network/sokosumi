import CoreAPI

/// Failures for the SOK-973 workspace + rooms flow.
public enum ChatServiceError: Error, Equatable, Sendable {
  /// `workspace-access` gate other than `ready`: chat stays blocked and the
  /// caller must not have loaded rooms for this attempt.
  case blocked(Components.Schemas.WorkspaceGateStatus)
  case unauthorized(String)
  /// Core answered with an undocumented status (e.g. its 422 validation
  /// hook): short status + Core message, never a header dump.
  case unprocessable(statusCode: Int, message: String)
  case unexpectedResponse(String)
}
