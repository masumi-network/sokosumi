import Foundation

/// What the notifications channel must be told so it holds a presence
/// member exactly while the app is in front of the reader (SOK-1090).
///
/// Core reads that member to decide whether a notification email goes now
/// or waits its category's delay, so a member left behind holds every email
/// back by that delay until it goes.
///
/// Ably puts back the members it holds whenever it attaches a channel it
/// could not resume, and it drops what it holds only on the leave it
/// receives or on a channel that detached or failed. A leave refused while
/// the channel was suspended therefore never reached the server, so once
/// the app has entered, the answer is sent again at every restore until the
/// channel is gone.
struct NotificationFrontPresence {
  enum Action: Equatable {
    case none
    case enter
    case leave
  }

  /// How often a refused leave is sent again before the app stops asking
  /// and waits for the next restore. A channel that refuses one leave for a
  /// reason of its own refuses the next one too: a key granted no presence
  /// right refuses every leave for the life of the connection, and asking
  /// once every quarter minute forever buys the reader nothing.
  static let retryLimit = 3

  private(set) var inFront = false
  /// Whether an enter was handed to this channel and nothing has told us
  /// Ably dropped it. Until one was, Ably holds nothing and a leave says
  /// nothing.
  private(set) var everEntered = false
  private var retriesUsed = 0

  /// The reader brought the app forward, or sent it behind something.
  mutating func setInFront(_ value: Bool) -> Action {
    guard inFront != value else { return .none }
    inFront = value
    return action
  }

  /// Ably attached the channel, so whatever it holds is back.
  var restored: Action { action }

  /// The channel refused a leave. Whether to send it again shortly.
  ///
  /// A channel that is not attached refuses on its state alone, and the
  /// attach that ends that state sends the answer again by itself, so those
  /// are not worth a timer.
  mutating func leaveRefused(channelAttached: Bool) -> Bool {
    guard channelAttached, retriesUsed < Self.retryLimit else { return false }
    retriesUsed += 1
    return true
  }

  /// The channel took a leave, so the next refusal starts its budget from
  /// the top.
  ///
  /// What was entered stays entered. This is the acknowledgement, not the
  /// leave coming back from the server, and Ably drops the member it puts
  /// back only on the one that comes back. A connection lost between the
  /// two leaves a member behind that no later restore would ask about. A
  /// leave sent for a member that is already gone costs one presence call;
  /// a member never left holds every email back by its category's delay,
  /// for the rest of the session.
  mutating func leaveAccepted() {
    retriesUsed = 0
  }

  /// The channel detached or failed, which takes every member with it.
  mutating func channelLost() {
    everEntered = false
  }

  /// The socket is gone and takes the channel with it.
  mutating func reset() {
    inFront = false
    everEntered = false
    retriesUsed = 0
  }

  /// An action that was handed to the channel. A decision that reached no
  /// channel must not count, or the first attach would leave a member that
  /// was never entered.
  mutating func sent(_ action: Action) {
    if action == .enter {
      everEntered = true
      retriesUsed = 0
    }
  }

  private var action: Action {
    if inFront {
      return .enter
    }
    return everEntered ? .leave : .none
  }
}
