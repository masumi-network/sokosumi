import SokosumiChat
import SwiftUI

/// The words and symbol of one room-menu entry: the one switch from `RoomMenuEntry.Command` to what the reader
/// sees. The sidebar's context menu draws every entry with its symbol; the Members inspector draws its Channel
/// buttons as plain text, as today. Name Group keeps its own catalog label in both.
struct RoomMenuEntryLabel: View {
  let command: RoomMenuEntry.Command
  var showsIcon = true

  var body: some View {
    if let words {
      if showsIcon {
        Label(words.title, systemImage: words.systemImage)
      } else {
        Text(words.title)
      }
    } else {
      NameGroupLabel()
    }
  }

  private var words: (title: LocalizedStringKey, systemImage: String)? {
    switch command {
    case .markUnread: ("Mark as unread", "envelope.badge")
    case .pin: ("Pin", "pin")
    case .unpin: ("Unpin", "pin.slash")
    case .mute: ("Mute", "bell.slash")
    case .unmute: ("Unmute", "bell")
    case .channelSettings: ("Channel settings…", "gearshape")
    case .leave: ("Leave channel…", "rectangle.portrait.and.arrow.right")
    case .nameGroup: nil
    }
  }
}
