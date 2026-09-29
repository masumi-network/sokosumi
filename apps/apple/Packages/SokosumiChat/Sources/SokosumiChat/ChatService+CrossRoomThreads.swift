import CoreAPI

/// The chat-level Threads view's two reads (row 24f1, SOK-1159): web's `listUnreadThreads` and
/// `listEarlierThreads`, 50 per page like the room's own thread list. Core scopes both to the rooms the
/// sidebar lists for the reader in this workspace, less the rooms they muted.
public extension ChatService {
  func listUnreadThreads(client: Client, cursor: String? = nil, organizationSlug: String?) async throws
    -> (items: [Components.Schemas.ChatUnreadThread], nextCursor: String?) {
    let response = try await client.getChatsThreadsUnread(.init(query: .init(cursor: cursor, limit: threadListPageLimit),
                                                                headers: .init(xOrganizationSlug: organizationSlug)))
    switch response {
    case let .ok(value):
      let payload = try value.body.json
      return (payload.data, payload.meta.pagination.nextCursor)
    case let .badRequest(value): throw try rejected(status: 400, message: value.body.json.message)
    case let .unauthorized(value): throw try unauthorized(value.body.json.message)
    case let .forbidden(value): throw try rejected(status: 403, message: value.body.json.message)
    case let .internalServerError(value): throw try rejected(status: 500, message: value.body.json.message)
    case let .undocumented(statusCode, payload): throw await unprocessableError(statusCode: statusCode, payload: payload)
    }
  }

  func listEarlierThreads(client: Client, cursor: String? = nil, organizationSlug: String?) async throws
    -> (items: [Components.Schemas.ChatEarlierThread], nextCursor: String?) {
    let response = try await client.getChatsThreadsEarlier(.init(query: .init(cursor: cursor, limit: threadListPageLimit),
                                                                 headers: .init(xOrganizationSlug: organizationSlug)))
    switch response {
    case let .ok(value):
      let payload = try value.body.json
      return (payload.data, payload.meta.pagination.nextCursor)
    case let .badRequest(value): throw try rejected(status: 400, message: value.body.json.message)
    case let .unauthorized(value): throw try unauthorized(value.body.json.message)
    case let .forbidden(value): throw try rejected(status: 403, message: value.body.json.message)
    case let .internalServerError(value): throw try rejected(status: 500, message: value.body.json.message)
    case let .undocumented(statusCode, payload): throw await unprocessableError(statusCode: statusCode, payload: payload)
    }
  }
}
