import CoreAPI
import Foundation

/// What the open room's header says about the room (web `RoomHeaderChrome`, `room-header-chrome.tsx`): a
/// leading mark, the room's name and, for a Channel, its topic.
public struct RoomHeaderIdentity: Equatable, Sendable {
  public enum Mark: Equatable, Sendable {
    /// A Channel, guests' view included: the discoverability glyph.
    case channel(ChannelMark)
    /// Every other Direct — one-to-one, group, coworker and Soko Bot — draws the message glyph.
    case direct
    /// A Self Direct draws its owner's face, the reader's own (web `DirectRoomAvatarStack`, row 27c).
    case selfDirect(DirectRoomAvatarParticipant)
  }

  public let mark: Mark
  /// The sidebar's name for the room (`roomDisplayName`).
  public let title: String
  /// A Channel's topic as the header draws it; nil for a Direct and for a blank topic.
  public let topic: String?

  init(mark: Mark, title: String, topic: String?) {
    self.mark = mark
    self.title = title
    self.topic = topic
  }

  public init(room: Components.Schemas.ChatRoom, currentUserId: String) {
    title = roomDisplayName(room, currentUserId: currentUserId)
    if room.kind == .channel {
      mark = .channel(ChannelMark(room.discoverability))
      topic = roomHeaderTopic(room.topic)
    } else {
      let owner = room.isSelfDirect ? directRoomAvatarParticipants(room, currentUserId: currentUserId).first : nil
      mark = owner.map(Mark.selfDirect) ?? .direct
      topic = nil
    }
  }
}

/// Web trims the topic (`String.prototype.trim()`) and hides it when nothing is left, then draws it on one truncating
/// line, where HTML folds every run of line breaks, tabs and spaces into one space. A title bar cannot fold, so the
/// text arrives folded.
func roomHeaderTopic(_ topic: String?) -> String? {
  guard let scalars = topic?.unicodeScalars,
        let first = scalars.firstIndex(where: { !isECMAScriptTrimmed($0) }),
        let last = scalars.lastIndex(where: { !isECMAScriptTrimmed($0) })
  else {
    return nil
  }
  let trimmed = String(scalars[first ... last])
  // Scalar semantics: `\r\n` is one Character, which a grapheme-level class never matches.
  return trimmed.replacing(#/[ \t\n\r\f]+/#.matchingSemantics(.unicodeScalar), with: " ")
}

/// What ECMAScript's `trim()` removes: WhiteSpace (TAB, VT, FF, ZWNBSP and every `Zs`, SP and NBSP among them) and
/// LineTerminator (LF, CR, U+2028, U+2029). Foundation's `.whitespacesAndNewlines` differs: it removes U+0085 and
/// keeps U+FEFF.
private func isECMAScriptTrimmed(_ scalar: Unicode.Scalar) -> Bool {
  switch scalar {
  case "\t", "\u{0B}", "\u{0C}", "\u{FEFF}", "\n", "\r", "\u{2028}", "\u{2029}": true
  default: scalar.properties.generalCategory == .spaceSeparator
  }
}
