import CoreAPI
import Foundation
import OpenAPIRuntime

public extension ChatService {
  func channelRoster(client: Client, organizationId: String, organizationSlug: String) async throws -> ChannelRoster {
    async let recipients = chatRecipients(client: client, organizationId: organizationId, organizationSlug: organizationSlug)
    // Web `rooms/[roomId]/page.tsx` treats a failed membership read as not owner or admin.
    let isOwnerOrAdmin = try await organizationOwnerOrAdminIfReadable(client: client, organizationId: organizationId)
    return try await .init(recipients: recipients, isOwnerOrAdmin: isOwnerOrAdmin == true, roleLoadFailed: isOwnerOrAdmin == nil)
  }

  /// `isOrganizationOwnerOrAdmin`, or `nil` when the read failed: web's room page and sidebar both treat a failed
  /// membership read as not owner or admin. A 401 is the session ending (the coordinator signs out),
  /// `CoreUpdateRequired` is a build Core turned away, and cancellation is the caller leaving, so all three still throw.
  func organizationOwnerOrAdminIfReadable(client: Client, organizationId: String) async throws -> Bool? {
    do {
      return try await isOrganizationOwnerOrAdmin(client: client, organizationId: organizationId)
    } catch {
      if case ChatServiceError.unauthorized = error {
        throw error
      }
      if updateRequired(in: error) != nil {
        throw error
      }
      try Task.checkCancellation()
      // OpenAPI wraps transport/middleware cancellation and response decoding errors in ClientError.
      let clientError = error as? ClientError
      let cause = clientError?.underlyingError ?? error
      let networkError = cause as NSError
      if cause is CancellationError || (networkError.domain == NSURLErrorDomain && networkError.code == URLError.cancelled.rawValue) {
        throw CancellationError()
      }
      return nil
    }
  }

  /// The caller's organization role gates channel settings, archive, restore and delete; a missing membership is not elevated.
  func isOrganizationOwnerOrAdmin(client: Client, organizationId: String) async throws -> Bool {
    do {
      let role = try await call {
        try await client.getUsersIdOrganizationsOrganizationIdMember(.init(path: .init(id: "me", organizationId: organizationId)))
      }.ok.body.json.data.role
      return role == .owner || role == .admin
    } catch ChatServiceError.unprocessable(404, _, _) {
      return false
    }
  }

  func channelSlugIsAvailable(client: Client, slug: String, organizationSlug: String) async throws -> Bool {
    try await call { try await client.getChatsRoomsChannelSlugAvailability(.init(query: .init(slug: slug), headers: .init(xOrganizationSlug: organizationSlug))) }.ok.body.json.data.status == .free
  }

  func createChannel(client: Client, draft: ChannelDraft, roster: ChatRecipientRoster, currentUserId: String, organizationSlug: String) async throws -> Components.Schemas.ChatRoom {
    guard draft.isValid, !roster.humansLoadFailed else { throw ChatServiceError.unexpectedResponse("Complete the channel details and load participants first.") }
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
