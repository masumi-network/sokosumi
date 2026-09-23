import CoreAPI
import Foundation

// Org presence wire contract (ADR 0003), mirroring `@sokosumi/utils`
// `chat-presence.ts` / `ably-channel.ts` and web's presence hooks.
//
// Humans enter Ably Presence on `presence:org_{organizationId}` for the
// active organization only, as `{userId}:{instanceId}` members carrying
// `lastActiveAt` / `visible`. Readers aggregate every member of one user:
// any device online → online; any device connected otherwise → afk; none →
// offline. Coworkers and Soko Bots stay always-online (ADR 0003 v1).

/// Connected + activity inside this window → online; connected otherwise → afk.
private let chatPresenceOnlineWindow: TimeInterval = 5 * 60

/// Activity refreshes `lastActiveAt` just inside the online window so a
/// throttled refresh lands before teammates age this client to afk.
private let orgPresencePublishMinInterval: TimeInterval = chatPresenceOnlineWindow - 60

private let orgPresenceChannelPrefix = "presence:org_"

/// Org-scoped Ably Presence channel (`presence:org_{organizationId}`).
public func orgPresenceChannelName(organizationId: String) -> String {
  orgPresenceChannelPrefix + organizationId
}

/// Inverse of `orgPresenceChannelName`. Nil for other channels or an empty id.
public func parseOrganizationId(fromPresenceChannelName channelName: String) -> String? {
  guard channelName.hasPrefix(orgPresenceChannelPrefix) else { return nil }
  let organizationId = String(channelName.dropFirst(orgPresenceChannelPrefix.count))
  return organizationId.isEmpty ? nil : organizationId
}

/// User id from a presence member's `{userId}:{instanceId}` client id. Malformed
/// ids are rejected so a free-form client id cannot spoof another user.
public func parseUserId(fromAblyPresenceClientId clientId: String) -> String? {
  guard let separator = clientId.firstIndex(of: ":"), separator > clientId.startIndex else { return nil }
  let userId = String(clientId[..<separator])
  let instanceId = String(clientId[clientId.index(after: separator)...])
  guard !userId.isEmpty, isValidRealtimeClientInstanceId(instanceId) else { return nil }
  return userId
}

/// Organization ids whose `presence:org_*` channel the token grants `presence`
/// on. Nil when the capability is missing or malformed: never attach on a
/// guess, Ably answers a bare attach with capability-denied failures.
public func organizationIds(grantedPresenceIn capability: String?) -> [String]? {
  guard let capability, let data = capability.data(using: .utf8),
        let map = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
  return map.compactMap { channel, operations in
    guard let operations = operations as? [Any],
          operations.contains(where: { $0 as? String == "presence" }) else { return nil }
    return parseOrganizationId(fromPresenceChannelName: channel)
  }.sorted()
}

/// Wire data on one presence member.
public struct ChatPresenceMemberData: Equatable, Sendable {
  /// Last user activity on that connection.
  public var lastActiveAt: Date
  /// False while the client is hidden → afk even when recently active.
  public var visible: Bool

  public init(lastActiveAt: Date, visible: Bool) {
    self.lastActiveAt = lastActiveAt
    self.visible = visible
  }

  /// Decodes `{ lastActiveAt: epochMillis, visible: bool }`; nil for anything else.
  public init?(wire: Any?) {
    guard let dictionary = wire as? [String: Any],
          let millis = dictionary["lastActiveAt"] as? NSNumber, millis.doubleValue.isFinite,
          let visible = dictionary["visible"] as? NSNumber,
          // Booleans and numbers bridge both ways; keep web's typeof split.
          CFGetTypeID(millis) != CFBooleanGetTypeID(),
          CFGetTypeID(visible) == CFBooleanGetTypeID()
    else {
      return nil
    }
    lastActiveAt = Date(timeIntervalSince1970: millis.doubleValue / 1000)
    self.visible = visible.boolValue
  }

