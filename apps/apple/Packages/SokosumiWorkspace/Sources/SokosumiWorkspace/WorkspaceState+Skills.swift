import CoreAPI
import SokosumiChat

public extension WorkspaceState {
  /// The composer's skill picker search (row 42): Core's skills.sh catalog for `query`, the top skills when empty.
  func searchSkills(_ query: String) async throws -> [Components.Schemas.ChatSkillCatalogItem] {
    try await request(signIn: "Sign-in is not configured.") { service, client, _ in
      try await service.searchSkills(client: client, query: query)
    }
  }
}
