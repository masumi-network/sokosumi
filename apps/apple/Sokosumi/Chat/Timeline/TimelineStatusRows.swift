import CoreAPI
import SokosumiChat
import SwiftUI

#if os(macOS)
  /// Centered day pill ("Today", "Yesterday", weekday, dd/mm/yyyy),
  /// like web `DaySeparator`.
  struct DaySeparatorRow: View {
    let label: String

    var body: some View {
      HStack {
        Spacer()
        DayPill(label: label)
        Spacer()
      }
      .padding(.vertical, 4)
      .frame(maxWidth: .infinity)
    }
  }

  private struct DayPill: View {
    let label: String

    var body: some View {
      Text(label)
        .font(.caption)
        .fontWeight(.medium)
        .foregroundStyle(.secondary)
        .padding(.horizontal, 12)
        .padding(.vertical, 4)
        .background(Color.secondary.opacity(0.15))
        .clipShape(.capsule)
    }
  }

  /// The Unread divider above the first unread message (spec SOK-1481): a full-width foreground hairline with "New" at
  /// its trailing end, no count. Above the same message as a day pill, the two share one row, the pill in the middle of
  /// the line where a row of its own would center it: `——— Today ——— New`. VoiceOver finds it as a separator named
  /// "New messages".
  struct UnreadDividerRow: View {
    let dayLabel: String?

    var body: some View {
      HStack(spacing: 8) {
        if let dayLabel {
          hairline
          DayPill(label: dayLabel)
        }
        // Equal width with the leading hairline, so "New" does not push the pill off center.
        HStack(spacing: 8) {
          hairline
          Text("New", tableName: "ChatUnreadDivider", comment: "Label at the end of the line above the first unread message in a room.")
            .font(.caption)
            .fontWeight(.semibold)
            .foregroundStyle(.primary)
            .accessibilityHidden(true)
        }
        .frame(maxWidth: .infinity)
      }
      .padding(.horizontal, 12)
      .padding(.vertical, 4)
      .frame(maxWidth: .infinity)
      .background { UnreadDividerSeparator() }
    }

    private var hairline: some View {
      Rectangle()
        .fill(.primary)
        .frame(height: 1)
        .accessibilityHidden(true)
    }
  }

  /// SwiftUI has no separator role; AppKit's splitter is what VoiceOver reads as one (WebKit maps ARIA's separator to it).
  private struct UnreadDividerSeparator: NSViewRepresentable {
    final class SeparatorView: NSView {
      override func isAccessibilityElement() -> Bool {
        true
      }

      override func accessibilityRole() -> NSAccessibility.Role? {
        .splitter
      }

      override func accessibilityLabel() -> String? {
        String(localized: "New messages", table: "ChatUnreadDivider",
               comment: "What VoiceOver reads for the line above the first unread message in a room.")
      }
    }

    func makeNSView(context _: Context) -> SeparatorView {
      SeparatorView()
    }

    func updateNSView(_: SeparatorView, context _: Context) {}
  }

  /// Centered join/leave or Group name change status, like web `RoomStatusRow`.
  struct RoomStatusRow: View {
    let text: Text

    var body: some View {
      text
        .font(.caption)
        .foregroundStyle(.secondary)
        .frame(maxWidth: .infinity)
        .padding(.vertical, 8)
    }
  }

  /// The status row a message renders as, or nil for a chat bubble.
  func roomStatusText(_ message: Components.Schemas.ChatRoomMessage) -> Text? {
    if let status = membershipStatusText(message) {
      return Text(status)
    }
    return GroupNameChangeStatus(message).map(groupNameChangeText)
  }

  /// A Group name change row: "{actor} named the group {name}" / "{actor} removed the group name".
  func groupNameChangeText(_ status: GroupNameChangeStatus) -> Text {
    switch status {
    case let .named(actor, name):
      Text("\(actor) named the group \(name)", tableName: groupNameTable,
           comment: "Timeline status row. First argument: who named the group Direct; second: the new name.")
    case let .cleared(actor):
      Text("\(actor) removed the group name", tableName: groupNameTable,
           comment: "Timeline status row. Argument: who cleared the group Direct's name.")
    }
  }
#endif
