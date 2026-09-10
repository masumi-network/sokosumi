@testable import SokosumiRealtime
import Testing

struct RoomSubscriptionMembershipTests {
  @Test func requestsDuringAuthorizationCoalesceAfterMembershipChanges() throws {
    var membership = RoomSubscriptionMembership()
    membership.update(["a"])
    let firstRequest = membership.requestAuthorization()
    let first = try #require(firstRequest)
    membership.update(["b"])
    let queued = membership.requestAuthorization()
    let duplicate = membership.requestAuthorization()
    #expect(queued == nil && duplicate == nil)
    #expect(membership.authorizedRooms(capability: nil, generation: first) == nil)
    let followUp = membership.finishAuthorization(first, failed: true)
    #expect(followUp == .immediate)
    #expect(!membership.needsRetry)
    let nextRequest = membership.requestAuthorization()
    let next = try #require(nextRequest)
    #expect(membership.authorizedRooms(capability: nil, generation: next) == ["b"])
    let stale = membership.finishAuthorization(first, failed: true)
    #expect(stale == .none)
    let completed = membership.finishAuthorization(next, failed: false)
    #expect(completed == .none)
  }

  @Test func workspaceResetRejectsOldResultAndRunsQueuedAuthorization() throws {
    var membership = RoomSubscriptionMembership()
    membership.update(["a"])
    let firstRequest = membership.requestAuthorization()
    let first = try #require(firstRequest)
    membership.resetScope()
    membership.update(["a"])
    let queued = membership.requestAuthorization()
    #expect(queued == nil)
    #expect(membership.authorizedRooms(capability: nil, generation: first) == nil)
    let followUp = membership.finishAuthorization(first, failed: false)
    #expect(followUp == .immediate)
    let nextRequest = membership.requestAuthorization()
    let next = try #require(nextRequest)
    #expect(membership.authorizedRooms(capability: nil, generation: next) == ["a"])
  }

  @Test func failedAuthorizationRequestsRetryUntilNextAttempt() throws {
    var membership = RoomSubscriptionMembership()
    let firstRequest = membership.requestAuthorization()
    let first = try #require(firstRequest)
    let failed = membership.finishAuthorization(first, failed: true)
    #expect(failed == .delayed)
    #expect(membership.needsRetry)
    let nextRequest = membership.requestAuthorization()
    let next = try #require(nextRequest)
    #expect(!membership.needsRetry)
    let completed = membership.finishAuthorization(next, failed: false)
    #expect(completed == .none)
  }

  @Test func explicitSubscribeCapabilitiesIntersectMembership() {
    var membership = RoomSubscriptionMembership()
    membership.update(["a", "b", "c"])
    let generation = membership.beginAuthorization()
    let capability = #"{"chat_rooms:room_a":["subscribe"],"chat_rooms:room_b":["publish"],"chat_rooms:room_other":["subscribe"],"chat_control:user_me":["subscribe"]}"#
    #expect(membership.authorizedRooms(capability: capability, generation: generation) == ["a"])
    #expect(membership.authorizedRooms(capability: "{}", generation: generation)?.isEmpty == true)
  }

  @Test func malformedCapabilitiesUseMembershipLikeWeb() {
    var membership = RoomSubscriptionMembership()
    membership.update(["a", "b"])
    let generation = membership.beginAuthorization()
    for capability in [nil, "invalid", "[]", "null"] as [String?] {
      #expect(membership.authorizedRooms(capability: capability, generation: generation) == ["a", "b"])
    }
  }

  @Test func revocationInvalidatesInflightAuthorizationAndBlocksStaleProps() {
    var membership = RoomSubscriptionMembership()
    membership.update(["a", "b"])
    let old = membership.beginAuthorization()
    membership.revoke("a")
    #expect(membership.authorizedRooms(capability: nil, generation: old) == nil)
    let fresh = membership.beginAuthorization()
    #expect(membership.authorizedRooms(capability: nil, generation: fresh) == ["b"])
    membership.update(["a", "b"])
    #expect(membership.authorizedRooms(capability: nil, generation: fresh) == ["b"])
    membership.update(["b"])
    membership.update(["a", "b"])
    let rejoined = membership.beginAuthorization()
    #expect(membership.authorizedRooms(capability: nil, generation: rejoined) == ["a", "b"])
  }

  @Test func newerAuthorizationAndWorkspaceMembershipInvalidateOldResults() {
    var membership = RoomSubscriptionMembership()
    membership.update(["a"])
    let old = membership.beginAuthorization()
    let latest = membership.beginAuthorization()
    #expect(membership.authorizedRooms(capability: nil, generation: old) == nil)
    membership.update(["b"])
    #expect(membership.authorizedRooms(capability: nil, generation: latest) == nil)
    #expect(membership.authorizedRooms(capability: nil, generation: membership.generation) == ["b"])
  }
}
