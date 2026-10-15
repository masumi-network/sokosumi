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
  private let engine: GatedChannel<RoomTypingPolicy>
  private let policy: RoomTypingPolicy

  init(realtime: ARTRealtime, userId: String, onEvent: @escaping RealtimeEventHandler,
       sleep: @escaping @Sendable (Duration) async throws -> Void = { try await Task.sleep(for: $0) }) {
    let queue = DispatchQueue(label: "com.sokosumi.room-typing")
    policy = RoomTypingPolicy(queue: queue, realtime: realtime, userId: userId, onEvent: onEvent)
    engine = GatedChannel(queue: queue, host: realtime, policy: policy, sleep: sleep)
  }

  /// Subscribes `roomId`'s typing channel (nil: none), detaching the previous room's first.
  func setRoom(_ roomId: String?) {
    engine.setTarget(roomId)
  }

  /// Hands one Typing event to the watched room. Failures are not retried: a lost `started`
  /// is repeated by the next heartbeat and a lost `stopped` expires on every reader.
  func publish(_ state: ChatTypingState, roomId: String) {
    engine.withGrant { [policy] target, grant in
      guard target == roomId, grant.canPublish else { return }
      policy.publish(state)
    }
  }

  /// Synchronous so `disconnect` closes after a queued `stopped` and the detach are issued.
  func stop() {
    engine.stop()
  }
}

/// The typing channel's part: `subscribe` on `chat_typing:room_*` attaches it, `publish` lets the reader announce
/// typing, and each grant reports whether they may.
private final class RoomTypingPolicy: GatedChannelPolicy, @unchecked Sendable {
  private struct Subscription {
    let channel: ARTRealtimeChannel
    let listener: ARTEventListener?
    let id: UUID
  }

  private let queue: DispatchQueue
  private let realtime: ARTRealtime
  private let userId: String
  private let onEvent: RealtimeEventHandler
  private var subscription: Subscription?

  init(queue: DispatchQueue, realtime: ARTRealtime, userId: String, onEvent: @escaping RealtimeEventHandler) {
    self.queue = queue
    self.realtime = realtime
    self.userId = userId
    self.onEvent = onEvent
  }

  func grant(in capability: String?, target: String) -> ChatTypingGrant? {
    chatTypingGrant(in: capability, roomId: target)
  }

  func attach(_ roomId: String, grant: ChatTypingGrant) {
    if subscription == nil {
      let channel = realtime.channels.get(grant.channelName)
      let id = UUID()
      // Ably objects are not Sendable: reduce each message to a value before hopping queues.
      let listener = channel.subscribe(chatTypingEventName) { [weak self] message in
        guard let signal = ChatTypingSignal(wire: message.data, clientId: message.clientId) else { return }
        self?.queue.async { [weak self] in
          guard let self, subscription?.id == id else { return }
          onEvent(.typing(roomId: roomId, signal: signal))
        }
      }
      subscription = Subscription(channel: channel, listener: listener, id: id)
    }
    onEvent(.typingChannel(roomId: roomId, canPublish: grant.canPublish))
  }

  func denied(_ roomId: String) {
    detach()
    onEvent(.typingChannel(roomId: roomId, canPublish: nil))
  }

  func detach() {
    guard let subscription else { return }
    self.subscription = nil
    subscription.channel.unsubscribe(subscription.listener)
    subscription.channel.detach()
  }

  func publish(_ state: ChatTypingState) {
    subscription?.channel.publish([chatTypingMessage(ChatTypingSignal(userId: userId, state: state))])
  }
}

/// The message web publishes: `{ userId, state, parentMessageId: null }`, ephemeral so it is
/// never persisted and never replayed on resume. Ably stamps the sender's client id from the token.
func chatTypingMessage(_ signal: ChatTypingSignal) -> ARTMessage {
  let message = ARTMessage(name: chatTypingEventName, data: signal.wire)
  message.extras = ["ephemeral": true] as NSDictionary
  return message
}
