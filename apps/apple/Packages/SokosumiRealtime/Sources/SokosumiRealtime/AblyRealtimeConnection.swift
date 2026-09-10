import Ably
import Foundation
import SokosumiChat

/// ably-cocoa-backed `RealtimeConnection` (SOK-976).
///
/// One socket: the user chat-control channel and membership room channels.
/// Auth tokens come from Core (`POST /v1/realtime/ably-token`) through the
/// provider, so capabilities track membership; the coordinator remints after
/// join/leave/revoke. Ably invokes callbacks off the main thread — events
/// hop out through the `Sendable` handler for the app to apply on MainActor.
/// No presence enter (ADR 0003), no push (ADR 0022 / 0023).
public final class AblyRealtimeConnection: RealtimeConnection, @unchecked Sendable {
  private let lock = NSLock()
  private var realtime: ARTRealtime?
  private var controlChannel: ARTRealtimeChannel?
  private var watchedRoomId: String?
  private var tokenSource: RealtimeTokenSource?
  private var membershipSubscriptions: RoomMembershipSubscriptions?
  private var onEvent: RealtimeEventHandler?
  private var roomGeneration = UUID()
  private var connectionGeneration = UUID()
  private var roomHealth: RoomRealtimeHealth?
  private var removeHealthListeners: (() -> Void)?

  public init() {}

  public func connect(
    userId: String,
    organizationSlug: String?,
    tokenProvider: @escaping RealtimeTokenProvider,
    onEvent: @escaping RealtimeEventHandler
  ) {
    disconnect()
    let generation = lock.withLock { connectionGeneration }
    let tokenSource = RealtimeTokenSource(slug: organizationSlug, provider: tokenProvider)
    lock.withLock {
      self.tokenSource = tokenSource
      self.onEvent = onEvent
    }
    let options = ARTClientOptions()
    options.echoMessages = false
    options.authCallback = { _, callback in
      Task {
        do {
          let fields = try await tokenSource.next()
          guard let json = fields.jsonString else {
            callback(nil, ablyRealtimeError("Ably token request was empty."))
            return
          }
          try callback(ARTTokenRequest.fromJson(json as NSString), nil)
        } catch {
          callback(nil, error as NSError)
        }
      }
    }
    let realtime = ARTRealtime(options: options)
    let control = realtime.channels.get(userChatControlChannelName(userId: userId))
    let controlName = control.name
    control.subscribe(chatMembershipRevokedEventName) { [weak self] message in
      self?.forward(channelName: controlName, message: message, generation: generation)
    }
    lock.withLock {
      self.realtime = realtime
      controlChannel = control
      membershipSubscriptions = RoomMembershipSubscriptions(realtime: realtime, onEvent: onEvent)
    }
  }

  public func setMembershipRooms(_ roomIds: Set<String>) {
    lock.withLock { membershipSubscriptions }?.update(roomIds)
  }

  public func refreshMembership() {
    lock.withLock { membershipSubscriptions }?.refresh()
  }

  public func setOrganizationSlug(_ slug: String?) {
    lock.withLock {
      tokenSource?.setSlug(slug)
      membershipSubscriptions?.resetScope()
    }
  }

  public func watchRoom(_ roomId: String?) {
    let generation = UUID()
    var cleanup: (() -> Void)?
    let changed = lock.withLock {
      guard watchedRoomId != roomId else { return false }
      roomGeneration = generation
      roomHealth = nil
      cleanup = removeHealthListeners
      removeHealthListeners = nil
      watchedRoomId = roomId
      return true
    }
    guard changed else { return }
    cleanup?()
    guard let roomId, let liveRealtime = lock.withLock({ realtime }) else { return }
    let channel = liveRealtime.channels.get(chatRoomChannelName(roomId: roomId))
    let initialHealth = RoomRealtimeHealth(connection: liveRealtime.connection.state, channel: channel.state)
    lock.withLock { roomHealth = initialHealth }
    let channelListener = channel.on { [weak self] change in
      self?.updateHealth(roomId: roomId, generation: generation) {
        $0.channelChanged(current: change.current, resumed: change.resumed)
      }
    }
    let connectionListener = liveRealtime.connection.on { [weak self] change in
      self?.updateHealth(roomId: roomId, generation: generation) {
        $0.connectionChanged(current: change.current, previous: change.previous)
      }
    }
    lock.withLock {
      removeHealthListeners = {
        channel.off(channelListener)
        liveRealtime.connection.off(connectionListener)
      }
    }
    updateHealth(roomId: roomId, generation: generation) { _ in false }
  }

  public func disconnect() {
    var cleanup: (() -> Void)?
    let control = lock.withLock { () -> ARTRealtimeChannel? in
      tokenSource?.invalidate()
      connectionGeneration = UUID()
      tokenSource = nil
      membershipSubscriptions?.stop()
      membershipSubscriptions = nil
      roomGeneration = UUID()
      roomHealth = nil
      cleanup = removeHealthListeners
      removeHealthListeners = nil
      let control = controlChannel
      controlChannel = nil
      watchedRoomId = nil
      onEvent = nil
      return control
    }
    cleanup?()
    control?.unsubscribe()
    control?.detach()
    let previous = lock.withLock {
      let previous = realtime
      realtime = nil
      return previous
    }
    previous?.close()
  }

  private func updateHealth(roomId: String, generation: UUID, change: (inout RoomRealtimeHealth) -> Bool) {
    let delivery: (RealtimeEventHandler, ResolvedRealtimeDelivery)? = lock.withLock {
      guard roomGeneration == generation, watchedRoomId == roomId,
            var health = roomHealth, let onEvent else { return nil }
      let gap = change(&health)
      roomHealth = health
      return (onEvent, .roomHealth(roomId: roomId, healthy: health.isHealthy, continuityLost: gap))
    }
    if let (handler, event) = delivery {
      handler(event)
    }
  }

  private func forward(channelName: String?, message: ARTMessage, generation: UUID) {
    guard let channelName,
          let onEvent = lock.withLock({ connectionGeneration == generation ? self.onEvent : nil })
    else {
      return
    }
    let data: Any = message.data ?? NSNull()
    let event = resolveRealtimeDelivery(channel: channelName, event: message.name ?? "", data: data)
    if case let .revoked(roomId) = event {
      lock.withLock { membershipSubscriptions }?.revoke(roomId)
    }
    onEvent(event)
  }
}

private func ablyRealtimeError(_ message: String) -> NSError {
  NSError(domain: "SokosumiRealtime", code: -1, userInfo: [NSLocalizedDescriptionKey: message])
}
