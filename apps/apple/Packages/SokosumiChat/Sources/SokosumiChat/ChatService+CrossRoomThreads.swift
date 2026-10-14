import CoreAPI

/// The chat-level Threads view's two reads (row 24f1, SOK-1159): web's `listUnreadThreads` and
/// `listEarlierThreads`, 50 per page like the room's own thread list. Core scopes both to the rooms the
/// sidebar lists for the reader in this workspace, less the rooms they muted.
public extension ChatService {
  func listUnreadThreads(client: Client, cursor: String? = nil, organizationSlug: String?) async throws
    -> (items: [Components.Schemas.ChatUnreadThread], nextCursor: String?) {
    let value = try await call {
      try await client.getChatsThreadsUnread(.init(query: .init(cursor: cursor, limit: threadListPageLimit),
                                                   headers: .init(xOrganizationSlug: organizationSlug)))
    }.ok
    let payload = try value.body.json
    return (payload.data, payload.meta.pagination.nextCursor)
  }

  func listEarlierThreads(client: Client, cursor: String? = nil, organizationSlug: String?) async throws
    -> (items: [Components.Schemas.ChatEarlierThread], nextCursor: String?) {
    let value = try await call {
      try await client.getChatsThreadsEarlier(.init(query: .init(cursor: cursor, limit: threadListPageLimit),
                                                    headers: .init(xOrganizationSlug: organizationSlug)))
    }.ok
    let payload = try value.body.json
    return (payload.data, payload.meta.pagination.nextCursor)
  }
}
