import Ably
import CoreAPI
import Foundation
import SokosumiChat

/// ably-cocoa-backed `RealtimeConnection` (SOK-976).
///
/// One socket: the user chat-control channel, the user notifications channel
/// (when the token grants it), membership room channels, the watched room's
/// typing channel (ADR 0033) and the active organization's presence channel
/// (ADR 0003). Auth tokens come
/// from Core (`POST /v1/realtime/ably-token`) through the provider, so
/// capabilities track membership; the coordinator remints after
/// join/leave/revoke. Ably invokes callbacks off the main thread — events
/// hop out through the `Sendable` handler for the app to apply on MainActor.
/// No push (ADR 0022 / 0023).
public final class AblyRealtimeConnection: RealtimeConnection, @unchecked Sendable {
  private let lock = NSLock()
  private var realtime: ARTRealtime?
  private var controlChannel: ARTRealtimeChannel?
  private var notificationsChannel: ARTRealtimeChannel?
  private var grantedChannelsListener: ARTEventListener?
  private var notificationsAttachListener: ARTEventListener?
  private var watchedRoomId: String?
  private var tokenSource: RealtimeTokenSource?
  private var membershipSubscriptions: RoomMembershipSubscriptions?
  private var presence: OrgPresenceChannel?
  private var typing: RoomTypingChannel?
  private var frontPresence = NotificationFrontPresence()
  private var frontPresenceRetry: Task<Void, Never>?
  /// How many times a current answer was handed to the channel. A retry
  /// carries the number it was armed with, so a later `setInFront` or
  /// restore can drop it before it undoes that answer.
  private var frontPresenceAsks = 0
  private let frontPresenceDispatch = DispatchQueue(label: "sokosumi.notification-front-presence")
  private var onEvent: RealtimeEventHandler?
  private var roomGeneration = UUID()
  private var connectionGeneration = UUID()
  private var roomHealth: RoomRealtimeHealth?
  /// The channel the watched room's health observes, to move it when a token names the room otherwise.
  private var roomHealthChannelName: String?
  private var removeHealthListeners: (() -> Void)?

  /// Paces the gated channels' and membership's retry after a failed token mint; tests pass a clock they drive.
  private let sleep: @Sendable (Duration) async throws -> Void

  public init(sleep: @escaping @Sendable (Duration) async throws -> Void = { try await Task.sleep(for: $0) }) {
    self.sleep = sleep
  }

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
          let token = try await tokenSource.next()
          guard let json = token.artTokenRequestJSON else {
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
    // Core names every channel per deployment (ADR 0055), so the control and
    // notifications channels are read from the granted capability once a token
    // exists rather than built here. A renewed token reports `update` while
    // still connected, so a grant missing from the first token is picked up later.
    let grantedChannelsListener = realtime.connection.on { [weak self, weak realtime] change in
      guard change.current == .connected, let realtime else { return }
      self?.subscribeControl(realtime: realtime, userId: userId, generation: generation)
      self?.subscribeNotifications(realtime: realtime, userId: userId, generation: generation)
      self?.rebindRoomHealthIfRenamed(capability: realtime.auth.tokenDetails?.capability)
    }
    lock.withLock {
      self.realtime = realtime
      self.grantedChannelsListener = grantedChannelsListener
      membershipSubscriptions = RoomMembershipSubscriptions(realtime: realtime, sleep: sleep, onEvent: onEvent)
      presence = OrgPresenceChannel(realtime: realtime, onEvent: onEvent, sleep: sleep)
      typing = RoomTypingChannel(realtime: realtime, userId: userId, onEvent: onEvent, sleep: sleep)
    }
  }

  public func publishTyping(_ state: ChatTypingState, roomId: String) {
    lock.withLock { typing }?.publish(state, roomId: roomId)
  }

  public func setPresenceOrganization(_ organizationId: String?) {
    lock.withLock { presence }?.setOrganization(organizationId)
  }

