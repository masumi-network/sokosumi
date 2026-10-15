import Ably
import Foundation
import SokosumiChat

/// Serializes authorization and subscription changes for one socket lifetime.
/// Selected-room health is observed separately by AblyRealtimeConnection.
final class RoomMembershipSubscriptions: @unchecked Sendable {
  private struct Subscription {
    let channel: ARTRealtimeChannel
    let channelName: String
    let id: UUID
  }

  private let queue = DispatchQueue(label: "com.sokosumi.room-subscriptions")
  private let realtime: ARTRealtime
  private let onEvent: RealtimeEventHandler
  private let authorize: (@escaping @Sendable (_ capability: String?, _ failed: Bool) -> Void) -> Void
  private let sleep: @Sendable (Duration) async throws -> Void
  private var membership = RoomSubscriptionMembership()
  private var channels: [String: Subscription] = [:]
  private var active = true
  private var hasMembership = false
  private var retry: Task<Void, Never>?
  private var connectionListener: ARTEventListener?

  /// `authorize` mints a token on `realtime` unless a test answers it; `sleep` paces the retry after a failed mint.
  init(
    realtime: ARTRealtime,
    authorize: ((@escaping @Sendable (_ capability: String?, _ failed: Bool) -> Void) -> Void)? = nil,
    sleep: @escaping @Sendable (Duration) async throws -> Void = { try await Task.sleep(for: $0) },
    onEvent: @escaping RealtimeEventHandler
  ) {
    self.realtime = realtime
    self.authorize = authorize ?? realtime.authorize
    self.sleep = sleep
    self.onEvent = onEvent
    connectionListener = realtime.connection.on { [weak self] change in
      let healthy = change.current == .connected
      self?.queue.async { [weak self] in
        guard let self, active else { return }
        onEvent(.connectionHealth(healthy: healthy))
        if healthy, membership.needsRetry {
          synchronize()
        }
      }
    }
    onEvent(.connectionHealth(healthy: realtime.connection.state == .connected))
  }

  func update(_ ids: Set<String>) {
    queue.async { [self] in
      guard active else { return }
      let previous = membership.generation
      membership.update(ids)
      guard !hasMembership || membership.generation != previous else { return }
      hasMembership = true
      // Membership removal takes effect before the next authorization.
      for id in Array(channels.keys) where !ids.contains(id) {
        detach(id)
      }
      synchronize()
    }
  }

  func refresh() {
    queue.async { [self] in synchronize() }
  }

  func resetScope() {
    queue.async { [self] in
      guard active else { return }
      membership.resetScope()
      hasMembership = false
      retry?.cancel()
      retry = nil
      for id in Array(channels.keys) {
        detach(id)
      }
    }
  }

  func revoke(_ id: String) {
    queue.async { [self] in
      guard active else { return }
      membership.revoke(id)
      detach(id)
      synchronize()
    }
  }

  /// Synchronous, so a socket closes only after the detach is issued.
  func stop() {
    queue.sync { [self] in
      active = false
      retry?.cancel()
      retry = nil
      if let connectionListener {
        realtime.connection.off(connectionListener)
      }
      connectionListener = nil
      for id in Array(channels.keys) {
        detach(id)
      }
    }
  }

  private func synchronize() {
    guard active else { return }
    let state = realtime.connection.state
    guard state != .closing, state != .closed, state != .failed else { return }
    retry?.cancel()
    retry = nil
    guard let generation = membership.requestAuthorization() else { return }
    authorize { [weak self] capability, failed in
      self?.queue.async { [weak self] in
        self?.settle(capability: capability, failed: failed, generation: generation)
      }
    }
  }

  private func settle(capability: String?, failed: Bool, generation: UUID) {
    guard active else { return }
    if !failed, let ids = membership.authorizedRooms(capability: capability, generation: generation) {
      subscribe(ids, capability: capability)
    }
    switch membership.finishAuthorization(generation, failed: failed) {
    case .immediate:
      synchronize()
    case .delayed:
      retry = Task { [weak self, sleep] in
        do { try await sleep(gatedChannelRetryDelay) } catch { return }
        guard !Task.isCancelled else { return }
        self?.refresh()
      }
    case .none: break
    }
  }

  /// Core names each room channel per deployment (ADR 0055). A missing or malformed capability falls back to
  /// membership, and so to production names; the next token that names a room otherwise moves it there.
  private func subscribe(_ ids: Set<String>, capability: String?) {
    for id in Array(channels.keys) where !ids.contains(id) {
      detach(id)
    }
    let names = chatRoomChannelNames(grantedSubscribeIn: capability) ?? [:]
    for id in ids {
      if let current = channels[id] {
        guard let granted = names[id], granted != current.channelName else { continue }
        detach(id)
      }
      subscribe(id, channelName: names[id] ?? chatRoomChannelName(roomId: id))
    }
  }

  private func subscribe(_ id: String, channelName: String) {
    let channel = realtime.channels.get(channelName)
    let subscriptionId = UUID()
    channels[id] = Subscription(channel: channel, channelName: channelName, id: subscriptionId)
    for name in [chatRoomMessageEventName, chatRoomPinnedMessageEventName, chatRoomReadEventName] {
      channel.subscribe(name) { [weak self] message in
        let event = resolveRealtimeDelivery(channel: channelName, event: message.name ?? "", data: message.data ?? NSNull())
        self?.queue.async { [weak self] in
          guard let self, active, channels[id]?.id == subscriptionId else { return }
          onEvent(event)
        }
      }
    }
  }

  private func detach(_ id: String) {
    guard let channel = channels.removeValue(forKey: id)?.channel else { return }
    channel.unsubscribe()
    channel.detach()
  }
}
