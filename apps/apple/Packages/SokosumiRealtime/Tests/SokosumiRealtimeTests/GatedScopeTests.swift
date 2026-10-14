import Ably
import Foundation
import SokosumiChat
@testable import SokosumiRealtime
import Testing

private let both = #"{"chat_typing:room_a":["publish","subscribe"],"chat_rooms:room_a":["subscribe"]}"#

private typealias TypingScope = GatedScope<ChatTypingGrant>

private func typingScope() -> TypingScope {
  TypingScope { capability, roomId in chatTypingGrant(in: capability, roomId: roomId) }
}

/// One settled authorization: request, then finish with `capability`.
private func authorize(_ scope: inout TypingScope, capability: String?, failed: Bool = false) throws -> TypingScope.Outcome {
  let request = scope.requestAuthorization()
  let id = try #require(request)
  return scope.finishAuthorization(id, capability: capability, failed: failed)
}

/// Row 36a: the typing channel is attached only under a token that grants it (web `useRoomTyping`'s
/// `runSyncOnce` and its coalescing `sync`), and what it publishes is web's ephemeral message.
struct GatedScopeTests {
  @Test func withoutAnOpenRoomNothingAuthorizes() {
    var scope = typingScope()
    let beforeRoom = scope.requestAuthorization()
    scope.setTarget(nil)
    let afterClosing = scope.requestAuthorization()
    #expect(beforeRoom == nil && afterClosing == nil)
    #expect(scope.grant?.canPublish != true)
  }

  @Test func grantFollowsTheTokenCapability() throws {
    var scope = typingScope()
    scope.setTarget("a")
    let granted = try authorize(&scope, capability: both)
    #expect(granted == .granted(target: "a", grant: .init(canPublish: true)))
    #expect(scope.grant?.canPublish == true)
    // A reconnect may bring a narrower token: read the room, stay quiet.
    let subscribeOnly = try authorize(&scope, capability: #"{"chat_typing:room_a":["subscribe"]}"#)
    #expect(subscribeOnly == .granted(target: "a", grant: .init(canPublish: false)))
    #expect(scope.grant?.canPublish != true)
    let publishOnly = try authorize(&scope, capability: #"{"chat_typing:room_a":["publish"]}"#)
    #expect(publishOnly == .denied(target: "a", failed: false))
    let regranted = try authorize(&scope, capability: both)
    #expect(regranted == .granted(target: "a", grant: .init(canPublish: true)))
    let failed = try authorize(&scope, capability: both, failed: true)
    #expect(failed == .denied(target: "a", failed: true))
    #expect(scope.grant?.canPublish != true)
    let malformed = try authorize(&scope, capability: "garbage")
    #expect(malformed == .denied(target: "a", failed: false))
    let messagesOnly = try authorize(&scope, capability: #"{"chat_rooms:room_a":["subscribe"]}"#)
    #expect(messagesOnly == .denied(target: "a", failed: false))
  }

  @Test func roomSwitchRejectsInFlightResultAndCoalescesRequests() throws {
    var scope = typingScope()
    scope.setTarget("a")
    let staleRequest = scope.requestAuthorization()
    let stale = try #require(staleRequest)
    let duplicate = scope.requestAuthorization()
    #expect(duplicate == nil)
    let queuedOnce = scope.takeQueued()
    let queuedTwice = scope.takeQueued()
    #expect(queuedOnce && !queuedTwice)
    scope.setTarget("b")
    let staleOutcome = scope.finishAuthorization(stale, capability: both, failed: false)
    #expect(staleOutcome == .stale)
    #expect(scope.grant?.canPublish != true)
    let freshRequest = scope.requestAuthorization()
    let fresh = try #require(freshRequest)
    let queuedDuringFresh = scope.requestAuthorization()
    #expect(queuedDuringFresh == nil)
    // The token was minted while room "a" was open and says nothing about "b".
    let otherRoom = scope.finishAuthorization(fresh, capability: both, failed: false)
    #expect(otherRoom == .denied(target: "b", failed: false))
    let queued = scope.takeQueued()
    #expect(queued)
    let repeated = scope.finishAuthorization(fresh, capability: both, failed: false)
    #expect(repeated == .stale)
  }

  @Test func publishesWebsEphemeralMessage() throws {
    let message = chatTypingMessage(ChatTypingSignal(userId: "user_me", state: .started))
    #expect(message.name == "chat_typing")
    let data = try #require(message.data as? [String: Any])
    #expect(data["userId"] as? String == "user_me")
    #expect(data["state"] as? String == "started")
    #expect(data["parentMessageId"] is NSNull)
    // Never persisted, never replayed on resume: a reconnecting reader starts with nobody typing.
    let extras = try #require(message.extras as? [String: Any])
    #expect(extras["ephemeral"] as? Bool == true)
    #expect(extras.count == 1)
    // Ably stamps the sender from the token; the payload never names another client.
    #expect(message.clientId == nil)
  }
}
