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
