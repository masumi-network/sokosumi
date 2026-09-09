import Ably
import Foundation
import SokosumiChat

/// ably-cocoa-backed `RealtimeConnection` (SOK-976).
///
/// One socket: the user chat-control channel plus the watched room channel.
/// Auth tokens come from Core (`POST /v1/realtime/ably-token`) through the
/// provider, so capabilities track membership; `reauthorize` remints after
/// join/leave/revoke. Ably invokes callbacks off the main thread — events
/// hop out through the `Sendable` handler for the app to apply on MainActor.
/// No presence enter (ADR 0003), no push (ADR 0022 / 0023).
public final class AblyRealtimeConnection: RealtimeConnection, @unchecked Sendable {
  private let lock = NSLock()
  private var realtime: ARTRealtime?
  private var controlChannel: ARTRealtimeChannel?
  private var roomChannel: ARTRealtimeChannel?
  private var watchedRoomId: String?
  private var organizationSlug: String?
  private var onEvent: RealtimeEventHandler?

  public init() {}

  public func connect(
    userId: String,
    organizationSlug: String?,
    tokenProvider: @escaping RealtimeTokenProvider,
    onEvent: @escaping RealtimeEventHandler
  ) {
    disconnect()
    lock.withLock {
      self.organizationSlug = organizationSlug
      self.onEvent = onEvent
    }
    let options = ARTClientOptions()
    options.echoMessages = false
    options.authCallback = { [weak self] _, callback in
      let slug = self?.lockedSlug()
      Task {
        do {
          let fields = try await tokenProvider(slug)
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
      self?.forward(channelName: controlName, message: message)
    }
    lock.withLock {
      self.realtime = realtime
      controlChannel = control
    }
  }

  public func setOrganizationSlug(_ slug: String?) {
    lock.withLock { organizationSlug = slug }
  }

  private func lockedSlug() -> String? {
    lock.withLock { organizationSlug }
  }

  public func watchRoom(_ roomId: String?) {
    let transition: (ARTRealtimeChannel?, ARTRealtime?)? = lock.withLock {
      guard watchedRoomId != roomId else { return nil }
      watchedRoomId = roomId
      let previous = roomChannel
      roomChannel = nil
      return (previous, realtime)
    }
    guard let (previous, liveRealtime) = transition else { return }
    previous?.unsubscribe()
    previous?.detach()
    guard let roomId, let liveRealtime else { return }
    let channel = liveRealtime.channels.get(chatRoomChannelName(roomId: roomId))
    let channelName = channel.name
    channel.subscribe(chatRoomMessageEventName) { [weak self] message in
      self?.forward(channelName: channelName, message: message)
    }
    lock.withLock { self.roomChannel = channel }
  }

  public func reauthorize() {
    guard let realtime = lock.withLock({ self.realtime }) else { return }
    realtime.auth.authorize(nil, options: nil) { _, _ in }
  }

  public func disconnect() {
    let channels = lock.withLock { () -> (ARTRealtimeChannel?, ARTRealtimeChannel?) in
      let pair = (roomChannel, controlChannel)
      roomChannel = nil
      controlChannel = nil
      watchedRoomId = nil
      onEvent = nil
      return pair
    }
    channels.0?.unsubscribe()
    channels.0?.detach()
    channels.1?.unsubscribe()
    channels.1?.detach()
    lock.withLock {
      realtime?.close()
      realtime = nil
    }
  }

  private func forward(channelName: String?, message: ARTMessage) {
    guard let channelName,
          let onEvent = lock.withLock({ self.onEvent })
    else {
      return
    }
    let data: Any = message.data ?? NSNull()
    onEvent(resolveRealtimeDelivery(channel: channelName, event: message.name ?? "", data: data))
  }
}

private func ablyRealtimeError(_ message: String) -> NSError {
  NSError(domain: "SokosumiRealtime", code: -1, userInfo: [NSLocalizedDescriptionKey: message])
}
