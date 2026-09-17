import Combine
import CoreAPI
import Foundation

/// Live org presence for the active workspace (ADR 0003): the teammate map
/// web's `useOrgPresenceMap` keeps, and the publisher bookkeeping of
/// `useOrgPresencePublisher`. The transport feeds rosters in; the
/// coordinator asks what to publish. Personal workspaces keep an empty map,
/// so every dot falls back to the room DTO value.
@MainActor
public final class OrgPresence: ObservableObject {
  /// Organization whose channel the roster describes; nil in personal workspaces.
  public private(set) var organizationId: String?
  /// userId → online | afk. Absent users are offline (callers use their fallback).
  @Published public private(set) var byUserId: [String: Components.Schemas.ChatRoomPresence] = [:]
  /// Local self-approximation for the account chrome (web `useSelfPresence`).
  @Published public private(set) var selfPresence: Components.Schemas.ChatRoomPresence = .online
  public private(set) var publisher: OrgPresencePublisherState
  private var members: [ChatPresenceMember] = []
  private var reachable = true

  public init(now: Date = Date()) {
    publisher = OrgPresencePublisherState(now: now)
  }

  /// Workspace switch: drop the previous roster at once so stale members never
  /// flash while the new organization authorizes; the next publish is unconditional.
  public func setOrganization(_ id: String?) {
    guard organizationId != id else { return }
    organizationId = id
    members = []
    publisher.resetPublication()
    update(byUserId: [:])
  }

  /// Full member set from the transport. Rosters for another organization
  /// (a switch raced the channel) are ignored.
  public func replaceRoster(organizationId id: String, members: [ChatPresenceMember], now: Date = Date()) {
    guard id == organizationId else { return }
    self.members = members
    update(byUserId: aggregateChatPresence(members: members, now: now))
  }

  /// Teammates age online → afk from their last activity without waiting
  /// for another Ably message; self follows the same clock.
  public func reclassify(now: Date = Date()) {
    update(byUserId: aggregateChatPresence(members: members, now: now))
    update(selfPresence: publisher.selfPresence(connected: reachable, now: now))
  }

  public func reset() {
    organizationId = nil
    members = []
    reachable = true
    publisher.resetPublication()
    update(byUserId: [:])
    update(selfPresence: publisher.selfPresence(connected: true))
  }

  public func presence(forUser userId: String, fallback: Components.Schemas.ChatRoomPresence) -> Components.Schemas.ChatRoomPresence {
    byUserId[userId] ?? fallback
  }

  // MARK: - Publisher

  public func recordActivity(now: Date = Date()) {
    publisher.recordActivity(now: now)
    update(selfPresence: publisher.selfPresence(connected: reachable, now: now))
  }

  public func setVisible(_ visible: Bool, now: Date = Date()) {
    publisher.setVisible(visible, now: now)
    update(selfPresence: publisher.selfPresence(connected: reachable, now: now))
  }

  /// Socket reachability for the self dot only; teammates come from the roster.
  public func setReachable(_ reachable: Bool, now: Date = Date()) {
    self.reachable = reachable
    update(selfPresence: publisher.selfPresence(connected: reachable, now: now))
  }

  /// Data worth an Ably message now, or nil when idle/unchanged presence
  /// would only repeat itself. Personal workspaces never publish.
  public func publication(force: Bool, now: Date = Date()) -> ChatPresenceMemberData? {
    guard organizationId != nil, publisher.shouldPublish(force: force, now: now) else { return nil }
    let data = publisher.data
    publisher.markPublished(data, now: now)
    return data
  }

  private func update(byUserId next: [String: Components.Schemas.ChatRoomPresence]) {
    if next != byUserId {
      byUserId = next
    }
  }

  private func update(selfPresence next: Components.Schemas.ChatRoomPresence) {
    if next != selfPresence {
      selfPresence = next
    }
  }
}