  public func publishPresence(_ data: ChatPresenceMemberData) {
    lock.withLock { presence }?.publish(data)
  }

  /// Presence on the notifications channel is the app in front (SOK-1090).
  /// The answer is sent when it changes and again whenever Ably restores
  /// the members it holds.
  public func setInFront(_ inFront: Bool) {
    let action = lock.withLock { () -> NotificationFrontPresence.Action in
      let next = frontPresence.setInFront(inFront)
      if next != .none {
        invalidateFrontPresenceLocked()
      }
      return next
    }
    send(action)
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
    let changed = lock.withLock {
      guard watchedRoomId != roomId else { return false }
      watchedRoomId = roomId
      return true
    }
    guard changed else { return }
    lock.withLock { typing }?.setRoom(roomId)
    bindRoomHealth()
  }

  /// Observes the watched room's channel under the name the current token grants. Before the first token, or with a
  /// token that does not grant the room, that is the production name; `rebindRoomHealthIfRenamed` moves it once a
  /// token names the room otherwise (ADR 0055).
  private func bindRoomHealth() {
    let generation = UUID()
    let (cleanup, target) = lock.withLock { () -> ((() -> Void)?, (roomId: String, realtime: ARTRealtime)?) in
      roomGeneration = generation
      roomHealth = nil
      roomHealthChannelName = nil
      let cleanup = removeHealthListeners
      removeHealthListeners = nil
      guard let watchedRoomId, let realtime else { return (cleanup, nil) }
      return (cleanup, (watchedRoomId, realtime))
    }
    cleanup?()
    guard let (roomId, liveRealtime) = target else { return }
    let name = roomChannelName(capability: liveRealtime.auth.tokenDetails?.capability, roomId: roomId)
    let channel = liveRealtime.channels.get(name)
    let initialHealth = RoomRealtimeHealth(connection: liveRealtime.connection.state, channel: channel.state)
    lock.withLock {
      guard roomGeneration == generation else { return }
      roomHealth = initialHealth
      roomHealthChannelName = name
    }
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
    let removeListeners = {
      channel.off(channelListener)
      liveRealtime.connection.off(connectionListener)
    }
    let kept = lock.withLock { () -> Bool in
      guard roomGeneration == generation else { return false }
      removeHealthListeners = removeListeners
      return true
    }
    guard kept else {
      removeListeners()
      return
    }
    updateHealth(roomId: roomId, generation: generation) { _ in false }
  }

  /// Moves the watched room's health onto the channel a new token names for it. Production names never move.
  private func rebindRoomHealthIfRenamed(capability: String?) {
    let renamed = lock.withLock { () -> Bool in
      guard let watchedRoomId, let bound = roomHealthChannelName else { return false }
      return roomChannelName(capability: capability, roomId: watchedRoomId) != bound
    }
    if renamed {
      bindRoomHealth()
    }
  }

