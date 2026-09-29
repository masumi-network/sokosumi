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
        Text(label)
          .font(.caption)
          .fontWeight(.medium)
          .foregroundStyle(.secondary)
          .padding(.horizontal, 12)
          .padding(.vertical, 4)
          .background(Color.secondary.opacity(0.15))
          .clipShape(.capsule)
        Spacer()
      }
      .padding(.vertical, 4)
      .frame(maxWidth: .infinity)
    }
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
