@testable import SokosumiRealtime
import Testing

private let granted = #"{"presence:org_org_1":["presence","subscribe"],"chat_rooms:room_a":["subscribe"]}"#

struct OrgPresenceScopeTests {
  @Test func personalWorkspaceNeverAuthorizes() {
    var scope = OrgPresenceScope()
    let beforeSelection = scope.requestAuthorization()
    scope.setOrganization(nil)
    let afterPersonal = scope.requestAuthorization()
    #expect(beforeSelection == nil && afterPersonal == nil)
    #expect(!scope.isGranted)
  }

  @Test func grantFollowsTheTokenCapability() throws {
    var scope = OrgPresenceScope()
    scope.setOrganization("org_1")
    let firstRequest = scope.requestAuthorization()
    let first = try #require(firstRequest)
    let granted = scope.finishAuthorization(first, capability: granted, failed: false)
    #expect(granted == .granted("org_1"))
    #expect(scope.isGranted)
    let secondRequest = scope.requestAuthorization()
    let second = try #require(secondRequest)
    let subscribeOnly = scope.finishAuthorization(second, capability: #"{"presence:org_org_1":["subscribe"]}"#, failed: false)
    #expect(subscribeOnly == .denied(failed: false))
    #expect(!scope.isGranted)
    let thirdRequest = scope.requestAuthorization()
    let third = try #require(thirdRequest)
    let failed = scope.finishAuthorization(third, capability: nil, failed: true)
    #expect(failed == .denied(failed: true))
    let fourthRequest = scope.requestAuthorization()
    let fourth = try #require(fourthRequest)
    let malformed = scope.finishAuthorization(fourth, capability: "garbage", failed: false)
    #expect(malformed == .denied(failed: false))
  }

  @Test func organizationSwitchRejectsInFlightResultAndCoalescesRequests() throws {
    var scope = OrgPresenceScope()
    scope.setOrganization("org_1")
    let staleRequest = scope.requestAuthorization()
    let stale = try #require(staleRequest)
    let duplicate = scope.requestAuthorization()
    #expect(duplicate == nil)
    let queuedOnce = scope.takeQueued()
    let queuedTwice = scope.takeQueued()
    #expect(queuedOnce && !queuedTwice)
    scope.setOrganization("org_2")
    let staleOutcome = scope.finishAuthorization(stale, capability: granted, failed: false)
    #expect(staleOutcome == .stale)
    #expect(!scope.isGranted)
    let freshRequest = scope.requestAuthorization()
    let fresh = try #require(freshRequest)
    let queuedDuringFresh = scope.requestAuthorization()
    #expect(queuedDuringFresh == nil)
    let otherOrganization = scope.finishAuthorization(fresh, capability: granted, failed: false)
    #expect(otherOrganization == .denied(failed: false))
    let queued = scope.takeQueued()
    #expect(queued)
    let repeated = scope.finishAuthorization(fresh, capability: granted, failed: false)
    #expect(repeated == .stale)
  }
}