  public func disconnect() {
    var cleanup: (() -> Void)?
    var membershipToStop: RoomMembershipSubscriptions?
    var presenceToStop: OrgPresenceChannel?
    var typingToStop: RoomTypingChannel?
    let control = lock.withLock { () -> ARTRealtimeChannel? in
      tokenSource?.invalidate()
      connectionGeneration = UUID()
      tokenSource = nil
      membershipToStop = membershipSubscriptions
      membershipSubscriptions = nil
      presenceToStop = presence
      presence = nil
      typingToStop = typing
      typing = nil
      roomGeneration = UUID()
      roomHealth = nil
      roomHealthChannelName = nil
      cleanup = removeHealthListeners
      removeHealthListeners = nil
      let control = controlChannel
      controlChannel = nil
      watchedRoomId = nil
      onEvent = nil
      return control
    }
    detachNotifications()
    membershipToStop?.stop()
    presenceToStop?.stop()
    typingToStop?.stop()
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

  private func detachNotifications() {
    let (notifications, listener, attachListener) = lock.withLock {
      defer {
        notificationsChannel = nil
        grantedChannelsListener = nil
        notificationsAttachListener = nil
        frontPresence.reset()
        invalidateFrontPresenceLocked()
      }
      return (notificationsChannel, grantedChannelsListener, notificationsAttachListener)
    }
    if let listener {
      lock.withLock { realtime }?.connection.off(listener)
    }
    if let attachListener {
      notifications?.off(attachListener)
    }
    notifications?.unsubscribe()
    notifications?.detach()
  }

  private func subscribeControl(realtime: ARTRealtime, userId: String, generation: UUID) {
    guard let name = userChatControlChannelName(grantedSubscribeIn: realtime.auth.tokenDetails?.capability, userId: userId) else { return }
    let control: ARTRealtimeChannel? = lock.withLock {
      guard connectionGeneration == generation, controlChannel == nil else { return nil }
      let channel = realtime.channels.get(name)
      controlChannel = channel
      return channel
    }
    guard let control else { return }
    for eventName in [chatMembershipRevokedEventName, chatRoomsChangedEventName] {
      control.subscribe(eventName) { [weak self] message in
        self?.forward(channelName: name, message: message, generation: generation)
      }
    }
  }

  private func subscribeNotifications(realtime: ARTRealtime, userId: String, generation: UUID) {
    guard let name = userNotificationsChannelName(grantedSubscribeIn: realtime.auth.tokenDetails?.capability, userId: userId) else { return }
    let channel: ARTRealtimeChannel? = lock.withLock {
      guard connectionGeneration == generation, notificationsChannel == nil else { return nil }
      let channel = realtime.channels.get(name)
      notificationsChannel = channel
      return channel
    }
    guard let channel else { return }
    // Registered before the attach the subscribe asks for, so the first one
    // is not missed. An attach onto a channel that is already attached
    // arrives as an update rather than an attached event, and only when it
    // did not resume: one that resumed kept its members on the server and
    // reports nothing, which is the case that needs nothing sent. One that
    // did not resume puts the members Ably holds back, so the answer belongs
    // there. An update is also how Ably reports a member it put back by
    // itself and had refused, which arrives after the attach this already
    // answered, so answering it too is a second attempt at the enter the
    // first one may have failed. A message the channel could not decode
    // arrives the same way, so the answer is sometimes sent for nothing,
    // which costs one presence call.
    let attachListener = channel.on { [weak self] change in
      guard let self else { return }
      switch change.event {
      case .attached, .update:
        sendRestored()
      case .detached, .failed:
        lock.withLock {
          frontPresence.channelLost()
          invalidateFrontPresenceLocked()
        }
      default:
        break
      }
    }
    lock.withLock { notificationsAttachListener = attachListener }
    channel.subscribe(notificationCreatedEventName) { [weak self] message in
      self?.forward(channelName: name, message: message, generation: generation)
    }
    if channel.state == .attached {
      sendRestored()
    }
  }

  /// Tell the notifications channel what the reader is looking at.
  ///
  /// A refused enter costs the reader one email that arrives without its
  /// delay, and the next restore sends it again. A refused leave is the
  /// expensive one: Ably keeps holding the member, Core reads the reader as
  /// looking for as long as it does, and every email then waits out its
  /// category's delay, so that one is tried again.
  ///
  /// The Ably call itself is made outside the lock, because ably-cocoa
  /// answers on a queue of its own. Each send is numbered and dispatched
  /// in order, and a retry that was numbered before a later answer is
  /// dropped rather than left to undo it. The web client does the same
  /// with `asks`.
  private func send(
    _ action: NotificationFrontPresence.Action,
    asked: Int? = nil
  ) {
    guard action != .none else { return }
    let token = lock.withLock { asked ?? frontPresenceAsks }
    frontPresenceDispatch.async { [weak self] in
      self?.dispatchFrontPresence(asked: token)
    }
  }

  private func sendRestored() {
    let action = lock.withLock { () -> NotificationFrontPresence.Action in
      invalidateFrontPresenceLocked()
      return frontPresence.restored
    }
    send(action)
  }

  private func invalidateFrontPresenceLocked() {
    frontPresenceRetry?.cancel()
    frontPresenceRetry = nil
    frontPresenceAsks += 1
  }

  private func dispatchFrontPresence(asked: Int) {
    let snapshot = lock.withLock { () -> (NotificationFrontPresence.Action, ARTRealtimeChannel?)? in
      guard asked == frontPresenceAsks else { return nil }
      return (frontPresence.restored, notificationsChannel)
    }
    guard let (action, channel) = snapshot, action != .none, let channel else { return }
    switch action {
    case .enter:
      channel.presence.enter(nil)
    case .leave:
      channel.presence.leave(nil) { [weak self] error in
        guard let self else { return }
        let shouldRetry = lock.withLock { () -> Bool? in
          guard asked == frontPresenceAsks else { return nil }
          if error == nil {
            frontPresence.leaveAccepted()
            return false
          }
          return true
        }
        guard shouldRetry == true else { return }
        let attached = lock.withLock { notificationsChannel }?.state == .attached
        armFrontPresenceRetry(channelAttached: attached)
      }
    case .none:
      return
    }
    lock.withLock {
      guard asked == frontPresenceAsks else { return }
      frontPresence.sent(action)
    }
  }

  /// One retry in flight at a time. A refusal that arrives while one is
  /// already armed is dropped without spending the budget: the retry in
  /// flight sends the same answer, so counting the second would empty the
  /// budget on refusals that arm nothing.
  private func armFrontPresenceRetry(channelAttached: Bool) {
    let asked = lock.withLock { () -> Int? in
      guard frontPresenceRetry == nil, notificationsChannel != nil,
            frontPresence.leaveRefused(channelAttached: channelAttached)
      else { return nil }
      return frontPresenceAsks
    }
    guard let asked else { return }
    let task = Task { [weak self] in
      do { try await Task.sleep(for: .seconds(frontPresenceRetryDelay)) } catch { return }
      guard let self else { return }
      let action = lock.withLock { () -> NotificationFrontPresence.Action? in
        frontPresenceRetry = nil
        guard asked == frontPresenceAsks else { return nil }
        return frontPresence.restored
      }
      if let action {
        send(action, asked: asked)
      }
    }
    let kept = lock.withLock { () -> Bool in
      guard frontPresenceRetry == nil, asked == frontPresenceAsks, notificationsChannel != nil else {
        return false
      }
      frontPresenceRetry = task
      return true
    }
    if !kept {
      task.cancel()
    }
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

extension Components.Schemas.AblyTokenRequest {
  /// Core token JSON for `ARTTokenRequest.fromJson` (timestamps and ttl in milliseconds).
  var artTokenRequestJSON: String? {
    var dict: [String: Any] = [
      "keyName": keyName,
      "capability": capability,
      "timestamp": timestamp,
      "nonce": nonce,
      "mac": mac
    ]
    if let clientId {
      dict["clientId"] = clientId
    }
    if let ttl {
      dict["ttl"] = ttl
    }
    guard let data = try? JSONSerialization.data(withJSONObject: dict),
          let string = String(data: data, encoding: .utf8)
    else {
      return nil
    }
    return string
  }
}

/// How long a refused leave waits before the app sends it again.
private let frontPresenceRetryDelay: TimeInterval = 15

/// The room's channel as the token names it; the production name when it names none.
private func roomChannelName(capability: String?, roomId: String) -> String {
  chatRoomChannelNames(grantedSubscribeIn: capability)?[roomId] ?? chatRoomChannelName(roomId: roomId)
}

private func ablyRealtimeError(_ message: String) -> NSError {
  NSError(domain: "SokosumiRealtime", code: -1, userInfo: [NSLocalizedDescriptionKey: message])
}
