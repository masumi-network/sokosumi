import Ably
@testable import SokosumiRealtime
import Testing

struct RoomRealtimeHealthTests {
  @Test func healthyRequiresBothConnectionAndChannel() {
    var health = RoomRealtimeHealth(connection: .connecting, channel: .initialized)
    #expect(!health.isHealthy)
    let gap1 = health.channelChanged(current: .attached, resumed: false)
    #expect(!gap1)
    #expect(!health.isHealthy)
    let gap2 = health.connectionChanged(current: .connected, previous: .connecting)
    #expect(!gap2)
    #expect(health.isHealthy)
    let gap3 = health.connectionChanged(current: .disconnected, previous: .connected)
    #expect(!gap3)
    #expect(!health.isHealthy)
    let gap4 = health.connectionChanged(current: .connected, previous: .disconnected)
    #expect(gap4)
    #expect(health.isHealthy)
  }

  @Test func resumedAttachPreservesContinuityButUpdateCanLoseIt() {
    var health = RoomRealtimeHealth(connection: .connected, channel: .initialized)
    let gap5 = health.channelChanged(current: .attached, resumed: false)
    #expect(!gap5)
    let gap6 = health.channelChanged(current: .attached, resumed: true)
    #expect(!gap6)
    let gap7 = health.channelChanged(current: .attached, resumed: false)
    #expect(gap7)
    #expect(health.isHealthy)
    let gap8 = health.channelChanged(current: .suspended, resumed: false)
    #expect(gap8)
    #expect(!health.isHealthy)
    let gap9 = health.channelChanged(current: .attached, resumed: false)
    #expect(gap9)
    let gap10 = health.channelChanged(current: .failed, resumed: false)
    #expect(gap10)
    #expect(!health.isHealthy)
  }

  @Test func alreadyAttachedChannelCountsAsPriorAttachment() {
    var health = RoomRealtimeHealth(connection: .connected, channel: .attached)
    #expect(health.isHealthy)
    let gap11 = health.channelChanged(current: .attached, resumed: false)
    #expect(gap11)
    let gap12 = health.connectionChanged(current: .connected, previous: .suspended)
    #expect(gap12)
  }
}
