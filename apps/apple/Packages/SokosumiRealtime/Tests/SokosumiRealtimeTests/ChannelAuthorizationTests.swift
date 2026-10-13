import Ably
import Foundation
@testable import SokosumiRealtime
import Testing

/// Exercises the actual channel listeners without opening a socket or requesting a token
/// from Ably. A successful token renewal reports `update`, with both states connected.
@MainActor struct ChannelAuthorizationTests {
  @Test(arguments: [true, false]) func tokenUpdatesDoNotAuthorizeAgain(typing: Bool) async throws {
    let requests = AuthorizationRequests()
    let options = ARTClientOptions()
    options.autoConnect = false
    options.authCallback = { _, callback in
      requests.record()
      callback(nil, NSError(domain: "OfflineAuthorizationTest", code: 1))
    }
    let realtime = OfflineRealtime(options: options)
    let stop: () -> Void
    if typing {
      let channel = RoomTypingChannel(realtime: realtime, userId: "me", onEvent: { _ in })
      channel.setRoom("a")
      stop = { channel.stop() }
    } else {
      let channel = OrgPresenceChannel(realtime: realtime, onEvent: { _ in })
      channel.setOrganization("a")
      stop = { channel.stop() }
    }
    defer {
      stop()
      realtime.close()
    }
    for _ in 0 ..< 100 where requests.count < 1 {
      try await Task.sleep(for: .milliseconds(10))
    }
    #expect(requests.count == 1)

    realtime.events.emit(.init(current: .connected, previous: .connected, event: .update, reason: nil))
    try await Task.sleep(for: .milliseconds(100))
    #expect(requests.count == 1)

    // A real reconnect still requests a fresh membership grant.
    realtime.events.emit(.init(current: .connected, previous: .disconnected, event: .connected, reason: nil))
    for _ in 0 ..< 100 where requests.count < 2 {
      try await Task.sleep(for: .milliseconds(10))
    }
    #expect(requests.count == 2)
  }

  /// `disconnect` closes the socket right after `stop`, so the room channels must already be detached by then.
  @Test func membershipStopDetachesTheRoomsBeforeItReturns() async throws {
    let realtime = RecordingRealtime(options: Self.offlineOptions())
    let subscriptions = RoomMembershipSubscriptions(realtime: realtime, authorize: { $0(nil, false) }, onEvent: { _ in })
    defer { realtime.close() }
    subscriptions.update(["a"])
    for _ in 0 ..< 100 where !realtime.log.contains("subscribe chat_rooms:room_a") {
      try await Task.sleep(for: .milliseconds(10))
    }
    #expect(realtime.log.contains("subscribe chat_rooms:room_a"))

    subscriptions.stop()
    #expect(realtime.log.suffix(2) == ["unsubscribe chat_rooms:room_a", "detach chat_rooms:room_a"])
  }

  @Test func membershipRetriesAFailedMintOnItsClock() async throws {
    let requests = AuthorizationRequests()
    let clock = ManualSleep()
    let realtime = RecordingRealtime(options: Self.offlineOptions())
    let subscriptions = RoomMembershipSubscriptions(
      realtime: realtime,
      authorize: { completion in
        requests.record()
        completion(nil, requests.count == 1)
      },
      sleep: clock.sleep,
      onEvent: { _ in }
    )
    defer {
      subscriptions.stop()
      realtime.close()
    }
    subscriptions.update(["a"])
    for _ in 0 ..< 100 where clock.pending < 1 {
      try await Task.sleep(for: .milliseconds(10))
    }
    #expect(clock.pending == 1)
    #expect(requests.count == 1)
    #expect(realtime.log.isEmpty)

    clock.fire()
    for _ in 0 ..< 100 where !realtime.log.contains("subscribe chat_rooms:room_a") {
      try await Task.sleep(for: .milliseconds(10))
    }
    #expect(requests.count == 2)
    #expect(realtime.log.contains("subscribe chat_rooms:room_a"))
  }

  private static func offlineOptions() -> ARTClientOptions {
    let options = ARTClientOptions()
    options.autoConnect = false
    options.authCallback = { _, callback in
      callback(nil, NSError(domain: "OfflineAuthorizationTest", code: 1))
    }
    return options
  }
}

private final class AuthorizationRequests: @unchecked Sendable {
  private let lock = NSLock()
  private var value = 0
  var count: Int {
    lock.withLock { value }
  }

  func record() {
    lock.withLock { value += 1 }
  }
}

private final class OfflineRealtime: ARTRealtime, @unchecked Sendable {
  let events = OfflineConnection()
  override var connection: ARTConnection {
    events
  }
}

/// An offline socket whose channels record what is asked of them instead of attaching.
private final class RecordingRealtime: ARTRealtime, @unchecked Sendable {
  let events = OfflineConnection()
  private let recorded = RecordingChannels()
  var log: [String] {
    recorded.log
  }

  override var connection: ARTConnection {
    events
  }

  override var channels: ARTRealtimeChannels {
    recorded
  }
}

private final class RecordingChannels: ARTRealtimeChannels, @unchecked Sendable {
  private let lock = NSLock()
  private var entries: [String] = []
  var log: [String] {
    lock.withLock { entries }
  }

  override func get(_ name: String) -> ARTRealtimeChannel {
    RecordingChannel(name: name, channels: self)
  }

  func record(_ entry: String) {
    lock.withLock { entries.append(entry) }
  }
}

private final class RecordingChannel: ARTRealtimeChannel, @unchecked Sendable {
  private let channelName: String
  private let channels: RecordingChannels

  init(name: String, channels: RecordingChannels) {
    channelName = name
    self.channels = channels
    super.init()
  }

  override func subscribe(_: String, callback _: @escaping ARTMessageCallback) -> ARTEventListener? {
    channels.record("subscribe \(channelName)")
    return nil
  }

  override func unsubscribe() {
    channels.record("unsubscribe \(channelName)")
  }

  override func detach() {
    channels.record("detach \(channelName)")
  }
}

/// The public SDK event-registration surface, preserving its named versus all-event behavior.
private final class OfflineConnection: ARTConnection, @unchecked Sendable {
  private struct Registration {
    let event: ARTRealtimeConnectionEvent?
    let callback: (ARTConnectionStateChange) -> Void
    let listener: ARTEventListener
  }

  private let lock = NSLock()
  private var registrations: [Registration] = []
  override var state: ARTRealtimeConnectionState {
    .initialized
  }

  override func on(_ callback: @escaping (ARTConnectionStateChange) -> Void) -> ARTEventListener {
    register(nil, callback: callback)
  }

  override func on(_ event: ARTRealtimeConnectionEvent, callback: @escaping (ARTConnectionStateChange) -> Void) -> ARTEventListener {
    register(event, callback: callback)
  }

  private func register(_ event: ARTRealtimeConnectionEvent?, callback: @escaping (ARTConnectionStateChange) -> Void) -> ARTEventListener {
    let listener = ARTEventListener()
    lock.withLock { registrations.append(.init(event: event, callback: callback, listener: listener)) }
    return listener
  }

  override func off(_ listener: ARTEventListener) {
    lock.withLock { registrations.removeAll { $0.listener === listener } }
  }

  func emit(_ change: ARTConnectionStateChange) {
    let current = lock.withLock { registrations }
    for registration in current where registration.event == nil || registration.event == change.event {
      registration.callback(change)
    }
  }
}
