import SokosumiChat
import SwiftUI

/// Web `RoomHeaderChrome`'s identity in the window's title bar: the room's mark, its name and a Channel's topic under
/// it, as one button where web's name is one (row 31c). The name stays the navigation title, so the Window menu and
/// Mission Control read it, and the topic the subtitle; the title bar draws this block in their place, because the
/// window's own title cannot be clicked (`toolbarTitleMenu` draws nothing on macOS).
struct RoomHeaderModifier: ViewModifier {
  /// Nil while the room is not in the list (left or archived as it closes): no name to draw.
  let identity: RoomHeaderIdentity?
  /// Find's search field is open beside the room's buttons.
  let searching: Bool
  let open: (RoomHeaderIdentity.TitleAction) -> Void

  /// The room pane's frame in the window, which the title block shares with the window controls and the room's own
  /// toolbar items.
  @State private var pane: CGRect = .zero

  /// The traffic lights and the sidebar toggle, which the title follows when the sidebar is collapsed; with the
  /// sidebar shown the title starts at the pane's leading edge.
  static let windowControlsWidth: CGFloat = 140
  /// The toolbar item's inset before the title and the room's Find, Threads, Members and Pinned messages buttons
  /// after it. Past them the name and topic truncate, as the window's own title did.
  static let toolbarAllowance: CGFloat = 260
  /// What Find's search field adds while it is open: its item measures 262.5 pt at every width (an icon-only button
  /// about 42 pt), because the toolbar keeps the field at its ideal 220 pt (`RoomSearchField`) and never shrinks it
  /// toward its 140 pt minimum before moving items into the overflow menu.
  static let searchFieldAllowance: CGFloat = 220
  static let minimumTitleWidth: CGFloat = 120

  /// The widest the title block may be in a pane at `pane` (window coordinates), with Find's field open or not.
  static func titleWidth(in pane: CGRect, searching: Bool) -> CGFloat {
    let allowance = toolbarAllowance + (searching ? searchFieldAllowance : 0)
    return max(minimumTitleWidth, pane.maxX - max(pane.minX, windowControlsWidth) - allowance)
  }

  func body(content: Content) -> some View {
    content
      .navigationTitle(identity?.title ?? "")
      .navigationSubtitle(identity?.topic ?? "")
      .toolbar(removing: .title)
      .toolbar {
        if let identity {
          ToolbarItem(placement: .navigation) {
            RoomHeaderTitle(identity: identity, open: open)
              .frame(maxWidth: Self.titleWidth(in: pane, searching: searching), alignment: .leading)
          }
          .sharedBackgroundVisibility(.hidden)
        }
        // The window's title held the room's buttons at the trailing edge; without it they would follow the name.
        // Toolbar items applied before this modifier follow the spacer, so the room declares its buttons first.
        ToolbarSpacer(.flexible)
      }
      .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { pane = $0 }
  }
}

/// The mark, the name and the topic: a button where web wraps the name in one (a Channel, a group Direct), plain
/// otherwise.
struct RoomHeaderTitle: View {
  let identity: RoomHeaderIdentity
  let open: (RoomHeaderIdentity.TitleAction) -> Void

  var body: some View {
    if let action = identity.titleAction {
      Button { open(action) } label: { label }
        .buttonStyle(RoomHeaderTitleButtonStyle())
        .help(action.help)
    } else {
      label
    }
  }

  private var label: some View {
    HStack(spacing: 8) {
      RoomHeaderMark(mark: identity.mark)
      RoomHeaderTitleText(title: identity.title, topic: identity.topic)
    }
  }
}

/// The window title's own type: the name in the headline face over a secondary topic, both dimmed while the window
/// is not active, each on one truncating line.
private struct RoomHeaderTitleText: View {
  let title: String
  let topic: String?
  @Environment(\.appearsActive) private var appearsActive

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      Text(title)
        .font(.headline)
        .foregroundStyle(appearsActive ? .primary : .secondary)
      if let topic {
        Text(topic)
          .font(.subheadline)
          .foregroundStyle(appearsActive ? .secondary : .tertiary)
      }
    }
    .lineLimit(1)
  }
}

/// Web's title button: no chrome at rest, a rounded fill under the pointer and a deeper one while pressed.
private struct RoomHeaderTitleButtonStyle: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    StyledLabel(configuration: configuration)
  }

  private struct StyledLabel: View {
    let configuration: Configuration
    @State private var hovered = false

    var body: some View {
      configuration.label
        .padding(.horizontal, 6)
        .padding(.vertical, 2)
        .background(fill, in: .rect(cornerRadius: 6))
        .contentShape(.rect(cornerRadius: 6))
        .onHover { hovered = $0 }
    }

    private var fill: Color {
      if configuration.isPressed {
        return .primary.opacity(0.16)
      }
      return hovered ? .primary.opacity(0.1) : .clear
    }
  }
}

extension RoomHeaderIdentity.TitleAction {
  /// The tooltip, web's button `title`, in the words of the menu items that open the same place.
  var help: Text {
    switch self {
    case .channelSettings:
      Text("Channel settings")
    case .members:
      Text("Members")
    case .nameGroup:
      Text("Name Group…", tableName: groupNameTable, comment: "Opens the sheet that names a group Direct.")
    }
  }
}

/// Web draws the Channel glyph (`ChannelDiscoverabilityIcon`), a Direct's `MessageCircle`, muted, or a Self Direct's
/// own face without a presence mark (`DirectRoomAvatarStack`).
struct RoomHeaderMark: View {
  let mark: RoomHeaderIdentity.Mark

  var body: some View {
    switch mark {
    case let .channel(channel):
      Image(systemName: channel.systemImage)
        .foregroundStyle(.secondary)
        .accessibilityLabel(channel.channelDescription)
    case let .selfDirect(owner):
      DirectRoomAvatarStack(participants: [owner], showsPresence: false)
    case .direct:
      Image(systemName: "message")
        .foregroundStyle(.secondary)
        .accessibilityHidden(true)
    }
  }
}
