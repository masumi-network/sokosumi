import CoreAPI
import Foundation
import OpenAPIRuntime

/// First-page size for room history. Matches web's `ROOM_MESSAGE_LIMIT` so
/// the Mac tracer pages the same transcript as the browser.
private let roomHistoryLimit = 100

/// Display name for a transcript row sender, mirroring `roomDisplayName`'s
/// human rule (name, else email). Plain text only — no mention chips.
public func messageSenderName(_ sender: Components.Schemas.ChatRoomMessageSender) -> String {
  switch sender {
  case let .case1(user):
    user.user.name.isEmpty ? user.user.email : user.user.name
  case let .case2(coworker):
    coworker.coworker.name
  case let .case3(bot):
    bot.sokoBot.name
  case .case4:
    "Unknown"
  }
}

/// The sender's photo, when Core has one; the avatar falls back to initials.
public func messageSenderImage(_ sender: Components.Schemas.ChatRoomMessageSender) -> String? {
  switch sender {
  case let .case1(user): user.user.image
  case let .case2(coworker): coworker.coworker.image
  case let .case3(bot): bot.sokoBot.image
  case .case4: nil
  }
}

/// One room messages page as `listRoomMessages` reads it.
struct RoomMessagesPage {
  var messages: [Components.Schemas.ChatRoomMessage]
  var nextCursor: String?
  var firstUnreadMessageId: String?
  var isUnreadWindow = false
}

public extension ChatService {
  /// One history page in reading order (oldest first). An empty room
  /// resolves empty — never an error. Nil slug omits the org header
  /// (personal); a slug sends `X-Organization-Slug`.
  func listMessages(
    client: Client,
    roomId: String,
    cursor: String? = nil,
    around: String? = nil,
    limit: Int? = nil,
    query: String? = nil,
    organizationSlug: String?
  ) async throws -> (messages: [Components.Schemas.ChatRoomMessage], nextCursor: String?) {
    let page = try await listRoomMessages(client: client, roomId: roomId, cursor: cursor, around: around, limit: limit, query: query,
                                          organizationSlug: organizationSlug)
    return (page.messages, page.nextCursor)
  }

  /// `listMessages` with what Core says about the Unread divider: the first unread message (nil with no Room unread,
  /// and on cursor and search pages), and whether `openAtUnread` answered with the window around an older divider
  /// instead of the newest page. That window holds fewer rows than the newest page would (3 above the divider and
  /// 30 from it, against a page of 100 in a room with more).
  internal func listRoomMessages(
    client: Client,
    roomId: String,
    cursor: String? = nil,
    around: String? = nil,
    limit: Int? = nil,
    query: String? = nil,
    openAtUnread: Bool = false,
    organizationSlug: String?
  ) async throws -> RoomMessagesPage {
    let pageLimit = limit ?? roomHistoryLimit
    let okResponse = try await call {
      try await client.getChatsRoomsIdMessages(
        .init(
          path: .init(id: roomId),
          query: .init(cursor: cursor, limit: pageLimit, q: query, around: around, openAtUnread: openAtUnread ? ._true : nil),
          headers: .init(xOrganizationSlug: organizationSlug)
        )
      )
    }.ok
    let payload = try okResponse.body.json
    let pagination = payload.meta.pagination
    let firstUnread = pagination.firstUnreadMessageId
    return RoomMessagesPage(
      messages: payload.data, nextCursor: pagination.nextCursor, firstUnreadMessageId: firstUnread,
      isUnreadWindow: openAtUnread && firstUnread != nil && payload.data.count < min(pagination.total, pageLimit)
    )
  }

  /// `POST /chats/rooms/{id}/read`. Returns the updated room DTO — the
  /// caller replaces its list entry so unread chrome matches Core.
  func markRoomRead(
    client: Client,
    roomId: String,
    organizationSlug: String?
  ) async throws -> Components.Schemas.ChatRoom {
    try await call {
      try await client.postChatsRoomsIdRead(
        .init(
          path: .init(id: roomId),
          headers: .init(xOrganizationSlug: organizationSlug)
        )
      )
    }.ok.body.json.data
  }

  func markRoomUnread(
    client: Client,
    roomId: String,
    organizationSlug: String?
  ) async throws -> Components.Schemas.ChatRoom {
    try await call {
      try await client.postChatsRoomsIdUnread(
        .init(
          path: .init(id: roomId),
          headers: .init(xOrganizationSlug: organizationSlug)
        )
      )
    }.ok.body.json.data
  }

  /// `POST /chats/rooms/{id}/messages` with `content` and a client turn id.
  /// Retry of a failed send reuses that id so Core keeps one row. `skillIds` names the skills.sh skills
  /// attached to the message (row 42); Core answers 400 for one it cannot read.
  func createMessage(
    client: Client,
    roomId: String,
    content: String,
    clientMessageId: String,
    parentMessageId: String? = nil,
    mentions: [ComposerMention] = [],
    quote: Components.Schemas.ChatRoomMessageQuote? = nil,
    skillIds: [String] = [],
    organizationSlug: String?
  ) async throws -> Components.Schemas.ChatRoomMessage {
    try await call {
      try await client.postChatsRoomsIdMessages(
        .init(
          path: .init(id: roomId),
          headers: .init(xOrganizationSlug: organizationSlug),
          body: .json(.init(content: content,
                            mentionedCoworkerIds: mentions.filter { $0.kind == .coworker }.map(\.id),
                            mentionedSokoBotIds: mentions.filter { $0.kind == .sokoBot }.map(\.id),
                            mentionedUserIds: mentions.filter { $0.kind == .human }.map(\.id),
                            parentMessageId: parentMessageId,
                            quote: quote.map { .init(messageId: $0.messageId, roomId: $0.roomId) },
                            clientMessageId: clientMessageId,
                            skillIds: skillIds.isEmpty ? nil : skillIds))
        )
      )
    }.created.body.json.data
  }
}
