import CoreAPI
import Foundation
@testable import SokosumiChat
import Testing

private let now = Date(timeIntervalSince1970: 1_800_000_000)

private func member(_ userId: String, instance: String = "inst_00000001", activeAgo: TimeInterval = 0, visible: Bool = true) -> ChatPresenceMember {
  ChatPresenceMember(clientId: "\(userId):\(instance)", data: ChatPresenceMemberData(lastActiveAt: now.addingTimeInterval(-activeAgo), visible: visible))
}

struct ChatPresenceTests {
  @Test func channelNamesRoundTrip() {
    #expect(orgPresenceChannelName(organizationId: "org_1") == "presence:org_org_1")
    #expect(parseOrganizationId(fromPresenceChannelName: "presence:org_org_1") == "org_1")
    #expect(parseOrganizationId(fromPresenceChannelName: "presence:org_") == nil)
    #expect(parseOrganizationId(fromPresenceChannelName: "chat_rooms:room_1") == nil)
  }

  @Test func clientIdParsingRejectsSpoofableShapes() {
    #expect(parseUserId(fromAblyPresenceClientId: "user_1:inst_00000001") == "user_1")
    #expect(parseUserId(fromAblyPresenceClientId: "user_1:short") == nil)
    #expect(parseUserId(fromAblyPresenceClientId: ":inst_00000001") == nil)
    #expect(parseUserId(fromAblyPresenceClientId: "user_1") == nil)
    #expect(parseUserId(fromAblyPresenceClientId: "user_1:has space!x") == nil)
  }

  @Test func capabilityGrantsOnlyPresenceOrganizations() {
    let capability = """
    {"presence:org_a":["presence","subscribe"],"presence:org_b":["subscribe"],"chat_rooms:room_1":["subscribe"],"presence:org_":["presence"]}
    """
    #expect(organizationIds(grantedPresenceIn: capability) == ["a"])
    #expect(organizationIds(grantedPresenceIn: "{}")?.isEmpty == true)
    #expect(organizationIds(grantedPresenceIn: nil) == nil)
    #expect(organizationIds(grantedPresenceIn: "[1]") == nil)
    #expect(organizationIds(grantedPresenceIn: "not json") == nil)
  }

  @Test func memberDataDecodesWebWireShapeOnly() throws {
    let millis = 1_800_000_000_123
    let decoded = try #require(ChatPresenceMemberData(wire: ["lastActiveAt": millis, "visible": false]))
    #expect(decoded.visible == false)
    #expect(abs(decoded.lastActiveAt.timeIntervalSince1970 - 1_800_000_000.123) < 0.001)
    let json = try JSONSerialization.jsonObject(with: Data("{\"lastActiveAt\":\(millis),\"visible\":true}".utf8))
    #expect(ChatPresenceMemberData(wire: json)?.visible == true)
    #expect(ChatPresenceMemberData(wire: ["lastActiveAt": "soon", "visible": true]) == nil)
    #expect(ChatPresenceMemberData(wire: ["lastActiveAt": millis, "visible": 1]) == nil)
    #expect(ChatPresenceMemberData(wire: ["lastActiveAt": true, "visible": true]) == nil)
    #expect(ChatPresenceMemberData(wire: nil) == nil)
    #expect(ChatPresenceMemberData(wire: [millis]) == nil)
    let original = ChatPresenceMemberData(lastActiveAt: Date(timeIntervalSince1970: 1_800_000_000.5), visible: true)
    #expect(ChatPresenceMemberData(wire: original.wire) == original)
    #expect(original.wire["lastActiveAt"] as? Int == 1_800_000_000_500)
  }

  @Test func aggregationPrefersAnyOnlineDevice() {
    let map = aggregateChatPresence(members: [
      member("alice", instance: "inst_00000001", activeAgo: 600),
      member("alice", instance: "inst_00000002", activeAgo: 10),
      member("bob", activeAgo: 10, visible: false),
      member("carol", activeAgo: 301),
      ChatPresenceMember(clientId: "dave:inst_00000001", data: nil),
      ChatPresenceMember(clientId: "spoof", data: nil)
    ], now: now)
    #expect(map == ["alice": .online, "bob": .afk, "carol": .afk, "dave": .afk])
    #expect(aggregateChatPresence(members: [member("carol", activeAgo: 300)], now: now) == ["carol": .online])
  }

  @Test func publisherThrottlesUnchangedAndIdlePresence() {
    var state = OrgPresencePublisherState(now: now)
    #expect(state.shouldPublish(force: false, now: now))
    state.markPublished(state.data, now: now)
    #expect(!state.shouldPublish(force: false, now: now.addingTimeInterval(60)))
    state.recordActivity(now: now.addingTimeInterval(60))
    #expect(!state.shouldPublish(force: false, now: now.addingTimeInterval(60)))
    state.recordActivity(now: now.addingTimeInterval(240))
    #expect(state.shouldPublish(force: false, now: now.addingTimeInterval(240)))
    state.markPublished(state.data, now: now.addingTimeInterval(240))
    state.setVisible(false, now: now.addingTimeInterval(241))
    #expect(state.shouldPublish(force: false, now: now.addingTimeInterval(241)))
    state.markPublished(state.data, now: now.addingTimeInterval(241))
    #expect(!state.shouldPublish(force: false, now: now.addingTimeInterval(242)))
    #expect(state.shouldPublish(force: true, now: now.addingTimeInterval(242)))
    state.setVisible(true, now: now.addingTimeInterval(243))
    #expect(state.lastActiveAt == now.addingTimeInterval(243))
    state.resetPublication()
    #expect(state.shouldPublish(force: false, now: now.addingTimeInterval(243)))
  }

  @Test func selfPresenceFollowsReachabilityVisibilityAndIdle() {
    var state = OrgPresencePublisherState(now: now)
    #expect(state.selfPresence(connected: true, now: now) == .online)
    #expect(state.selfPresence(connected: false, now: now) == .offline)
    #expect(state.selfPresence(connected: true, now: now.addingTimeInterval(301)) == .afk)
    state.setVisible(false, now: now)
    #expect(state.selfPresence(connected: true, now: now) == .afk)
  }
}
