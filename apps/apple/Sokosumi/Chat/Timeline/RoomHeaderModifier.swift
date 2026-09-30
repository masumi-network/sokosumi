import SokosumiChat
import SwiftUI

/// Web `RoomHeaderChrome`'s identity in the window's own title bar: the room's mark, its name as the navigation
/// title (the Window menu and Mission Control read it) and a Channel's topic as the subtitle under it. The mark
/// stands before the title as a plain navigation item, without the glass a toolbar button gets.
struct RoomHeaderModifier: ViewModifier {
  let identity: RoomHeaderIdentity

  func body(content: Content) -> some View {
    content
      .navigationTitle(identity.title)
      .navigationSubtitle(identity.topic ?? "")
      .toolbar {
        ToolbarItem(placement: .navigation) {
          RoomHeaderMark(mark: identity.mark)
        }
        .sharedBackgroundVisibility(.hidden)
      }
  }
}

/// Web draws the Channel glyph (`ChannelDiscoverabilityIcon`) or a Direct's `MessageCircle`, muted.
struct RoomHeaderMark: View {
  let mark: RoomHeaderIdentity.Mark

  var body: some View {
    switch mark {
    case let .channel(channel):
      Image(systemName: channel.systemImage)
        .foregroundStyle(.secondary)
        .accessibilityLabel(channel.channelDescription)
    case .direct:
      Image(systemName: "message")
        .foregroundStyle(.secondary)
        .accessibilityHidden(true)
    }
  }
}
