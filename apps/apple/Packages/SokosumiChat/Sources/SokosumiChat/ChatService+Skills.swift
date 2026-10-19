import CoreAPI
import Foundation
import OpenAPIRuntime

public extension ChatService {
  /// `GET /chats/skills`: the skills.sh catalog for the composer's skill picker, most installed first; without a
  /// query, the top skills (row 42). The query is trimmed and capped as web's route does.
  func searchSkills(client: Client, query: String) async throws -> [Components.Schemas.ChatSkillCatalogItem] {
    let query = SkillSearch.normalized(query)
    return try await call { try await client.searchChatSkills(.init(query: .init(q: query.isEmpty ? nil : query))) }.ok.body.json.data
  }
}
