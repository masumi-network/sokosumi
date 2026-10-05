import CoreAPI
import Foundation
@testable import SokosumiChat
import Testing

private let reader = "user_me"
private let origin = Date(timeIntervalSince1970: 1_800_000_000)

private func at(_ seconds: TimeInterval) -> Date {
  origin.addingTimeInterval(seconds)
}

private func started(_ userId: String) -> ChatTypingSignal {
  ChatTypingSignal(userId: userId, state: .started)
}

private func stopped(_ userId: String) -> ChatTypingSignal {
  ChatTypingSignal(userId: userId, state: .stopped)
}

private func wire(_ userId: Any, _ state: Any, parent: Any? = NSNull()) -> [String: Any] {
  var payload: [String: Any] = ["userId": userId, "state": state]
  payload["parentMessageId"] = parent
  return payload
}

/// A channel whose human members have the address `{id}@example.com`.
private func room(_ members: [(id: String, name: String)]) -> Components.Schemas.ChatRoom {
  .init(
    id: "room", organizationId: "org", name: "Team", slug: "team", kind: .channel, isSelfDirect: false, isGroupDirect: false, isReadOnly: false, topic: nil,
    discoverability: ._private, createdByUserId: reader, createdAt: .distantPast, updatedAt: .distantPast,
    unreadCount: 0, unreadMentionCount: 0, markedUnread: false, myAccess: .init(value1: .member, value2: "member"),
    userMembers: members.map { .init(id: $0.id, name: $0.name, email: "\($0.id)@example.com", presence: .online) },
    formerUserMembers: [], coworkerMembers: [.init(id: "agent", name: "Agent", slug: "agent", caption: nil, image: nil, presence: .online)],
    sokoBotMembers: []
  )
}

/// Row 36a: web's `room-typing-model.ts`, `chatTypingEventDataSchema`, the reader guards of
/// `use-room-typing.tsx` and the copy of `RoomTypingLine`, as plain input and output.
struct ChatTypingTests {
  @Test func typingRidesItsOwnRoomChannel() {
    #expect(chatTypingChannelName(roomId: "room-a") == "chat_typing:room_room-a")
    #expect(chatTypingEventName == "chat_typing")
    #expect(ChatTypingTiming.heartbeatThrottle == 10)
    #expect(ChatTypingTiming.expiry == 12)
  }

  @Test func publishesTheRoomScopedPayloadWebReads() {
    let payload = started(reader).wire
    #expect(payload["userId"] as? String == reader)
    #expect(payload["state"] as? String == "started")
    #expect(payload["parentMessageId"] is NSNull)
    #expect(payload.count == 3)
    #expect(stopped(reader).wire["state"] as? String == "stopped")
  }

  @Test func acceptsAnEventBoundToItsSender() {
    #expect(ChatTypingSignal(wire: wire("user_pat", "started"), clientId: "user_pat:instance-1") == started("user_pat"))
    #expect(ChatTypingSignal(wire: wire("user_pat", "stopped"), clientId: "user_pat:inst_00000001") == stopped("user_pat"))
  }

  @Test func rejectsAPayloadTheSchemaRefuses() {
    let sender = "user_pat:instance-1"
    #expect(ChatTypingSignal(wire: wire("", "started"), clientId: sender) == nil)
    #expect(ChatTypingSignal(wire: wire("user_pat", "paused"), clientId: sender) == nil)
    #expect(ChatTypingSignal(wire: wire(7, "started"), clientId: sender) == nil)
    #expect(ChatTypingSignal(wire: ["nonsense": true], clientId: sender) == nil)
    #expect(ChatTypingSignal(wire: "started", clientId: sender) == nil)
    #expect(ChatTypingSignal(wire: nil, clientId: sender) == nil)
    // `parentMessageId` is nullable, not optional: a payload without the key fails the schema.
    #expect(ChatTypingSignal(wire: wire("user_pat", "started", parent: nil), clientId: sender) == nil)
    #expect(ChatTypingSignal(wire: wire("user_pat", "started", parent: 3), clientId: sender) == nil)
  }

  @Test func ignoresAThreadScopedEvent() {
    #expect(ChatTypingSignal(wire: wire("user_pat", "started", parent: "msg_1"), clientId: "user_pat:instance-1") == nil)
    #expect(ChatTypingSignal(wire: wire("user_pat", "stopped", parent: "msg_1"), clientId: "user_pat:instance-1") == nil)
  }

