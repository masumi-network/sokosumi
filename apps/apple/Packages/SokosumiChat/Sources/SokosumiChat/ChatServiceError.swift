import CoreAPI

/// Failures for the SOK-973 workspace + rooms flow.
public enum ChatServiceError: Error, Equatable, Sendable {
  /// No workspace to open: chat stays blocked and the caller must not have
  /// loaded rooms for this attempt.
  case blocked(WorkspaceGate)
  case unauthorized(String)
  /// Core refused the request with any status but 401: short status, Core's
  /// message and its machine-readable `kind` when it sent one, never a header dump.
  case unprocessable(statusCode: Int, message: String, kind: String? = nil)
  case unexpectedResponse(String)
}
