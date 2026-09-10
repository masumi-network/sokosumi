import Ably

/// Mirrors web's selected-room health observer, including attached-to-attached
/// updates without continuity. The first attach is not a delivery gap.
struct RoomRealtimeHealth {
  private var connected: Bool
  private var attached: Bool
  private var attachedBefore: Bool

  var isHealthy: Bool {
    connected && attached
  }

  init(connection: ARTRealtimeConnectionState, channel: ARTRealtimeChannelState) {
    connected = connection == .connected
    attached = channel == .attached
    attachedBefore = attached
  }

  mutating func connectionChanged(current: ARTRealtimeConnectionState, previous: ARTRealtimeConnectionState) -> Bool {
    connected = current == .connected
    return connected && (previous == .disconnected || previous == .suspended)
  }

  mutating func channelChanged(current: ARTRealtimeChannelState, resumed: Bool) -> Bool {
    attached = current == .attached
    if attached {
      let lostContinuity = attachedBefore && !resumed
      attachedBefore = true
      return lostContinuity
    }
    return current == .failed || current == .suspended
  }
}
