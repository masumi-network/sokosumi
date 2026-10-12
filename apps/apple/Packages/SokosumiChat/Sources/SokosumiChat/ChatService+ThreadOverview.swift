import CoreAPI

/// Web's `THREAD_LIST_PAGE_LIMIT`, sent on the first page and every older one; Core's default is 20.
let threadListPageLimit = 50

public extension ChatService {
  func listThreads(client: Client, roomId: String, cursor: String? = nil, organizationSlug: String?) async throws -> (items: [Components.Schemas.ChatRoomThread], nextCursor: String?) {
    let value = try await call {
      try await client.getChatsRoomsIdThreads(.init(path: .init(id: roomId), query: .init(cursor: cursor, limit: threadListPageLimit),
                                                    headers: .init(xOrganizationSlug: organizationSlug)))
    }.ok
    let payload = try value.body.json
    return (payload.data, payload.meta.pagination.nextCursor)
  }

  /// Web's `listUnreadThreadReplyCountsAction`: every unread Thread in the room with its unread replies, keyed
  /// by parent message id. A Thread absent from the answer has none for this reader.
  func listUnreadThreadReplyCounts(client: Client, roomId: String, organizationSlug: String?) async throws -> [String: Int] {
    let value = try await call { try await client.getChatsRoomsIdThreadsUnreadCount(.init(path: .init(id: roomId), headers: .init(xOrganizationSlug: organizationSlug))) }.ok
    return try Dictionary(value.body.json.data.threads.map { ($0.parentMessageId, $0.unreadReplyCount) }, uniquingKeysWith: { _, latest in latest })
  }

  func markAllThreadsRead(client: Client, roomId: String, organizationSlug: String?) async throws {
    let value = try await call { try await client.postChatsRoomsIdThreadsRead(.init(path: .init(id: roomId), headers: .init(xOrganizationSlug: organizationSlug))) }.ok
    _ = try value.body.json.data
  }
}
