import Foundation

// User notifications wire contract (ADR 0003 / 0014), mirroring web
// `use-notification-realtime`, `lib/ably/schema.ts` and `@sokosumi/utils`
// `ably-channel.ts`. Core publishes every notification row on one per-user
// channel; this client only reads the chat kind. No push (ADR 0022 / 0023).

public let notificationCreatedEventName = "notification_created"

private let chatMentionMessageKey = "Notifications.Chat.mentioned"
private let chatDirectMessageMessageKey = "Notifications.Chat.directMessage"
private let chatRoomMessageMessageKey = "Notifications.Chat.roomMessage"

/// The user notifications channel this token may subscribe, read from the
/// capability rather than built: Core names it per deployment
/// (`notifications:all:user_{id}` in production, a branch-scoped name on
/// previews). Nil when the grant is missing: never attach on a guess.
public func userNotificationsChannelName(grantedSubscribeIn capability: String?, userId: String) -> String? {
  guard !userId.isEmpty, let capability, let data = capability.data(using: .utf8),
        let map = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
  return map.compactMap { channel, operations -> String? in
    guard channel.hasPrefix("notifications:"), channel.hasSuffix(":user_\(userId)"),
          let operations = operations as? [Any],
          operations.contains(where: { $0 as? String == "subscribe" || $0 as? String == "*" }) else { return nil }
    return channel
  }.min()
}

/// One chat notification event (web `notificationEventDataSchema`, kind CHAT).
public struct ChatNotificationEvent: Equatable, Sendable {
  public var id: String
  /// The room the notification is about (`referenceId`).
  public var roomId: String
  public var messageKey: String
  public var authorName: String?
  public var roomName: String?
  public var isGroup: Bool
  public var isDirect: Bool
  public var messagePreview: String?
  /// `metadata.messageId`, trimmed; nil opens the room without a jump.
  public var messageId: String?
  /// `metadata.workspaceId`; nil navigates without a workspace switch.
  public var workspaceId: String?
  public var isRead: Bool
  public var readAt: Date?
  public var createdAt: Date?
  /// The reader's OS-banner choice for this category, resolved by Core
  /// together with the account-wide consent. True when an older Core omits it.
  public var osBanner: Bool
  /// Messages waiting in the room; the banner that replaces the standing one says how many it stands for.
  public var groupCount: Int?

  public init(
    id: String, roomId: String, messageKey: String, authorName: String? = nil, roomName: String? = nil,
    isGroup: Bool = false, isDirect: Bool = false, messagePreview: String? = nil, messageId: String? = nil,
    workspaceId: String? = nil, isRead: Bool = false, readAt: Date? = nil, createdAt: Date? = nil,
    osBanner: Bool = true, groupCount: Int? = nil
  ) {
    self.id = id
    self.roomId = roomId
    self.messageKey = messageKey
    self.authorName = authorName
    self.roomName = roomName
    self.isGroup = isGroup
    self.isDirect = isDirect
    self.messagePreview = messagePreview
    self.messageId = messageId
    self.workspaceId = workspaceId
    self.isRead = isRead
    self.readAt = readAt
    self.createdAt = createdAt
    self.osBanner = osBanner
    self.groupCount = groupCount
  }

