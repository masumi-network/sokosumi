import CoreAPI
import Foundation

// Typing wire contract and rules (ADR 0033).
//
// Who is composing a message to a room's main transcript right now. A human
// client publishes an ephemeral `chat_typing` message on the room's own
// `chat_typing:room_{roomId}` channel, which Core grants `publish` +
// `subscribe` for every membership room while the message channel stays
// subscribe-only. Ports web's `room-typing-model.ts`, its
// `chatTypingEventDataSchema` and the reader guards of `use-room-typing.tsx`:
// pure and clock-injected, so every timing case is plain input.

public let chatTypingEventName = "chat_typing"

/// Room-scoped channel carrying Typing only (`chat_typing:room_{roomId}`).
public func chatTypingChannelName(roomId: String) -> String {
  "chat_typing:room_\(roomId)"
}

public enum ChatTypingTiming {
  /// One heartbeat per typist per window, and only on an edit: nothing is sent on a timer.
  public static let heartbeatThrottle: TimeInterval = 10
  /// A typist with no heartbeat for this long is gone (the throttle plus Ably's 2 s grace).
  /// The explicit `stopped` is an optimisation; this is what clears a quit app or a lost connection.
  public static let expiry: TimeInterval = heartbeatThrottle + 2
}

/// What a typing event says: they picked it up, or they put it down.
public enum ChatTypingState: String, Sendable {
  case started, stopped
}

/// One Typing event for a room's main transcript.
public struct ChatTypingSignal: Equatable, Sendable {
  public var userId: String
  public var state: ChatTypingState

  public init(userId: String, state: ChatTypingState) {
    self.userId = userId
    self.state = state
  }

  /// Decodes `{ userId, state, parentMessageId }` as a reader accepts it; nil for anything else.
  ///
  /// Ably stamps `clientId` from the token, so it is the one part of a message the sender cannot
  /// choose: the payload's `userId` must be the user of that `{userId}:{instanceId}`, or a member
  /// could announce, or stop, somebody else. A payload naming a Thread (`parentMessageId` not
  /// null) is dropped, so Thread-scoped Typing can ship later without lighting up the room line.
  public init?(wire: Any?, clientId: String?) {
    guard let payload = wire as? [String: Any],
          let userId = payload["userId"] as? String, !userId.isEmpty,
          let state = (payload["state"] as? String).flatMap(ChatTypingState.init(rawValue:)),
          payload["parentMessageId"] is NSNull,
          let clientId, parseUserId(fromAblyPresenceClientId: clientId) == userId
    else {
      return nil
    }
    self.init(userId: userId, state: state)
  }

  /// JSON-ready payload in the shape web publishes. `parentMessageId` ships always null.
  public var wire: [String: Any] {
    ["userId": userId, "state": state.rawValue, "parentMessageId": NSNull()]
  }
}

/// What a token lets this client do on one room's typing channel once it may read it.
public struct ChatTypingGrant: Equatable, Sendable {
  public var canPublish: Bool

  public init(canPublish: Bool) {
    self.canPublish = canPublish
  }
}

/// The token's grant on exactly `roomId`'s typing channel. Nil without `subscribe`, or when the
/// capability is missing or malformed: never attach on a guess, Ably answers a bare attach with
/// capability-denied failures.
public func chatTypingGrant(in capability: String?, roomId: String) -> ChatTypingGrant? {
  guard let capability, let data = capability.data(using: .utf8),
        let map = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
        let operations = (map[chatTypingChannelName(roomId: roomId)] as? [Any])?.compactMap({ $0 as? String }),
        operations.contains("subscribe") else { return nil }
  return ChatTypingGrant(canPublish: operations.contains("publish"))
}

/// The typists of one room, in the order they started.
struct TypingSet: Equatable, Sendable {
  private struct Typist: Equatable, Sendable {
    var userId: String
    var lastHeartbeat: Date
  }

  private var typists: [Typist] = []

  /// Folds one event in, stamped with the reader's own clock. Keyed by user, not by Ably client
  /// id, so one person on two devices is one typist; the reader is never recorded.
  mutating func apply(_ signal: ChatTypingSignal, at now: Date, selfUserId: String) {
    guard signal.userId != selfUserId else { return }
    let index = typists.firstIndex { $0.userId == signal.userId }
    switch signal.state {
    case .stopped:
      if let index {
        typists.remove(at: index)
      }
    case .started:
      // A heartbeat inside the window keeps the typist's place in the order. One past it comes
      // from somebody the reader already stopped seeing: they start again, behind whoever
      // started while they were away.
      if let index, now.timeIntervalSince(typists[index].lastHeartbeat) < ChatTypingTiming.expiry {
        typists[index].lastHeartbeat = now
      } else {
        if let index {
          typists.remove(at: index)
        }
        typists.append(Typist(userId: signal.userId, lastHeartbeat: now))
      }
    }
  }

  /// Who is typing at `now`, in the order they started.
  func liveTypistIds(now: Date) -> [String] {
    typists.filter { now.timeIntervalSince($0.lastHeartbeat) < ChatTypingTiming.expiry }.map(\.userId)
  }

  /// When the next live typist goes quiet, so a reader need not poll for it.
  func nextExpiry(after now: Date) -> Date? {
    typists.map { $0.lastHeartbeat.addingTimeInterval(ChatTypingTiming.expiry) }.filter { $0 > now }.min()
  }
}

enum TypingPublishAction: Equatable {
  case start, stop, none
}

/// What the composer publishes after a genuine edit. `startedPublishedAt` is when this client
/// last told the room it is typing, nil when it is not announced. A restored draft, send, blur
/// and leaving the room never come through here.
func nextTypingPublishAction(composerHasText: Bool, startedPublishedAt: Date?, now: Date) -> TypingPublishAction {
  guard composerHasText else { return startedPublishedAt == nil ? .none : .stop }
  guard let startedPublishedAt else { return .start }
  return now.timeIntervalSince(startedPublishedAt) >= ChatTypingTiming.heartbeatThrottle ? .start : .none
}

/// The Typing line: one or two people by display name, "Several people" past two. A typist the
/// room's human roster cannot name has almost certainly just left, and is dropped before the
/// count rather than shown as a placeholder. Nil when nobody is left to name.
public func typingLineText(typistIds: [String], room: Components.Schemas.ChatRoom?) -> String? {
  let names = typistIds.compactMap { id -> String? in
    guard let user = room?.userMembers.first(where: { $0.id == id }) else { return nil }
    let name = (user.name.isEmpty ? user.email : user.name).trimmingCharacters(in: .whitespacesAndNewlines)
    return name.isEmpty ? nil : name
  }
  switch names.count {
  case 0: return nil
  case 1: return "\(names[0]) is typing…"
  case 2: return "\(names[0]) and \(names[1]) are typing…"
  default: return "Several people are typing…"
  }
}
