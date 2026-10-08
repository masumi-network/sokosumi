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

  /// One protected output's bytes as a local file named `fileName` (row 38e2), through the Core operation its href names
  /// and in the open workspace, as web's proxy routes call Core with the session. Web keeps no copy beyond the
  /// browser's revalidated one, so each preview, Open or Download asks again; a 401 signs out.
  func resultOutput(_ source: ResultOutputSource, fileName: String, auth: AuthState) async throws -> ResultOutputFile {
    guard let client = resolveClient(auth: auth) else {
      throw ChatServiceError.unauthorized("Log in to open this file.")
    }
    do {
      return try await ChatService().resultOutput(client: client, source: source, fileName: fileName,
                                                  organizationSlug: selection?.workspace.organizationSlug)
    } catch {
      if let error = error as? ChatServiceError {
        signOutIfUnauthorized(error, auth: auth)
      }
      throw error
    }
  }
}