  /// Decodes an Ably payload with web's schema rules. Nil for a malformed
  /// payload and for every kind but CHAT (jobs, tasks and access requests
  /// belong to web's Notification Center, which is out of scope).
  public init?(payload: Any) {
    guard let dict = payload as? [String: Any],
          let id = dict["id"] as? String, dict["userId"] is String,
          dict["kind"] as? String == "CHAT",
          let roomId = dict["referenceId"] as? String, !roomId.isEmpty,
          dict["eventId"] is String,
          let messageKey = dict["messageKey"] as? String,
          let params = dict["messageParams"] as? [String: Any],
          dict["metadata"] is NSNull || dict["metadata"] is [String: Any],
          let isRead = strictBool(dict["isRead"]),
          dict["readAt"] is NSNull || dict["readAt"] is String,
          let createdAt = dict["createdAt"] as? String else { return nil }
    var osBanner = true
    if let raw = dict["osBanner"] {
      guard let value = strictBool(raw) else { return nil }
      osBanner = value
    }
    var groupCount: Int?
    if let raw = dict["groupCount"] {
      guard let number = raw as? NSNumber, strictBool(raw) == nil,
            number.doubleValue == Double(number.intValue), number.intValue >= 1 else { return nil }
      groupCount = number.intValue
    }
    let metadata = dict["metadata"] as? [String: Any]
    let messageId = (metadata?["messageId"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
    let workspaceId = metadata?["workspaceId"] as? String
    self.init(
      id: id, roomId: roomId, messageKey: messageKey,
      authorName: params["authorName"] as? String, roomName: params["roomName"] as? String,
      isGroup: strictBool(params["isGroup"]) == true, isDirect: strictBool(params["isDirect"]) == true,
      messagePreview: params["messagePreview"] as? String,
      messageId: messageId?.isEmpty == false ? messageId : nil,
      workspaceId: workspaceId?.isEmpty == false ? workspaceId : nil,
      isRead: isRead, readAt: (dict["readAt"] as? String).flatMap(notificationDate), createdAt: notificationDate(createdAt),
      osBanner: osBanner, groupCount: groupCount
    )
  }

  /// One banner holds a whole room (web `notificationGroupTag`): each arrival replaces the one standing.
  public static func bannerIdentifier(roomId: String) -> String {
    "sokosumi-room:\(roomId)"
  }

  public var bannerIdentifier: String {
    Self.bannerIdentifier(roomId: roomId)
  }

  public var target: ChatNotificationTarget {
    .init(id: id, roomId: roomId, messageId: messageId, workspaceId: workspaceId, createdAt: createdAt)
  }

  /// What the banner says (web `buildNotificationBannerContent` with the
  /// room count overriding the row's own). A chat message is titled with who
  /// wrote and where, with the preview underneath; a banner that stands for
  /// several arrivals uses the app name and the room's count instead.
  public var banner: ChatNotificationBanner {
    let author = authorName ?? ""
    let room = roomName ?? ""
    let countable = [chatDirectMessageMessageKey, chatMentionMessageKey, chatRoomMessageMessageKey].contains(messageKey)
    let pair = messageKey == chatMentionMessageKey && isDirect
    if let count = groupCount, count > 1, countable {
      let body = if messageKey == chatDirectMessageMessageKey || pair {
        "\(count) messages from \(author)"
      } else {
        "\(count) messages in \(isGroup ? "group" : "channel") \(room)"
      }
      return .init(identifier: bannerIdentifier, title: chatNotificationAppTitle, body: body, target: target)
    }
    if countable, !author.isEmpty {
      let title: String = if messageKey == chatDirectMessageMessageKey || pair || room.trimmingCharacters(in: .whitespaces).isEmpty {
        author
      } else if messageKey == chatMentionMessageKey {
        "\(author) mentioned you in \(room)"
      } else {
        "\(author) in \(isGroup ? "group" : "channel") \(room)"
      }
      return .init(identifier: bannerIdentifier, title: title, body: localizedMentionAll(messagePreview ?? ""), target: target)
    }
    return .init(identifier: bannerIdentifier, title: chatNotificationAppTitle, body: line, target: target)
  }

  /// The notification's own sentence (web `Library.Notifications.Chat.*`).
  private var line: String {
    let author = authorName ?? ""
    let room = roomName ?? ""
    switch messageKey {
    case chatMentionMessageKey:
      return isDirect ? "\(author) mentioned you in a direct message" : "\(author) mentioned you in \(room)"
    case chatDirectMessageMessageKey:
      return "\(author) sent you a message"
    case chatRoomMessageMessageKey:
      return "\(author) wrote in \(isGroup ? "group" : "channel") \(room)"
    case "Notifications.Chat.mentionedFollowUp":
      return isDirect ? "\(author) is still waiting for your reply" : "\(author) is still waiting for you in \(room)"
    case "Notifications.Chat.directMessageFollowUp":
      return "\(author) is still waiting for your reply"
    default:
      return "You have a new chat notification"
    }
  }
}

private let chatNotificationAppTitle = "Sokosumi"

/// What a banner routes to when opened (web `NotificationTarget`, chat fields only).
public struct ChatNotificationTarget: Equatable, Sendable {
  public var id: String
  public var roomId: String
  public var messageId: String?
  public var workspaceId: String?
  public var createdAt: Date?

  public init(id: String, roomId: String, messageId: String? = nil, workspaceId: String? = nil, createdAt: Date? = nil) {
    self.id = id
    self.roomId = roomId
    self.messageId = messageId
    self.workspaceId = workspaceId
    self.createdAt = createdAt
  }

  /// Property-list form for the OS notification's `userInfo`.
  public var userInfo: [String: String] {
    var info = ["id": id, "roomId": roomId]
    info["messageId"] = messageId
    info["workspaceId"] = workspaceId
    return info
  }

  public init?(userInfo: [AnyHashable: Any]) {
    guard let id = userInfo["id"] as? String, !id.isEmpty,
          let roomId = userInfo["roomId"] as? String, !roomId.isEmpty else { return nil }
    self.init(id: id, roomId: roomId, messageId: userInfo["messageId"] as? String, workspaceId: userInfo["workspaceId"] as? String)
  }
}

public struct ChatNotificationBanner: Equatable, Sendable {
  public var identifier: String
  public var title: String
  public var body: String
  public var target: ChatNotificationTarget

  public init(identifier: String, title: String, body: String, target: ChatNotificationTarget) {
    self.identifier = identifier
    self.title = title
    self.body = body
    self.target = target
  }
}

/// JSON booleans only: `NSNumber` also bridges 0/1, which web's `z.boolean()` rejects.
private func strictBool(_ value: Any?) -> Bool? {
  guard let number = value as? NSNumber, CFGetTypeID(number) == CFBooleanGetTypeID() else { return nil }
  return number.boolValue
}

private func notificationDate(_ string: String) -> Date? {
  (try? Date.ISO8601FormatStyle(includingFractionalSeconds: true).parse(string)) ?? (try? Date.ISO8601FormatStyle().parse(string))
}

/// The stored preview keeps the room-wide mention as the neutral `@all`
/// (web `localizeChatMentionAllPreview`); word-bounded so `@allison` stays.
private func localizedMentionAll(_ preview: String) -> String {
  preview.replacing(#/(^|\s)@all(?=$|[\s.,!?;\u{2026}])/#) { "\($0.output.1)@Everyone" }
}