  @Test func ignoresAnEventTheSenderCouldHaveForged() {
    let payload = wire("user_pat", "started")
    #expect(ChatTypingSignal(wire: payload, clientId: "user_mallory:instance-9") == nil)
    #expect(ChatTypingSignal(wire: payload, clientId: nil) == nil)
    #expect(ChatTypingSignal(wire: payload, clientId: "malformed-no-separator") == nil)
    #expect(ChatTypingSignal(wire: payload, clientId: "user_pat:x") == nil)
  }

  @Test func theTokenDecidesWhetherToReadAndWhetherToAnnounce() {
    let both = #"{"chat_typing:room_a":["publish","subscribe"],"chat_rooms:room_a":["subscribe"]}"#
    #expect(chatTypingGrant(in: both, roomId: "a") == ChatTypingGrant(canPublish: true))
    #expect(chatTypingGrant(in: #"{"chat_typing:room_a":["subscribe"]}"#, roomId: "a") == ChatTypingGrant(canPublish: false))
    // Without `subscribe` the channel is never attached, whatever else is granted.
    #expect(chatTypingGrant(in: #"{"chat_typing:room_a":["publish"]}"#, roomId: "a") == nil)
    #expect(chatTypingGrant(in: both, roomId: "b") == nil)
    #expect(chatTypingGrant(in: #"{"chat_rooms:room_a":["subscribe"]}"#, roomId: "a") == nil)
    // Web matches the exact channel name only.
    #expect(chatTypingGrant(in: #"{"chat_typing:*":["publish","subscribe"]}"#, roomId: "a") == nil)
    #expect(chatTypingGrant(in: "{}", roomId: "a") == nil)
    #expect(chatTypingGrant(in: "garbage", roomId: "a") == nil)
    #expect(chatTypingGrant(in: nil, roomId: "a") == nil)
    #expect(chatTypingGrant(in: #"{"chat_typing:room_a":"subscribe"}"#, roomId: "a") == nil)
  }

  // MARK: - liveTypistIds / applyTypingEvent

  @Test func namesTypistsInTheOrderTheyStarted() {
    var set = TypingSet()
    #expect(set.liveTypistIds(now: at(0)).isEmpty)
    set.apply(started("user_pat"), at: at(1), selfUserId: reader)
    #expect(set.liveTypistIds(now: at(1)) == ["user_pat"])
    set.apply(started("user_andreas"), at: at(2), selfUserId: reader)
    set.apply(started("user_kim"), at: at(3), selfUserId: reader)
    #expect(set.liveTypistIds(now: at(3)) == ["user_pat", "user_andreas", "user_kim"])
    set.apply(stopped("user_andreas"), at: at(4), selfUserId: reader)
    #expect(set.liveTypistIds(now: at(4)) == ["user_pat", "user_kim"])
  }

  @Test func dropsATypistWhoHasGoneQuietForTheExpiryWindow() {
    var set = TypingSet()
    set.apply(started("user_pat"), at: at(1), selfUserId: reader)
    #expect(set.liveTypistIds(now: at(1 + 12 - 0.001)) == ["user_pat"])
    #expect(set.liveTypistIds(now: at(1 + 12)).isEmpty)
    #expect(set.nextExpiry(after: at(1)) == at(13))
    #expect(set.nextExpiry(after: at(13)) == nil)
  }

  @Test func aHeartbeatKeepsATypistAliveAndInPlace() {
    var set = TypingSet()
    set.apply(started("user_pat"), at: at(1), selfUserId: reader)
    set.apply(started("user_andreas"), at: at(2), selfUserId: reader)
    set.apply(started("user_pat"), at: at(11), selfUserId: reader)
    #expect(set.liveTypistIds(now: at(11)) == ["user_pat", "user_andreas"])
    #expect(set.liveTypistIds(now: at(11 + 12 - 0.001)) == ["user_pat"])
    // The soonest anyone goes quiet is what a reader waits for.
    #expect(set.nextExpiry(after: at(11)) == at(14))
    #expect(set.nextExpiry(after: at(14)) == at(23))
  }

  @Test func neverRecordsYourself() {
    var set = TypingSet()
    set.apply(started(reader), at: at(1), selfUserId: reader)
    #expect(set.liveTypistIds(now: at(1)).isEmpty)
    #expect(set == TypingSet())
  }

