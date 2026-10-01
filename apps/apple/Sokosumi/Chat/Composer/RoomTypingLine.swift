import CoreAPI
import SokosumiChat
import SwiftUI

/// The Typing line under the room composer (web `RoomTypingLine`, ADR 0033): who is composing a
/// message to this room right now, as one truncating line of secondary caption text.
///
/// Always present with only its text swapped, so it holds its height whether or not anyone is
/// typing and the composer never moves under a reader mid-sentence. Static, because an animated
/// indicator would read as a coworker's Thought. It observes `RoomTyping` itself, so a typist
/// coming or going redraws this line and nothing else.
struct RoomTypingLine: View {
  @ObservedObject var typing: RoomTyping
  let room: Components.Schemas.ChatRoom?

  /// The draft's leading edge inside the composer card: its padding, the text inset and the
  /// line fragment padding.
  static let leadingInset: CGFloat = 17

  private var text: String? {
    guard let room, room.id == typing.roomId else { return nil }
    return typingLineText(typistIds: typing.typistIds, room: room)
  }

  var body: some View {
    let text = text
    Text(verbatim: text ?? " ")
      .font(.caption)
      .foregroundStyle(.secondary)
      .lineLimit(1)
      .truncationMode(.tail)
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding(.leading, Self.leadingInset)
      .accessibilityHidden(text == nil)
      // Web's polite, atomic live region: the whole sentence, without interrupting speech.
      .onChange(of: text) { _, text in
        guard let text else { return }
        var announcement = AttributedString(text)
        announcement.accessibilitySpeechAnnouncementPriority = .low
        AccessibilityNotification.Announcement(announcement).post()
      }
  }
}
