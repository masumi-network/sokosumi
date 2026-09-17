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
  private struct Subscription {
    let channel: ARTRealtimeChannel
    let listener: ARTEventListener?
    let id: UUID
  }

  private let queue = DispatchQueue(label: "com.sokosumi.org-presence")
  private let realtime: ARTRealtime
  private let onEvent: RealtimeEventHandler
  private var scope = OrgPresenceScope()
  private var subscription: Subscription?
  private var members: [String: ChatPresenceMember] = [:]
  private var latestData: ChatPresenceMemberData?
  private var active = true
  private var retry: Task<Void, Never>?
  private var connectionListener: ARTEventListener?

  init(realtime: ARTRealtime, onEvent: @escaping RealtimeEventHandler) {
    self.realtime = realtime
    self.onEvent = onEvent
    connectionListener = realtime.connection.on { [weak self] change in
      guard change.current == .connected else { return }
      self?.queue.async { [weak self] in
        guard let self, active, scope.organizationId != nil else { return }
        synchronize()
      }
    }
  }

  /// Enters `organizationId`'s channel (nil: personal, leave only).
  func setOrganization(_ organizationId: String?) {
    queue.async { [self] in
      guard active, scope.organizationId != organizationId else { return }
      leaveChannel()
      retry?.cancel()
      retry = nil
      scope.setOrganization(organizationId)
      if organizationId != nil {
        synchronize()
      }
    }
  }

  /// Latest presence data; sent now when the channel is granted, otherwise
  /// kept for the enter that follows authorization.
  func publish(_ data: ChatPresenceMemberData) {
    queue.async { [self] in
      guard active else { return }
      latestData = data
      guard scope.isGranted, let subscription else { return }
      send(data, subscription: subscription)
    }
  }

  /// Synchronous so `disconnect` can close after leave is issued, not before.
  func stop() {
    queue.sync { [self] in
      active = false
      retry?.cancel()
      retry = nil
      if let connectionListener {
        realtime.connection.off(connectionListener)
      }
      connectionListener = nil
      leaveChannel()
      scope.setOrganization(nil)
    }
  }

  private func synchronize() {
    guard active else { return }
    let state = realtime.connection.state
    guard state != .closing, state != .closed, state != .failed else { return }
    retry?.cancel()
    retry = nil
    guard let generation = scope.requestAuthorization() else { return }
    realtime.auth.authorize { [weak self] token, error in
      let capability = token?.capability
      let failed = error != nil
      self?.queue.async { [weak self] in
        self?.settle(capability: capability, failed: failed, generation: generation)
      }
    }
  }

  private func settle(capability: String?, failed: Bool, generation: UUID) {
    guard active else { return }
    switch scope.finishAuthorization(generation, capability: capability, failed: failed) {
    case .stale:
      return
    case let .granted(organizationId):
      attach(organizationId)
    case let .denied(failed):
      // A missing grant stays off until the next connection; a failed mint retries.
      leaveChannel()
      if failed {
        retry = Task { [weak self] in
          do { try await Task.sleep(for: .seconds(15)) } catch { return }
          self?.queue.async { [weak self] in self?.synchronize() }
        }
      }
    }
    if scope.takeQueued() {
      synchronize()
    }
  }

  private func attach(_ organizationId: String) {
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
          guard let self, active, self.subscription?.id == id else { return }
          apply(change, organizationId: organizationId)
        }
      }
      subscription = Subscription(channel: channel, listener: listener, id: id)
      self.subscription = subscription
    }
    // Non-resumed reconnects leave the local set stale (ghost members); the
    // full set replaces it whenever a token was freshly granted.
    subscription.channel.presence.get { [weak self] messages, _ in
      guard let messages else { return }
      let present = messages.compactMap { PresenceChange($0) }.filter(\.present).map(\.member)
      self?.queue.async { [weak self] in
        guard let self, active, self.subscription?.id == subscription.id else { return }
        members = Dictionary(present.map { ($0.clientId, $0) }, uniquingKeysWith: { _, last in last })
        emit(organizationId: organizationId)
      }
    }
    if let latestData {
      send(latestData, subscription: subscription)
    }
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
  /// since this connection does not echo. Failed enter retries in 15 s: the
  /// coordinator already marked this payload published.
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
    guard active, retry == nil, scope.isGranted, subscription != nil, latestData != nil else { return }
    retry = Task { [weak self] in
      do { try await Task.sleep(for: .seconds(15)) } catch { return }
      self?.queue.async { [weak self] in
        guard let self, active, let subscription, let latestData else { return }
        retry = nil
        send(latestData, subscription: subscription)
      }
    }
  }

  private func mirrorOwnMember(_ data: ChatPresenceMemberData, subscription: Subscription) {
    guard let clientId = realtime.auth.clientId else { return }
    queue.async { [weak self] in
      guard let self, active, self.subscription?.id == subscription.id,
            let organizationId = scope.organizationId else { return }
      retry?.cancel()
      retry = nil
      members[clientId] = ChatPresenceMember(clientId: clientId, data: data)
      emit(organizationId: organizationId)
    }
  }

  private func leaveChannel() {
    guard let subscription else { return }
    self.subscription = nil
    members = [:]
    if let listener = subscription.listener {
      subscription.channel.presence.unsubscribe(listener)
    }
    subscription.channel.presence.leave(nil)
    subscription.channel.detach()
    if let organizationId = scope.organizationId {
      emit(organizationId: organizationId)
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
