import CoreAPI
import Foundation
import SokosumiAuth
import SokosumiChat

public extension WorkspaceState {
  /// The composer's skill picker search (row 42): Core's skills.sh catalog for `query`, the top skills when empty.
  func searchSkills(_ query: String, auth: AuthState) async throws -> [Components.Schemas.ChatSkillCatalogItem] {
    guard let client = resolveClient(auth: auth) else {
      throw ChatServiceError.unexpectedResponse("Sign-in is not configured.")
    }
    do {
      return try await ChatService().searchSkills(client: client, query: query)
    } catch let error as ChatServiceError {
      if !Task.isCancelled {
        _ = signOutIfUnauthorized(error, auth: auth)
      }
      throw error
    }
  }
}
