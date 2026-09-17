import CoreAPI
import Foundation
@testable import SokosumiChat
import Testing

private let now = Date(timeIntervalSince1970: 1_800_000_000)

private func member(_ userId: String, activeAgo: TimeInterval = 0) -> ChatPresenceMember {
  ChatPresenceMember(clientId: "\(userId):inst_00000001", data: ChatPresenceMemberData(lastActiveAt: now.addingTimeInterval(-activeAgo), visible: true))
}

@MainActor struct OrgPresenceTests {
  @Test func rosterAppliesOnlyToTheActiveOrganizationAndAgesLocally() {
    let presence = OrgPresence(now: now)
    presence.setOrganization("org_1")
    presence.replaceRoster(organizationId: "org_2", members: [member("stranger")], now: now)
    #expect(presence.byUserId.isEmpty)
    presence.replaceRoster(organizationId: "org_1", members: [member("alice"), member("bob", activeAgo: 290)], now: now)
    #expect(presence.presence(forUser: "alice", fallback: .offline) == .online)
    #expect(presence.presence(forUser: "bob", fallback: .offline) == .online)
    #expect(presence.presence(forUser: "carol", fallback: .afk) == .afk)
    presence.reclassify(now: now.addingTimeInterval(20))
    #expect(presence.presence(forUser: "bob", fallback: .offline) == .afk)
    #expect(presence.presence(forUser: "alice", fallback: .offline) == .online)
  }

  @Test func switchingOrganizationDropsRosterAndForcesNextPublish() {
    let presence = OrgPresence(now: now)
    presence.setOrganization("org_1")
    presence.replaceRoster(organizationId: "org_1", members: [member("alice")], now: now)
    #expect(presence.publication(force: true, now: now) != nil)
    #expect(presence.publication(force: false, now: now.addingTimeInterval(1)) == nil)
    presence.setOrganization("org_2")
    #expect(presence.byUserId.isEmpty)
    #expect(presence.organizationId == "org_2")
    #expect(presence.publication(force: false, now: now.addingTimeInterval(2)) != nil)
    presence.setOrganization(nil)
    #expect(presence.publication(force: true, now: now.addingTimeInterval(3)) == nil)
    presence.reset()
    #expect(presence.organizationId == nil)
    #expect(presence.selfPresence == .online)
  }

  @Test func activityAndVisibilityDriveSelfPresenceAndPayload() {
    let presence = OrgPresence(now: now)
    presence.setOrganization("org_1")
    presence.setReachable(false, now: now)
    #expect(presence.selfPresence == .offline)
    presence.setReachable(true, now: now.addingTimeInterval(400))
    #expect(presence.selfPresence == .afk)
    presence.recordActivity(now: now.addingTimeInterval(400))
    #expect(presence.selfPresence == .online)
    presence.setVisible(false, now: now.addingTimeInterval(401))
    #expect(presence.selfPresence == .afk)
    let hidden = presence.publication(force: false, now: now.addingTimeInterval(401))
    #expect(hidden?.visible == false)
    #expect(hidden?.lastActiveAt == now.addingTimeInterval(400))
    presence.setVisible(true, now: now.addingTimeInterval(402))
    #expect(presence.selfPresence == .online)
    #expect(presence.publication(force: false, now: now.addingTimeInterval(402))?.lastActiveAt == now.addingTimeInterval(402))
  }
}
