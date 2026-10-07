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

/// Row 36a: the open room's Typing state, web's `useRoomTyping` without Ably or timers.
@MainActor struct RoomTypingTests {
  private func typing(room: String = "room-a", canPublish: Bool? = true) -> RoomTyping {
    let typing = RoomTyping()
    typing.open(roomId: room, selfUserId: reader)
    if let canPublish {
      typing.channelChanged(roomId: room, canPublish: canPublish)
    }
    return typing
  }

  @Test func namesTeammatesInStartOrderAndNeverTheReader() {
    let typing = typing()
    typing.apply(started("user_pat"), roomId: "room-a", now: at(1))
    typing.apply(started(reader), roomId: "room-a", now: at(2))
    typing.apply(started("user_kim"), roomId: "room-a", now: at(3))
    #expect(typing.typistIds == ["user_pat", "user_kim"])
    typing.apply(.init(userId: "user_pat", state: .stopped), roomId: "room-a", now: at(4))
    #expect(typing.typistIds == ["user_kim"])
  }

  @Test func ignoresAnEventForARoomThatIsNotOpen() {
    let typing = typing()
    typing.apply(started("user_pat"), roomId: "room-b", now: at(1))
    #expect(typing.typistIds.isEmpty)
    #expect(typing.nextExpiry(after: at(1)) == nil)
  }

  @Test func aSilentTypistExpiresOnTheSweepTheModelAsksFor() {
    let typing = typing()
    typing.apply(started("user_pat"), roomId: "room-a", now: at(1))
    typing.apply(started("user_kim"), roomId: "room-a", now: at(5))
    #expect(typing.nextExpiry(after: at(5)) == at(13))
    typing.sweep(now: at(12.999))
    #expect(typing.typistIds == ["user_pat", "user_kim"])
    typing.sweep(now: at(13))
    #expect(typing.typistIds == ["user_kim"])
    #expect(typing.nextExpiry(after: at(13)) == at(17))
    typing.sweep(now: at(17))
    #expect(typing.typistIds.isEmpty)
    #expect(typing.nextExpiry(after: at(17)) == nil)
  }

  @Test func aLateEventAlsoDropsWhoeverWentQuietMeanwhile() {
    let typing = typing()
    typing.apply(started("user_pat"), roomId: "room-a", now: at(1))
    typing.apply(started("user_kim"), roomId: "room-a", now: at(14))
    #expect(typing.typistIds == ["user_kim"])
  }

  @Test func announcesTheFirstEditThenHeartbeatsOncePerTenSeconds() {
    let typing = typing()
    #expect(typing.composerChanged(hasText: true, now: at(1)) == .started)
    #expect(typing.composerChanged(hasText: true, now: at(2)) == nil)
    #expect(typing.composerChanged(hasText: true, now: at(10.999)) == nil)
    #expect(typing.composerChanged(hasText: true, now: at(11)) == .started)
    #expect(typing.composerChanged(hasText: true, now: at(12)) == nil)
  }

  @Test func clearingTheComposerStopsOnce() {
    let typing = typing()
    #expect(typing.composerChanged(hasText: false, now: at(0)) == nil)
    #expect(typing.composerChanged(hasText: true, now: at(1)) == .started)
    #expect(typing.composerChanged(hasText: false, now: at(2)) == .stopped)
    #expect(typing.composerChanged(hasText: false, now: at(3)) == nil)
    // The next edit starts a new window at once.
    #expect(typing.composerChanged(hasText: true, now: at(4)) == .started)
  }

  @Test func sendAndBlurStopOnlyWhenAnnounced() {
    let typing = typing()
    #expect(!typing.stop())
    #expect(!typing.isAnnounced)
    #expect(typing.composerChanged(hasText: true, now: at(1)) == .started)
    #expect(typing.isAnnounced)
    #expect(typing.stop())
    #expect(!typing.isAnnounced)
    #expect(!typing.stop())
    #expect(typing.composerChanged(hasText: true, now: at(2)) == .started)
  }

  @Test func anEditBeforeTheChannelIsReadyOpensNoThrottleWindow() {
    let typing = typing(canPublish: nil)
    #expect(typing.composerChanged(hasText: true, now: at(1)) == nil)
    #expect(!typing.stop())
    typing.channelChanged(roomId: "room-a", canPublish: true)
    // Nobody heard the first edit, so the next one announces without waiting ten seconds.
    #expect(typing.composerChanged(hasText: true, now: at(2)) == .started)
  }

  @Test func aSubscribeOnlyTokenReadsTheRoomButStaysQuiet() {
    let typing = typing(canPublish: false)
    #expect(typing.composerChanged(hasText: true, now: at(1)) == nil)
    typing.apply(started("user_pat"), roomId: "room-a", now: at(1))
    #expect(typing.typistIds == ["user_pat"])
    #expect(!typing.stop())
  }

  @Test func losingTheChannelShowsNobodyAndPublishesNothing() {
    let typing = typing()
    typing.apply(started("user_pat"), roomId: "room-a", now: at(1))
    typing.channelChanged(roomId: "room-b", canPublish: nil)
    #expect(typing.typistIds == ["user_pat"])
    typing.channelChanged(roomId: "room-a", canPublish: nil)
    #expect(typing.typistIds.isEmpty)
    #expect(typing.nextExpiry(after: at(1)) == nil)
    #expect(typing.composerChanged(hasText: true, now: at(2)) == nil)
  }

  @Test func openingAnotherRoomStartsEmptyAndUnannounced() {
    let typing = typing()
    typing.apply(started("user_pat"), roomId: "room-a", now: at(1))
    #expect(typing.composerChanged(hasText: true, now: at(1)) == .started)
    typing.open(roomId: "room-b", selfUserId: reader)
    #expect(typing.roomId == "room-b")
    #expect(typing.typistIds.isEmpty)
    #expect(!typing.stop())
    // The new room's channel has not answered yet.
    #expect(typing.composerChanged(hasText: true, now: at(2)) == nil)
    typing.channelChanged(roomId: "room-b", canPublish: true)
    #expect(typing.composerChanged(hasText: true, now: at(3)) == .started)
    typing.open(roomId: nil, selfUserId: reader)
    #expect(typing.roomId == nil)
    #expect(typing.composerChanged(hasText: true, now: at(4)) == nil)
  }

  @Test func reopeningTheSameRoomKeepsItsTypists() {
    let typing = typing()
    typing.apply(started("user_pat"), roomId: "room-a", now: at(1))
    #expect(typing.composerChanged(hasText: true, now: at(1)) == .started)
    typing.open(roomId: "room-a", selfUserId: reader)
    #expect(typing.typistIds == ["user_pat"])
    #expect(typing.stop())
  }
}
