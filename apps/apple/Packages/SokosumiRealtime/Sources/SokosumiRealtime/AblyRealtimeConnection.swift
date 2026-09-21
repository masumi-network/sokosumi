import Ably
import Foundation
import SokosumiChat

/// ably-cocoa-backed `RealtimeConnection` (SOK-976).
///
/// One socket: the user chat-control channel, the user notifications channel
/// (when the token grants it), membership room channels and the active
/// organization's presence channel (ADR 0003). Auth tokens come
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
  private var notificationsListener: ARTEventListener?
  private var notificationsAttachListener: ARTEventListener?
  private var watchedRoomId: String?
  private var tokenSource: RealtimeTokenSource?
  private var membershipSubscriptions: RoomMembershipSubscriptions?
  private var presence: OrgPresenceChannel?
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
    // Core names the notifications channel per deployment, so it is read from
    // the granted capability once a token exists rather than built here.
    let notificationsListener = realtime.connection.on { [weak self, weak realtime] change in
      guard change.current == .connected, let realtime else { return }
      self?.subscribeNotifications(realtime: realtime, userId: userId, generation: generation)
    }
    lock.withLock {
      self.realtime = realtime
      self.notificationsListener = notificationsListener
      controlChannel = control
      membershipSubscriptions = RoomMembershipSubscriptions(realtime: realtime, onEvent: onEvent)
      presence = OrgPresenceChannel(realtime: realtime, onEvent: onEvent)
    }
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
    var presenceToStop: OrgPresenceChannel?
    let control = lock.withLock { () -> ARTRealtimeChannel? in
      tokenSource?.invalidate()
      connectionGeneration = UUID()
      tokenSource = nil
      membershipSubscriptions?.stop()
      membershipSubscriptions = nil
      presenceToStop = presence
      presence = nil
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
    let (notifications, listener, attachListener) = lock.withLock {
      defer {
        notificationsChannel = nil
        notificationsListener = nil
        notificationsAttachListener = nil
        frontPresence.reset()
        invalidateFrontPresenceLocked()
      }
      return (notificationsChannel, notificationsListener, notificationsAttachListener)
    }
    if let listener {
      lock.withLock { realtime }?.connection.off(listener)
    }
    if let attachListener {
      notifications?.off(attachListener)
    }
    notifications?.unsubscribe()
    notifications?.detach()
    presenceToStop?.stop()
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

/// How long a refused leave waits before the app sends it again.
private let frontPresenceRetryDelay: TimeInterval = 15

private func ablyRealtimeError(_ message: String) -> NSError {
  NSError(domain: "SokosumiRealtime", code: -1, userInfo: [NSLocalizedDescriptionKey: message])
}
