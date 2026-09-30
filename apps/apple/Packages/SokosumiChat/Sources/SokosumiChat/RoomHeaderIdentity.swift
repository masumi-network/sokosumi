import CoreAPI
import Foundation

/// What the open room's header says about the room (web `RoomHeaderChrome`, `room-header-chrome.tsx`): a
/// leading mark, the room's name and, for a Channel, its topic.
public struct RoomHeaderIdentity: Equatable, Sendable {
  public enum Mark: Equatable, Sendable {
    /// A Channel, guests' view included: the discoverability glyph.
    case channel(ChannelMark)
    /// Every Direct — one-to-one, group, Self, coworker and Soko Bot — draws the message glyph. Web draws a Self
    /// Direct's own avatar there instead (a recorded deviation in `PARITY.md`, row 31a).
    case direct
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
      mark = .direct
      topic = nil
    }
  }
}

/// Web trims the topic and hides it when nothing is left, then draws it on one truncating line, where HTML folds
/// every run of line breaks, tabs and spaces into one space. A title bar cannot fold, so the text arrives folded.
func roomHeaderTopic(_ topic: String?) -> String? {
  guard let trimmed = topic?.trimmingCharacters(in: .whitespacesAndNewlines), !trimmed.isEmpty else {
    return nil
  }
  // Scalar semantics: `\r\n` is one Character, which a grapheme-level class never matches.
  return trimmed.replacing(#/[ \t\n\r\f]+/#.matchingSemantics(.unicodeScalar), with: " ")
}