  @Test func onePersonOnTwoDevicesIsOneTypist() {
    var set = TypingSet()
    set.apply(started("user_pat"), at: at(1), selfUserId: reader)
    set.apply(started("user_pat"), at: at(1.5), selfUserId: reader)
    #expect(set.liveTypistIds(now: at(1.5)) == ["user_pat"])
  }

  @Test func aTypistWhoExpiredAndReturnsJoinsTheEndOfTheLine() {
    var set = TypingSet()
    set.apply(started("user_pat"), at: at(1), selfUserId: reader)
    set.apply(started("user_kim"), at: at(6), selfUserId: reader)
    set.apply(started("user_pat"), at: at(1 + 12 + 0.001), selfUserId: reader)
    #expect(set.liveTypistIds(now: at(1 + 12 + 0.001)) == ["user_kim", "user_pat"])
  }

  @Test func aPauseInsideTheWindowKeepsTheOrder() {
    var set = TypingSet()
    set.apply(started("user_pat"), at: at(1), selfUserId: reader)
    set.apply(started("user_kim"), at: at(6), selfUserId: reader)
    set.apply(started("user_pat"), at: at(10), selfUserId: reader)
    #expect(set.liveTypistIds(now: at(10)) == ["user_pat", "user_kim"])
  }

  @Test func aStopForSomebodyNotTypingChangesNothing() {
    var set = TypingSet()
    set.apply(stopped("user_ghost"), at: at(1), selfUserId: reader)
    #expect(set == TypingSet())
  }

  // MARK: - nextTypingPublishAction

  @Test func announcesTheFirstEditAndThenOncePerThrottleWindow() {
    #expect(nextTypingPublishAction(composerHasText: true, startedPublishedAt: nil, now: at(1)) == .start)
    #expect(nextTypingPublishAction(composerHasText: true, startedPublishedAt: at(1), now: at(1 + 10 - 0.001)) == TypingPublishAction.none)
    #expect(nextTypingPublishAction(composerHasText: true, startedPublishedAt: at(1), now: at(11)) == .start)
  }

  @Test func stopsWhenTheComposerIsClearedAndSaysNothingIfNobodyWasTold() {
    #expect(nextTypingPublishAction(composerHasText: false, startedPublishedAt: at(1), now: at(2)) == .stop)
    #expect(nextTypingPublishAction(composerHasText: false, startedPublishedAt: nil, now: at(2)) == TypingPublishAction.none)
  }

  // MARK: - The line's copy

  @Test func theLineNamesOneOrTwoAndCollapsesPastTwo() {
    let team = room([
      (id: "user_pat", name: "Patrick Tobin"), (id: "user_andreas", name: "Andreas Osberghaus"), (id: "user_kim", name: "Kim Ferrari")
    ])
    #expect(typingLineText(typistIds: [], room: team) == nil)
    #expect(typingLineText(typistIds: ["user_pat"], room: team) == "Patrick Tobin is typing…")
    #expect(typingLineText(typistIds: ["user_pat", "user_andreas"], room: team) == "Patrick Tobin and Andreas Osberghaus are typing…")
    #expect(typingLineText(typistIds: ["user_andreas", "user_pat"], room: team) == "Andreas Osberghaus and Patrick Tobin are typing…")
    #expect(typingLineText(typistIds: ["user_pat", "user_andreas", "user_kim"], room: team) == "Several people are typing…")
  }

  @Test func theLineDropsATypistTheRosterCannotName() {
    let team = room([
      (id: "user_pat", name: "Patrick Tobin"), (id: "user_nameless", name: "  "), (id: "user_mail", name: "")
    ])
    #expect(typingLineText(typistIds: ["user_nameless"], room: team) == nil)
    #expect(typingLineText(typistIds: ["user_ghost"], room: team) == nil)
    #expect(typingLineText(typistIds: ["user_pat", "user_ghost"], room: team) == "Patrick Tobin is typing…")
    // Dropped names do not count towards "several".
    #expect(typingLineText(typistIds: ["user_ghost", "user_pat", "user_nameless", "user_mail"], room: team) == "Patrick Tobin and user_mail@example.com are typing…")
    // A coworker's turn is Thought, never Typing: only human members are named.
    #expect(typingLineText(typistIds: ["agent"], room: team) == nil)
    #expect(typingLineText(typistIds: ["user_pat"], room: nil) == nil)
  }
}
