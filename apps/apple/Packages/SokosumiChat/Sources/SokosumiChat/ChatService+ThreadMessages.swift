import CoreAPI
import Foundation

public extension ChatService {
  func listThreadMessages(
    client: Client, roomId: String, parentMessageId: String,
    cursor: String? = nil,
    around: String? = nil,
    organizationSlug: String?
  ) async throws -> (messages: [Components.Schemas.ChatRoomMessage], nextCursor: String?) {
    let value = try await call {
      try await client.getChatsRoomsIdThreadsParentMessageIdMessages(
        .init(path: .init(id: roomId, parentMessageId: parentMessageId),
              query: .init(cursor: cursor, limit: around == nil ? 100 : 30, around: around),
              headers: .init(xOrganizationSlug: organizationSlug))
      )
    }.ok
    let payload = try value.body.json
    return (payload.data, payload.meta.pagination.nextCursor)
  }

  func markThreadRead(
    client: Client, roomId: String, parentMessageId: String,
    organizationSlug: String?
  ) async throws -> Components.Schemas.ChatRoomThreadReadState {
    try await call {
      try await client.postChatsRoomsIdThreadsParentMessageIdRead(
        .init(path: .init(id: roomId, parentMessageId: parentMessageId),
              headers: .init(xOrganizationSlug: organizationSlug))
      )
    }.ok.body.json.data
  }
}
