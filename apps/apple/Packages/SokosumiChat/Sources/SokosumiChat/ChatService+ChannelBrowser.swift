import CoreAPI
import Foundation

public extension ChatService {
  /// Match web's bounded pagination walk; Core owns visibility and membership filtering.
  func discoverableChannels(client: Client, query: String, organizationSlug: String) async throws -> [Components.Schemas.DiscoverableChatRoom] {
    let query = query.trimmingCharacters(in: .whitespacesAndNewlines)
    var rooms: [Components.Schemas.DiscoverableChatRoom] = []
    var cursor: String?
    var seenCursors = Set<String>()
    for _ in 0 ..< Self.roomListMaxPages {
      try Task.checkCancellation()
      let response = try await client.getChatsRoomsDiscoverable(.init(
        query: .init(cursor: cursor, limit: Self.roomListLimit, q: query.isEmpty ? nil : query),
        headers: .init(xOrganizationSlug: organizationSlug)
      ))
      switch response {
      case let .ok(value):
        let payload = try value.body.json
        rooms.append(contentsOf: payload.data)
        guard let next = payload.meta.pagination.nextCursor, seenCursors.insert(next).inserted else { return rooms }
        cursor = next
      case let .badRequest(value): throw try rejected(status: 400, message: value.body.json.message)
      case let .unauthorized(value): throw try unauthorized(value.body.json.message)
      case let .forbidden(value): throw try rejected(status: 403, message: value.body.json.message)
      case let .notFound(value): throw try rejected(status: 404, message: value.body.json.message)
      case let .internalServerError(value): throw try rejected(status: 500, message: value.body.json.message)
      case let .undocumented(statusCode, payload): throw await unprocessableError(statusCode: statusCode, payload: payload)
      }
    }
    return rooms
  }

  func joinChannel(client: Client, roomId: String, organizationSlug: String) async throws -> Components.Schemas.ChatRoom {
    let response = try await client.postChatsRoomsIdMembersMe(.init(path: .init(id: roomId), headers: .init(xOrganizationSlug: organizationSlug)))
    switch response {
    case let .ok(value): return try value.body.json.data
    case let .badRequest(value): throw try rejected(status: 400, message: value.body.json.message)
    case let .unauthorized(value): throw try unauthorized(value.body.json.message)
    case let .forbidden(value): throw try rejected(status: 403, message: value.body.json.message)
    case let .notFound(value): throw try rejected(status: 404, message: value.body.json.message)
    case let .internalServerError(value): throw try rejected(status: 500, message: value.body.json.message)
    case let .undocumented(statusCode, payload): throw await unprocessableError(statusCode: statusCode, payload: payload)
    }
  }
}
