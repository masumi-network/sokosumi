import Ably
import Foundation
import SokosumiChat

/// Org presence over one socket lifetime (ADR 0003), mirroring web's
/// `useOrgPresencePublisher` plus `useOrgPresenceMap` on the shared channel.
///
/// The active organization's `presence:org_*` channel is entered only after a
/// fresh token grants `presence` on it; the member set is hydrated with
/// `presence.get` and then followed live, and every `connected` transition
/// re-authorizes, re-hydrates and re-publishes because Ably restores presence
/// only on a resumed connection. Switching organizations leaves the previous
/// channel first; `stop` leaves on sign-out and teardown.
final class OrgPresenceChannel: @unchecked Sendable {
  private let engine: GatedChannel<OrgPresencePolicy>
  private let policy: OrgPresencePolicy

  init(realtime: ARTRealtime, onEvent: @escaping RealtimeEventHandler,
       sleep: @escaping @Sendable (Duration) async throws -> Void = { try await Task.sleep(for: $0) }) {
    let queue = DispatchQueue(label: "com.sokosumi.org-presence")
    policy = OrgPresencePolicy(queue: queue, realtime: realtime, onEvent: onEvent)
    engine = GatedChannel(queue: queue, host: realtime, policy: policy, sleep: sleep)
    policy.engine = engine
  }

  /// Enters `organizationId`'s channel (nil: personal, leave only).
  func setOrganization(_ organizationId: String?) {
    engine.setTarget(organizationId)
  }

  /// Latest presence data; sent now when the channel is granted, otherwise
  /// kept for the enter that follows authorization.
  func publish(_ data: ChatPresenceMemberData) {
    engine.queue.async { [policy] in policy.publish(data) }
  }

  /// Synchronous so `disconnect` can close after leave is issued, not before.
  func stop() {
    engine.stop()
  }
}

/// The presence channel's part: `presence` on `presence:org_*` attaches it, hydrates the member set and enters with
/// the latest data. Called on the engine's queue.
private final class OrgPresencePolicy: GatedChannelPolicy, @unchecked Sendable {
  private struct Subscription {
    let channel: ARTRealtimeChannel
    let listener: ARTEventListener?
    let id: UUID
    let organizationId: String
  }

  weak var engine: GatedChannel<OrgPresencePolicy>?
  private let queue: DispatchQueue
  private let realtime: ARTRealtime
  private let onEvent: RealtimeEventHandler
  private var subscription: Subscription?
  private var members: [String: ChatPresenceMember] = [:]
  private var latestData: ChatPresenceMemberData?

  init(queue: DispatchQueue, realtime: ARTRealtime, onEvent: @escaping RealtimeEventHandler) {
    self.queue = queue
    self.realtime = realtime
    self.onEvent = onEvent
  }

  func grant(in capability: String?, target: String) -> Bool? {
    (organizationIds(grantedPresenceIn: capability) ?? []).contains(target) ? true : nil
  }

  func attach(_ organizationId: String, grant _: Bool) {
    let subscription: Subscription
    if let existing = self.subscription {
      subscription = existing
    } else {
      let channel = realtime.channels.get(orgPresenceChannelName(organizationId: organizationId))
      let id = UUID()
      // Ably objects are not Sendable: reduce each message to a value before hopping queues.
      let listener = channel.presence.subscribe { [weak self] message in
        guard let change = PresenceChange(message) else { return }
        self?.queue.async { [weak self] in
          guard let self, self.subscription?.id == id else { return }
          apply(change, organizationId: organizationId)
        }
      }
      subscription = Subscription(channel: channel, listener: listener, id: id, organizationId: organizationId)
      self.subscription = subscription
    }
    // Non-resumed reconnects leave the local set stale (ghost members); the
    // full set replaces it whenever a token was freshly granted.
    subscription.channel.presence.get { [weak self] messages, _ in
      guard let messages else { return }
      let present = messages.compactMap { PresenceChange($0) }.filter(\.present).map(\.member)
      self?.queue.async { [weak self] in
        guard let self, self.subscription?.id == subscription.id else { return }
        members = Dictionary(present.map { ($0.clientId, $0) }, uniquingKeysWith: { _, last in last })
        emit(organizationId: organizationId)
      }
    }
    if let latestData {
      send(latestData, subscription: subscription)
    }
  }

  func denied(_: String) {
    detach()
  }

  func detach() {
    guard let subscription else { return }
    self.subscription = nil
    members = [:]
    if let listener = subscription.listener {
      subscription.channel.presence.unsubscribe(listener)
    }
    subscription.channel.presence.leave(nil)
    subscription.channel.detach()
    emit(organizationId: subscription.organizationId)
  }

  func publish(_ data: ChatPresenceMemberData) {
    latestData = data
    guard let subscription else { return }
    send(data, subscription: subscription)
  }

  private func apply(_ change: PresenceChange, organizationId: String) {
    if change.present {
      members[change.member.clientId] = change.member
    } else {
      members.removeValue(forKey: change.member.clientId)
    }
    emit(organizationId: organizationId)
  }

  private func emit(organizationId: String) {
    onEvent(.presenceRoster(organizationId: organizationId, members: Array(members.values)))
  }

  /// `update` keeps an existing member's data; a member Ably no longer holds
  /// (hard reconnect) needs `enter` again. Own writes are mirrored locally,
  /// since this connection does not echo. A failed enter retries through the
  /// engine: the coordinator already marked this payload published.
  private func send(_ data: ChatPresenceMemberData, subscription: Subscription) {
    let wire = data.wire
    subscription.channel.presence.update(wire) { [weak self] error in
      guard error != nil else {
        self?.mirrorOwnMember(data, subscription: subscription)
        return
      }
      subscription.channel.presence.enter(wire) { [weak self] error in
        guard error == nil else {
          self?.queue.async { [weak self] in self?.scheduleSendRetry() }
          return
        }
        self?.mirrorOwnMember(data, subscription: subscription)
      }
    }
  }

  private func scheduleSendRetry() {
    guard subscription != nil, latestData != nil else { return }
    engine?.retryLater { [weak self] in
      guard let self, let subscription, let latestData else { return }
      send(latestData, subscription: subscription)
    }
  }

  private func mirrorOwnMember(_ data: ChatPresenceMemberData, subscription: Subscription) {
    guard let clientId = realtime.auth.clientId else { return }
    queue.async { [weak self] in
      guard let self, self.subscription?.id == subscription.id else { return }
      engine?.cancelRetry()
      members[clientId] = ChatPresenceMember(clientId: clientId, data: data)
      emit(organizationId: subscription.organizationId)
    }
  }
}

/// One presence event as a value: present (enter/update/present) or gone (leave/absent).
private struct PresenceChange: Sendable {
  let member: ChatPresenceMember
  let present: Bool

  init?(_ message: ARTPresenceMessage) {
    guard let clientId = message.clientId else { return nil }
    switch message.action {
    case .enter, .update, .present: present = true
    case .leave, .absent: present = false
    @unknown default: return nil
    }
    member = ChatPresenceMember(clientId: clientId, data: ChatPresenceMemberData(wire: message.data))
  }
}
