import CoreAPI

/// Web's `THREAD_LIST_PAGE_LIMIT`, sent on the first page and every older one; Core's default is 20.
let threadListPageLimit = 50

public extension ChatService {
  func listThreads(client: Client, roomId: String, cursor: String? = nil, organizationSlug: String?) async throws -> (items: [Components.Schemas.ChatRoomThread], nextCursor: String?) {
    let response = try await client.getChatsRoomsIdThreads(.init(path: .init(id: roomId), query: .init(cursor: cursor, limit: threadListPageLimit),
                                                                 headers: .init(xOrganizationSlug: organizationSlug)))
    switch response {
    case let .ok(value):
      let payload = try value.body.json
      return (payload.data, payload.meta.pagination.nextCursor)
    case let .unauthorized(value): throw try unauthorized(value.body.json.message)
    case let .forbidden(value): throw try rejected(status: 403, message: value.body.json.message)
    case let .notFound(value): throw try rejected(status: 404, message: value.body.json.message)
    case let .unprocessableContent(value): throw try rejected(status: 422, message: value.body.json.message)
    case let .tooManyRequests(value): throw try rejected(status: 429, message: value.body.json.message)
    case let .internalServerError(value): throw try rejected(status: 500, message: value.body.json.message)
    case let .undocumented(statusCode, payload): throw await unprocessableError(statusCode: statusCode, payload: payload)
    }
  }

  func countUnreadThreads(client: Client, roomId: String, organizationSlug: String?) async throws -> Int {
    let response = try await client.getChatsRoomsIdThreadsUnreadCount(.init(path: .init(id: roomId), headers: .init(xOrganizationSlug: organizationSlug)))
    switch response {
    case let .ok(value):
      return try value.body.json.data.count
    case let .unauthorized(value): throw try unauthorized(value.body.json.message)
    case let .forbidden(value): throw try rejected(status: 403, message: value.body.json.message)
    case let .notFound(value): throw try rejected(status: 404, message: value.body.json.message)
    case let .unprocessableContent(value): throw try rejected(status: 422, message: value.body.json.message)
    case let .internalServerError(value): throw try rejected(status: 500, message: value.body.json.message)
    case let .undocumented(statusCode, payload): throw await unprocessableError(statusCode: statusCode, payload: payload)
    }
  }

  func markAllThreadsRead(client: Client, roomId: String, organizationSlug: String?) async throws {
    let response = try await client.postChatsRoomsIdThreadsRead(.init(path: .init(id: roomId), headers: .init(xOrganizationSlug: organizationSlug)))
    switch response {
    case let .ok(value):
      _ = try value.body.json.data
      return
    case let .unauthorized(value): throw try unauthorized(value.body.json.message)
    case let .forbidden(value): throw try rejected(status: 403, message: value.body.json.message)
    case let .notFound(value): throw try rejected(status: 404, message: value.body.json.message)
    case let .internalServerError(value): throw try rejected(status: 500, message: value.body.json.message)
    case let .undocumented(statusCode, payload): throw await unprocessableError(statusCode: statusCode, payload: payload)
    }
  }
}
