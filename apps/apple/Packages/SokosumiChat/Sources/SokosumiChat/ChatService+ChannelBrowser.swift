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
      let value = try await call {
        try await client.getChatsRoomsDiscoverable(.init(
          query: .init(cursor: cursor, limit: Self.roomListLimit, q: query.isEmpty ? nil : query),
          headers: .init(xOrganizationSlug: organizationSlug)
        ))
      }.ok
      let payload = try value.body.json
      rooms.append(contentsOf: payload.data)
      guard let next = payload.meta.pagination.nextCursor, seenCursors.insert(next).inserted else { return rooms }
      cursor = next
    }
    return rooms
  }

  func joinChannel(client: Client, roomId: String, organizationSlug: String) async throws -> Components.Schemas.ChatRoom {
    try await call { try await client.postChatsRoomsIdMembersMe(.init(path: .init(id: roomId), headers: .init(xOrganizationSlug: organizationSlug))) }.ok.body.json.data
  }
}
