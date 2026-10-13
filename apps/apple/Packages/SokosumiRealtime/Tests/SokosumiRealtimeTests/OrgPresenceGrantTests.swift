import SokosumiChat
@testable import SokosumiRealtime
import Testing

private typealias PresenceScope = GatedScope<Bool>

/// Org presence's reader: `presence` on the organization's channel.
private func presenceScope() -> PresenceScope {
  PresenceScope { capability, organizationId in
    (organizationIds(grantedPresenceIn: capability) ?? []).contains(organizationId) ? true : nil
  }
}

private let granted = #"{"presence:org_org_1":["presence","subscribe"],"chat_rooms:room_a":["subscribe"]}"#

/// Org presence on the shared gated scope: entering waits for `presence` on that organization's channel.
struct OrgPresenceGrantTests {
  @Test func personalWorkspaceNeverAuthorizes() {
    var scope = presenceScope()
    let beforeSelection = scope.requestAuthorization()
    scope.setTarget(nil)
    let afterPersonal = scope.requestAuthorization()
    #expect(beforeSelection == nil && afterPersonal == nil)
    #expect(scope.grant == nil)
  }

  @Test func grantFollowsTheTokenCapability() throws {
    var scope = presenceScope()
    scope.setTarget("org_1")
    let firstRequest = scope.requestAuthorization()
    let first = try #require(firstRequest)
    let granted = scope.finishAuthorization(first, capability: granted, failed: false)
    #expect(granted == .granted(target: "org_1", grant: true))
    #expect(scope.grant == true)
    let secondRequest = scope.requestAuthorization()
    let second = try #require(secondRequest)
    let subscribeOnly = scope.finishAuthorization(second, capability: #"{"presence:org_org_1":["subscribe"]}"#, failed: false)
    #expect(subscribeOnly == .denied(target: "org_1", failed: false))
    #expect(scope.grant == nil)
    let thirdRequest = scope.requestAuthorization()
    let third = try #require(thirdRequest)
    let failed = scope.finishAuthorization(third, capability: nil, failed: true)
    #expect(failed == .denied(target: "org_1", failed: true))
    let fourthRequest = scope.requestAuthorization()
    let fourth = try #require(fourthRequest)
    let malformed = scope.finishAuthorization(fourth, capability: "garbage", failed: false)
    #expect(malformed == .denied(target: "org_1", failed: false))
  }

  @Test func organizationSwitchRejectsInFlightResultAndCoalescesRequests() throws {
    var scope = presenceScope()
    scope.setTarget("org_1")
    let staleRequest = scope.requestAuthorization()
    let stale = try #require(staleRequest)
    let duplicate = scope.requestAuthorization()
    #expect(duplicate == nil)
    let queuedOnce = scope.takeQueued()
    let queuedTwice = scope.takeQueued()
    #expect(queuedOnce && !queuedTwice)
    scope.setTarget("org_2")
    let staleOutcome = scope.finishAuthorization(stale, capability: granted, failed: false)
    #expect(staleOutcome == .stale)
    #expect(scope.grant == nil)
    let freshRequest = scope.requestAuthorization()
    let fresh = try #require(freshRequest)
    let queuedDuringFresh = scope.requestAuthorization()
    #expect(queuedDuringFresh == nil)
    let otherOrganization = scope.finishAuthorization(fresh, capability: granted, failed: false)
    #expect(otherOrganization == .denied(target: "org_2", failed: false))
    let queued = scope.takeQueued()
    #expect(queued)
    let repeated = scope.finishAuthorization(fresh, capability: granted, failed: false)
    #expect(repeated == .stale)
  }
}
