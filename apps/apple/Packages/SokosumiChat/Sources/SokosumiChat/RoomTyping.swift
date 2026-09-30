import Combine
import Foundation

/// Typing for the open room's main transcript (ADR 0033): who else is composing a message
/// there, and what this client last told the room. Web's `useRoomTyping` without Ably or timers:
/// the transport feeds events and the channel's state in, the coordinator asks what to publish
/// and when to look again.
@MainActor
public final class RoomTyping: ObservableObject {
  /// Live typists of the open room in the order they started. Never includes the reader.
  @Published public private(set) var typistIds: [String] = []
  public private(set) var roomId: String?
  private var selfUserId = ""
  private var typists = TypingSet()
  /// Whether the room's typing channel is subscribed under a token that grants `publish`.
  private var canPublish = false
  /// When this client last told the room it is typing; nil when it is not announced.
  private var startedPublishedAt: Date?

  /// Whether the room was told this client is typing and not yet that it stopped.
  public var isAnnounced: Bool {
    startedPublishedAt != nil
  }

  public init() {}

  /// The open room changed (nil: none). A room starts with nobody typing and this client
  /// unannounced; opening the room that is already open changes nothing.
  public func open(roomId: String?, selfUserId: String) {
    guard self.roomId != roomId || self.selfUserId != selfUserId else { return }
    self.roomId = roomId
    self.selfUserId = selfUserId
    typists = TypingSet()
    canPublish = false
    startedPublishedAt = nil
    update([])
  }

  /// The room's typing channel was subscribed (`canPublish` says whether the token also lets
  /// this client announce itself), or is unavailable (nil): the room then shows nobody.
  public func channelChanged(roomId: String, canPublish: Bool?) {
    guard roomId == self.roomId else { return }
    self.canPublish = canPublish ?? false
    if canPublish == nil {
      typists = TypingSet()
      update([])
    }
  }

  /// One event from the room's typing channel, stamped with the reader's clock on arrival.
  public func apply(_ signal: ChatTypingSignal, roomId: String, now: Date) {
    guard roomId == self.roomId else { return }
    typists.apply(signal, at: now, selfUserId: selfUserId)
    update(typists.liveTypistIds(now: now))
  }

  /// Expiry is time-based: without a look at `nextExpiry` a typist who simply stops would
  /// linger until the next event, which, if they were the only one typing, never comes.
  public func sweep(now: Date) {
    update(typists.liveTypistIds(now: now))
  }

  public func nextExpiry(after now: Date) -> Date? {
    typists.nextExpiry(after: now)
  }

  /// A genuine edit in the room composer. Returns what to publish, if anything: `started` on
  /// the first edit and then once per throttle window, `stopped` when the text is cleared.
  /// Nothing opens a window while the channel cannot carry it, so an edit made before the
  /// channel is ready is announced by the next one instead of ten seconds later.
  public func composerChanged(hasText: Bool, now: Date) -> ChatTypingState? {
    switch nextTypingPublishAction(composerHasText: hasText, startedPublishedAt: startedPublishedAt, now: now) {
    case .none:
      return nil
    case .start:
      guard canPublish else { return nil }
      startedPublishedAt = now
      return .started
    case .stop:
      startedPublishedAt = nil
      return canPublish ? .stopped : nil
    }
  }

  /// Send, blur, leaving the room. True when the room was told this client is typing, so the
  /// caller publishes `stopped`; safe to call when it was not.
  public func stop() -> Bool {
    guard startedPublishedAt != nil else { return false }
    startedPublishedAt = nil
    return canPublish
  }

  /// An equal list must not publish: every change redraws the line.
  private func update(_ next: [String]) {
    if next != typistIds {
      typistIds = next
    }
  }
}
