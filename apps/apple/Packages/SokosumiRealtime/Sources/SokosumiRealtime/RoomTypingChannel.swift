import Ably
import Foundation
import SokosumiChat

/// The watched room's typing channel over one socket lifetime (ADR 0033), mirroring web's
/// `useRoomTyping`.
///
/// `chat_typing:room_*` is subscribed only after a fresh token grants `subscribe` on it, and
/// published to only when that token also grants `publish`; every `connected` transition
/// re-authorizes, because the grant is a snapshot of membership at mint time. Typing events are
/// ephemeral, so nothing is hydrated or replayed: a room starts, and reconnects, with whoever
/// speaks up next. Changing rooms detaches the previous channel.
final class RoomTypingChannel: @unchecked Sendable {
  private struct Subscription {
    let channel: ARTRealtimeChannel
    let listener: ARTEventListener?
    let id: UUID
  }

  private let queue = DispatchQueue(label: "com.sokosumi.room-typing")
  private let realtime: ARTRealtime
  private let userId: String
  private let onEvent: RealtimeEventHandler
  private var scope = RoomTypingScope()
  private var subscription: Subscription?
  private var active = true
  private var retry: Task<Void, Never>?
  private var connectionListener: ARTEventListener?

  init(realtime: ARTRealtime, userId: String, onEvent: @escaping RealtimeEventHandler) {
    self.realtime = realtime
    self.userId = userId
    self.onEvent = onEvent
    connectionListener = realtime.connection.on { [weak self] change in
      guard change.current == .connected else { return }
      self?.queue.async { [weak self] in
        guard let self, active, scope.roomId != nil else { return }
        synchronize()
      }
    }
  }

  /// Subscribes `roomId`'s typing channel (nil: none), detaching the previous room's first.
  func setRoom(_ roomId: String?) {
    queue.async { [self] in
      guard active, scope.roomId != roomId else { return }
      detachChannel()
      retry?.cancel()
      retry = nil
      scope.setRoom(roomId)
      if roomId != nil {
        synchronize()
      }
    }
  }

  /// Hands one Typing event to the watched room. Failures are not retried: a lost `started`
  /// is repeated by the next heartbeat and a lost `stopped` expires on every reader.
  func publish(_ state: ChatTypingState, roomId: String) {
    queue.async { [self] in
      guard active, scope.roomId == roomId, scope.canPublish, let subscription else { return }
      subscription.channel.publish([chatTypingMessage(ChatTypingSignal(userId: userId, state: state))])
    }
  }

  /// Synchronous so `disconnect` closes after a queued `stopped` and the detach are issued.
  func stop() {
    queue.sync { [self] in
      active = false
      retry?.cancel()
      retry = nil
      if let connectionListener {
        realtime.connection.off(connectionListener)
      }
      connectionListener = nil
      detachChannel()
      scope.setRoom(nil)
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
    case let .granted(roomId, canPublish):
      attach(roomId)
      onEvent(.typingChannel(roomId: roomId, canPublish: canPublish))
    case let .denied(roomId, failed):
      // A missing grant stays off until the next connection; a failed mint retries.
      detachChannel()
      onEvent(.typingChannel(roomId: roomId, canPublish: nil))
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

  private func attach(_ roomId: String) {
    guard subscription == nil else { return }
    let channel = realtime.channels.get(chatTypingChannelName(roomId: roomId))
    let id = UUID()
    // Ably objects are not Sendable: reduce each message to a value before hopping queues.
    let listener = channel.subscribe(chatTypingEventName) { [weak self] message in
      guard let signal = ChatTypingSignal(wire: message.data, clientId: message.clientId) else { return }
      self?.queue.async { [weak self] in
        guard let self, active, subscription?.id == id else { return }
        onEvent(.typing(roomId: roomId, signal: signal))
      }
    }
    subscription = Subscription(channel: channel, listener: listener, id: id)
  }

  private func detachChannel() {
    guard let subscription else { return }
    self.subscription = nil
    subscription.channel.unsubscribe(subscription.listener)
    subscription.channel.detach()
  }
}

/// The message web publishes: `{ userId, state, parentMessageId: null }`, ephemeral so it is
/// never persisted and never replayed on resume. Ably stamps the sender's client id from the token.
func chatTypingMessage(_ signal: ChatTypingSignal) -> ARTMessage {
  let message = ARTMessage(name: chatTypingEventName, data: signal.wire)
  message.extras = ["ephemeral": true] as NSDictionary
  return message
}