  /// JSON-ready payload in the shape web publishes (epoch milliseconds).
  public var wire: [String: Any] {
    ["lastActiveAt": Int(lastActiveAt.timeIntervalSince1970 * 1000), "visible": visible]
  }
}

/// One presence member as read from the org channel.
public struct ChatPresenceMember: Equatable, Sendable {
  public var clientId: String
  /// Nil when the member published no readable data; still counts as connected.
  public var data: ChatPresenceMemberData?

  public init(clientId: String, data: ChatPresenceMemberData?) {
    self.clientId = clientId
    self.data = data
  }
}

/// Aggregates multi-device members into per-user online/afk. Users absent
/// from the result are offline (callers fall back to the room DTO value).
public func aggregateChatPresence(
  members: [ChatPresenceMember],
  now: Date = Date(),
  onlineWindow: TimeInterval = chatPresenceOnlineWindow
) -> [String: Components.Schemas.ChatRoomPresence] {
  var byUser: [String: Components.Schemas.ChatRoomPresence] = [:]
  for member in members {
    guard let userId = parseUserId(fromAblyPresenceClientId: member.clientId) else { continue }
    let online = member.data.map { $0.visible && now.timeIntervalSince($0.lastActiveAt) <= onlineWindow } ?? false
    let next: Components.Schemas.ChatRoomPresence = online ? .online : .afk
    if byUser[userId] == .online {
      continue
    }
    byUser[userId] = next
  }
  return byUser
}

/// What this client last told the org channel, and when. Idle or unchanged
/// presence must not emit Ably messages; activity refreshes `lastActiveAt`
/// on a throttle just inside the online window; visibility changes, entering
/// and reconnects force an immediate publish.
public struct OrgPresencePublisherState: Equatable, Sendable {
  public private(set) var lastActiveAt: Date
  public private(set) var visible: Bool
  public private(set) var lastPublished: ChatPresenceMemberData?
  public private(set) var lastPublishedAt: Date?

  public init(now: Date = Date(), visible: Bool = true) {
    lastActiveAt = now
    self.visible = visible
  }

  public mutating func recordActivity(now: Date = Date()) {
    lastActiveAt = now
  }

  /// Becoming visible counts as activity, like web's `visibilitychange`.
  public mutating func setVisible(_ visible: Bool, now: Date = Date()) {
    self.visible = visible
    if visible {
      lastActiveAt = now
    }
  }

  public var data: ChatPresenceMemberData {
    ChatPresenceMemberData(lastActiveAt: lastActiveAt, visible: visible)
  }

  public func shouldPublish(force: Bool, now: Date = Date(), minInterval: TimeInterval = orgPresencePublishMinInterval) -> Bool {
    guard !force, let lastPublished, let lastPublishedAt else { return true }
    let next = data
    if next.visible != lastPublished.visible {
      return true
    }
    if next.lastActiveAt == lastPublished.lastActiveAt {
      return false
    }
    return now.timeIntervalSince(lastPublishedAt) >= minInterval
  }

  public mutating func markPublished(_ data: ChatPresenceMemberData, now: Date = Date()) {
    lastPublished = data
    lastPublishedAt = now
  }

  /// Forget what was published so the next attempt is unconditional (org
  /// switch, reconnect).
  public mutating func resetPublication() {
    lastPublished = nil
    lastPublishedAt = nil
  }

  /// Local self-approximation for the account chrome, like web's
  /// `useSelfPresence`: unreachable → offline; hidden or idle → afk.
  public func selfPresence(connected: Bool, now: Date = Date(), onlineWindow: TimeInterval = chatPresenceOnlineWindow) -> Components.Schemas.ChatRoomPresence {
    guard connected else { return .offline }
    guard visible, now.timeIntervalSince(lastActiveAt) <= onlineWindow else { return .afk }
    return .online
  }
}
