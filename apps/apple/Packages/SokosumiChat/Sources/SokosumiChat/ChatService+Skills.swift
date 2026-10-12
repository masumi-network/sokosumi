import CoreAPI
import Foundation
import OpenAPIRuntime

public extension ChatService {
  /// `GET /chats/skills`: the skills.sh catalog for the composer's skill picker, most installed first; without a
  /// query, the top skills (row 42). The query is trimmed and capped as web's route does.
  func searchSkills(client: Client, query: String) async throws -> [Components.Schemas.ChatSkillCatalogItem] {
    let query = SkillSearch.normalized(query)
    let response = try await client.searchChatSkills(.init(query: .init(q: query.isEmpty ? nil : query)))
    switch response {
    case let .ok(okResponse):
      return try okResponse.body.json.data
    case let .unauthorized(value):
      throw try unauthorized(value.body.json.message)
    case let .undocumented(statusCode, payload):
      throw await unprocessableError(statusCode: statusCode, payload: payload)
    }
  }
}
