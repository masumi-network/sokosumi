import CoreAPI
import Foundation

/// A single participant target; mixed rosters and synthetic @all are not Direct targets.
public enum DirectRecipient: Hashable, Sendable {
  case human(String)
  case coworker(String)
  case sokoBot(String)

  /// Offered from any workspace; Core decides whether the person is reachable.
  public func canOpen(from room: Components.Schemas.ChatRoom, currentUserId: String) -> Bool {
    switch self {
    case let .human(id):
      id != currentUserId && room.userMembers.contains { $0.id == id }
    case let .coworker(id): room.coworkerMembers.contains { $0.id == id }
    case let .sokoBot(id): room.sokoBotMembers.contains { $0.id == id }
    }
  }

  fileprivate var requestBody: Components.Schemas.CreateChatRoomRequest.Case2Payload {
    var body = Components.Schemas.CreateChatRoomRequest.Case2Payload(kind: .direct)
    switch self {
    case let .human(id): body.memberUserIds = [id]
    case let .coworker(id): body.coworkerIds = [id]
    case let .sokoBot(id): body.sokoBotIds = [id]
    }
    return body
  }
}

public extension ChatService {
  /// Core creates the Direct or returns the existing room. Eligibility remains server-owned.
  func openDirect(client: Client, selection: DirectConversationSelection, organizationSlug: String?) async throws -> Components.Schemas.ChatRoom {
    guard let first = selection.recipients.first else {
      throw ChatServiceError.unexpectedResponse("Choose a direct message target.")
    }
    var body = first.requestBody
    if case .human = first {
      body.memberUserIds = selection.recipients.compactMap {
        if case let .human(id) = $0 {
          return id
        }
        return nil
      }
    }
    return try await createRoom(client: client, body: .case2(body), organizationSlug: organizationSlug)
  }

  internal func createRoom(
    client: Client,
    body: Components.Schemas.CreateChatRoomRequest,
    organizationSlug: String?
  ) async throws -> Components.Schemas.ChatRoom {
    do {
      let response = try await call { try await client.postChatsRooms(.init(headers: .init(xOrganizationSlug: organizationSlug), body: .json(body))) }
      switch response {
      case let .created(value): return try value.body.json.data
      default: return try response.ok.body.json.data
      }
    } catch let error as ChatServiceError {
      if case .case1 = body, case let .unprocessable(409, _, kind) = error, kind == "channel_slug_taken" {
        throw ChannelCreationError.slugTaken
      }
      throw error
    }
  }
}
