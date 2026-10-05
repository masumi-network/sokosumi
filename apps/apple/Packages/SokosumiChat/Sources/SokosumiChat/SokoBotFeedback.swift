import CoreAPI

/// One Soko Bot turn's useful / not useful thumbs as a message's action toolbar
/// draws them (web `SokoBotFeedbackButtons`, in the hover pill and the touch
/// action sheet since #5554). The rating itself goes through `WorkspaceState`.
public struct SokoBotFeedback: Equatable, Sendable {
  public let turnId: String
  /// What Core stored for the turn; nil until a rating succeeds.
  public let rating: Bool?
  /// A rating is on its way to Core.
  public let isSending: Bool

  public init(turnId: String, rating: Bool? = nil, isSending: Bool = false) {
    self.turnId = turnId
    self.rating = rating
    self.isSending = isSending
  }

  /// The turn a message's toolbar rates. Web draws the thumbs wherever the row's
  /// actions show (`showActions`: not deleted, not thinking, not a local send) and
  /// `metadata.soko_bot.turn_id` is a string, whoever sent the row; Core answers
  /// 404 to anyone but the turn's owner.
  public static func turnId(for message: Components.Schemas.ChatRoomMessage) -> String? {
    guard message.deletedAt == nil,
          !isOutboundLocalMessage(message),
          MentionThoughtShell(message: message)?.isThinking != true
    else { return nil }
    return SokoBotTurnMetadata(message: message)?.turnId
  }

  /// Web `disabled={isPending || sent !== null}`: both thumbs lock while the
  /// rating is sent and once it stuck.
  public var isLocked: Bool {
    isSending || rating != nil
  }

  /// Web `aria-pressed` and the filled icon.
  public func isChosen(useful: Bool) -> Bool {
    rating == useful
  }

  public static func title(useful: Bool) -> String {
    useful ? "Useful" : "Not useful"
  }

  /// Web's `title`: the chosen thumb thanks the reader, the other keeps its name.
  public func help(useful: Bool) -> String {
    isChosen(useful: useful) ? "Thanks, noted." : Self.title(useful: useful)
  }
}
