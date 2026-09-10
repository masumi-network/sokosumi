import Ably
import Foundation
import SokosumiChat

/// Serializes authorization and subscription changes for one socket lifetime.
/// Selected-room health is observed separately by AblyRealtimeConnection.
final class RoomMembershipSubscriptions: @unchecked Sendable {
  private struct Subscription {
    let channel: ARTRealtimeChannel
    let id: UUID
  }

  private let queue = DispatchQueue(label: "com.sokosumi.room-subscriptions")
  private let realtime: ARTRealtime
  private let onEvent: RealtimeEventHandler
  private var membership = RoomSubscriptionMembership()
  private var channels: [String: Subscription] = [:]
  private var active = true
  private var hasMembership = false
  private var retry: Task<Void, Never>?
  private var connectionListener: ARTEventListener?

  init(realtime: ARTRealtime, onEvent: @escaping RealtimeEventHandler) {
    self.realtime = realtime
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

  func stop() {
    queue.async { [self] in
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
    if !failed, let ids = membership.authorizedRooms(capability: capability, generation: generation) {
      for id in Array(channels.keys) where !ids.contains(id) {
        detach(id)
      }
      for id in ids where channels[id] == nil {
        subscribe(id)
      }
    }
    switch membership.finishAuthorization(generation, failed: failed) {
    case .immediate:
      synchronize()
    case .delayed:
      retry = Task { [weak self] in
        do { try await Task.sleep(for: .seconds(15)) } catch { return }
        self?.refresh()
      }
    case .none: break
    }
  }

  private func subscribe(_ id: String) {
    let channel = realtime.channels.get(chatRoomChannelName(roomId: id))
    let subscriptionId = UUID()
    channels[id] = Subscription(channel: channel, id: subscriptionId)
    for name in [chatRoomMessageEventName, chatRoomPinnedMessageEventName] {
      channel.subscribe(name) { [weak self] message in
        let event = resolveRealtimeDelivery(channel: chatRoomChannelName(roomId: id), event: message.name ?? "", data: message.data ?? NSNull())
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
