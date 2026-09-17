import CoreAPI
import Foundation

public extension ChatService {
  func channelRoster(client: Client, organizationId: String, organizationSlug: String) async throws -> ChannelRoster {
    async let recipients = chatRecipients(client: client, organizationId: organizationId, organizationSlug: organizationSlug)
    let isOwnerOrAdmin = try await isOrganizationOwnerOrAdmin(client: client, organizationId: organizationId)
    return try await .init(recipients: recipients, isOwnerOrAdmin: isOwnerOrAdmin)
  }

  /// The caller's organization role gates channel settings, archive, restore and delete; a missing membership is not elevated.
  func isOrganizationOwnerOrAdmin(client: Client, organizationId: String) async throws -> Bool {
    let response = try await client.getUsersIdOrganizationsOrganizationIdMember(.init(path: .init(id: "me", organizationId: organizationId)))
    switch response {
    case let .ok(value):
      let role = try value.body.json.data.role
      return role == .owner || role == .admin
    case let .unauthorized(value): throw try ChatServiceError.unauthorized(value.body.json.message)
    case let .forbidden(value): throw try ChatServiceError.unprocessable(statusCode: 403, message: value.body.json.message)
    case .notFound: return false
    case let .internalServerError(value): throw try ChatServiceError.unprocessable(statusCode: 500, message: value.body.json.message)
    case let .undocumented(statusCode, payload): throw await unprocessableError(statusCode: statusCode, payload: payload)
    }
  }

  func channelSlugIsAvailable(client: Client, slug: String, organizationSlug: String) async throws -> Bool {
    let response = try await client.getChatsRoomsChannelSlugAvailability(.init(query: .init(slug: slug), headers: .init(xOrganizationSlug: organizationSlug)))
    switch response {
    case let .ok(value): return try value.body.json.data.status == .free
    case let .badRequest(value): throw try ChatServiceError.unprocessable(statusCode: 400, message: value.body.json.message)
    case let .unauthorized(value): throw try ChatServiceError.unauthorized(value.body.json.message)
    case let .forbidden(value): throw try ChatServiceError.unprocessable(statusCode: 403, message: value.body.json.message)
    case let .notFound(value): throw try ChatServiceError.unprocessable(statusCode: 404, message: value.body.json.message)
    case let .internalServerError(value): throw try ChatServiceError.unprocessable(statusCode: 500, message: value.body.json.message)
    case let .undocumented(statusCode, payload): throw await unprocessableError(statusCode: statusCode, payload: payload)
    }
  }

  func createChannel(client: Client, draft: ChannelDraft, roster: ChatRecipientRoster, currentUserId: String, organizationSlug: String) async throws -> Components.Schemas.ChatRoom {
    guard draft.isValid, !roster.membersLoadFailed else { throw ChatServiceError.unexpectedResponse("Complete the channel details and load participants first.") }
    let recipients = draft.selectedRecipients(roster: roster, currentUserId: currentUserId)
    let topic = draft.topic.trimmingCharacters(in: .whitespacesAndNewlines)
    let body = Components.Schemas.CreateChatRoomRequest.Case1Payload(
      kind: .channel, name: draft.name.trimmingCharacters(in: .whitespacesAndNewlines), slug: draft.canonicalSlug,
      topic: topic.isEmpty ? nil : topic, discoverability: .init(rawValue: draft.visibility.rawValue),
      memberUserIds: recipients.compactMap {
        if case let .human(id) = $0 {
          id
        } else {
          nil
        }
      },
      coworkerIds: recipients.compactMap {
        if case let .coworker(id) = $0 {
          id
        } else {
          nil
        }
      },
      sokoBotIds: recipients.compactMap {
        if case let .sokoBot(id) = $0 {
          id
        } else {
          nil
        }
      }
    )
    return try await createRoom(client: client, body: .case1(body), organizationSlug: organizationSlug)
  }
}
