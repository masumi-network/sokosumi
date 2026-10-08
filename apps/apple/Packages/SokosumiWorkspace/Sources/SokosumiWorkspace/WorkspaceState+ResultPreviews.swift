import CoreAPI
import SokosumiAuth
import SokosumiChat

public extension WorkspaceState {
  /// A Soko Bot message's recorded results as this viewer may see them (row 38e1, web `AuthorizedResultPreviews`).
  /// Web keeps the answer in the row only (`gcTime: 0`), so the row asks again whenever it appears; a 401 signs
  /// out like every other chat request, anything else reaches the row as its "could not be loaded" line.
  func messageResultPreviews(_ message: Components.Schemas.ChatRoomMessage, auth: AuthState) async throws -> [Components.Schemas.ChatResultPreview] {
    guard let client = resolveClient(auth: auth) else {
      throw ChatServiceError.unauthorized("Log in to see results.")
    }
    do {
      return try await ChatService().messageResults(client: client, roomId: message.roomId, messageId: message.id,
                                                    organizationSlug: selection?.workspace.organizationSlug)
    } catch {
      if let error = error as? ChatServiceError {
        signOutIfUnauthorized(error, auth: auth)
      }
      throw error
    }
  }
}
