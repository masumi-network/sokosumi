import SokosumiChat
import SwiftUI

/// One of a room's unread Threads inset under its sidebar row (row 24g2, web `ChatRoomThreadRows`): the thread
/// mark, the parent as one line and one number. The mark is quiet, a neutral circle, unless a reply names the
/// reader: then the accent circle with an `@`, and the row's mention badge instead of the reply count.
///
/// Equatable, so the preview (a run of regular expressions) is built again only when the row changes, not on
/// every sidebar update.
struct SidebarThreadRowLabel: View, Equatable {
  /// Web's `sm` thread circle.
  static let markDiameter: CGFloat = 18

  let row: SidebarThreadRow

  var body: some View {
    let label = row.label
    HStack(spacing: 8) {
      ThreadListMark(tone: row.mentionCount > 0 ? .attention : .quiet, namesReader: row.mentionCount > 0, diameter: Self.markDiameter)
      Text(label)
        .font(.callout.weight(.semibold))
        .foregroundStyle(.primary)
        .lineLimit(1)
      Spacer(minLength: 0)
      if let count = row.countLabel {
        // The room rows' muted count, in the same trailing column, so it stacks under its room's.
        Text(count)
          .font(.caption.weight(.semibold))
          .monospacedDigit()
          .foregroundStyle(.secondary)
          .fixedSize()
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .contentShape(.rect)
    // Web's link name: the preview, then "N mentions, N unread replies".
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(label)
    .accessibilityValue(row.accessibilityValue)
  }
}

/// Web's overflow row under a room's inset Threads, "N more unread threads", muted, on the Thread labels'
/// column: the Thread row's layout with an empty mark.
struct SidebarMoreThreadsLabel: View {
  let count: Int

  var body: some View {
    HStack(spacing: 8) {
      ThreadListMark(tone: .read, namesReader: false, diameter: SidebarThreadRowLabel.markDiameter)
        .hidden()
      Text(moreUnreadThreadsLabel(count))
        .font(.callout)
        .foregroundStyle(.secondary)
        .lineLimit(1)
      Spacer(minLength: 0)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .contentShape(.rect)
  }
}
