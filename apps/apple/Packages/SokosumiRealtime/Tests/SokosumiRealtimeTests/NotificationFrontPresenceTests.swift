@testable import SokosumiRealtime
import Testing

struct NotificationFrontPresenceTests {
  /// What the connection does: send what it is given, then record it.
  private func send(_ presence: inout NotificationFrontPresence, _ action: NotificationFrontPresence.Action) {
    presence.sent(action)
  }

  @Test func entersWhenTheAppComesForward() {
    var presence = NotificationFrontPresence()

    #expect(presence.setInFront(true) == .enter)
  }

  @Test func saysNothingWhileTheAppStaysBehind() {
    var presence = NotificationFrontPresence()

    #expect(presence.setInFront(false) == .none)
    #expect(presence.restored == .none)
  }

  @Test func leavesWhenTheAppGoesBehind() {
    var presence = NotificationFrontPresence()
    send(&presence, presence.setInFront(true))

    #expect(presence.setInFront(false) == .leave)
  }

  @Test func saysNothingWhenTheAnswerHasNotChanged() {
    var presence = NotificationFrontPresence()
    send(&presence, presence.setInFront(true))

    #expect(presence.setInFront(true) == .none)
  }

  @Test func entersAgainWhenAblyRestoresWhileInFront() {
    var presence = NotificationFrontPresence()
    send(&presence, presence.setInFront(true))

    #expect(presence.restored == .enter)
  }

  /// The leave that went missing: refused while the channel was suspended,
  /// and Ably still holds the member it puts back.
  @Test func leavesAgainOnEveryRestoreAfterALeaveThatWentMissing() {
    var presence = NotificationFrontPresence()
    send(&presence, presence.setInFront(true))
    send(&presence, presence.setInFront(false))

    #expect(presence.restored == .leave)
    #expect(presence.restored == .leave)
  }

  /// Told at launch, before the connection has the channel: nothing was sent,
  /// so the first restore must not leave a member that was never entered.
  @Test func saysNothingOnRestoreWhenTheEnterReachedNoChannel() {
    var presence = NotificationFrontPresence()
    _ = presence.setInFront(true)
    _ = presence.setInFront(false)

    #expect(presence.restored == .none)
  }

  @Test func saysNothingOnRestoreAfterTheChannelWasLost() {
    var presence = NotificationFrontPresence()
    send(&presence, presence.setInFront(true))
    send(&presence, presence.setInFront(false))

    presence.channelLost()

    #expect(presence.restored == .none)
    #expect(presence.inFront == false)
  }

  @Test func entersAgainAfterTheChannelWasLostWhileInFront() {
    var presence = NotificationFrontPresence()
    send(&presence, presence.setInFront(true))

    presence.channelLost()

    #expect(presence.restored == .enter)
  }

  @Test func sendsARefusedLeaveAgainWhileTheChannelIsAttached() {
    var presence = NotificationFrontPresence()
    send(&presence, presence.setInFront(true))
    send(&presence, presence.setInFront(false))

    #expect(presence.leaveRefused(channelAttached: true) == true)
  }

  /// The attach that ends a suspension sends the answer again by itself.
  @Test func waitsForTheRestoreWhenTheChannelIsNotAttached() {
    var presence = NotificationFrontPresence()
    send(&presence, presence.setInFront(true))
    send(&presence, presence.setInFront(false))

    #expect(presence.leaveRefused(channelAttached: false) == false)
  }

  /// A key granted no presence right refuses every leave. Asking forever
  /// buys the reader nothing, so the app stops after the budget.
  @Test func stopsSendingARefusedLeaveOnceTheBudgetIsSpent() {
    var presence = NotificationFrontPresence()
    send(&presence, presence.setInFront(true))
    send(&presence, presence.setInFront(false))

    for _ in 0 ..< NotificationFrontPresence.retryLimit {
      #expect(presence.leaveRefused(channelAttached: true) == true)
    }

    #expect(presence.leaveRefused(channelAttached: true) == false)
  }

  @Test func startsTheBudgetOverWhenTheChannelTakesALeave() {
    var presence = NotificationFrontPresence()
    send(&presence, presence.setInFront(true))
    send(&presence, presence.setInFront(false))
    for _ in 0 ..< NotificationFrontPresence.retryLimit {
      _ = presence.leaveRefused(channelAttached: true)
    }

    presence.leaveAccepted()

    #expect(presence.leaveRefused(channelAttached: true) == true)
  }

  @Test func startsTheBudgetOverWhenTheAppComesForwardAgain() {
    var presence = NotificationFrontPresence()
    send(&presence, presence.setInFront(true))
    send(&presence, presence.setInFront(false))
    for _ in 0 ..< NotificationFrontPresence.retryLimit {
      _ = presence.leaveRefused(channelAttached: true)
    }

    send(&presence, presence.setInFront(true))
    send(&presence, presence.setInFront(false))

    #expect(presence.leaveRefused(channelAttached: true) == true)
  }

  @Test func forgetsEverythingWhenTheSocketIsReplaced() {
    var presence = NotificationFrontPresence()
    send(&presence, presence.setInFront(true))

    presence.reset()

    #expect(presence.inFront == false)
    #expect(presence.everEntered == false)
    #expect(presence.restored == .none)
  }

  /// The acknowledgement is not the leave coming back from the server, and
  /// Ably drops the member it puts back only on the one that comes back. A
  /// connection lost between the two would hold every email back by its
  /// category's delay for the rest of the session, so the leave is sent
  /// again until the channel is gone.
  @Test func leavesAgainOnRestoreAlthoughTheChannelTookTheLeave() {
    var presence = NotificationFrontPresence()
    send(&presence, presence.setInFront(true))
    send(&presence, presence.setInFront(false))

    presence.leaveAccepted()

    #expect(presence.restored == .leave)
  }

  /// A new socket on the same connection object starts from the top: the
  /// channel that refused the last leave is gone with it.
  @Test func startsTheBudgetOverWhenTheSocketIsReplaced() {
    var presence = NotificationFrontPresence()
    send(&presence, presence.setInFront(true))
    send(&presence, presence.setInFront(false))
    for _ in 0 ..< NotificationFrontPresence.retryLimit {
      _ = presence.leaveRefused(channelAttached: true)
    }

    presence.reset()

    #expect(presence.leaveRefused(channelAttached: true) == true)
  }
}
