import CoreAPI
import SokosumiChat
import SwiftUI

struct RoomThreadOverviewView: View {
  @ObservedObject var overview: RoomThreadOverview
  let open: (Components.Schemas.ChatRoomMessage) -> Void
  let older: () -> Void
  let markAllRead: () -> Void
  let retry: () -> Void
  let close: () -> Void
  @State private var hoveredId: String?

  var body: some View {
    let groups = overview.groups
    VStack(spacing: 0) {
      HStack {
        Text("Threads").font(.headline)
        Spacer()
        if !groups.unread.isEmpty {
          Button("Mark all as read", action: markAllRead)
            .disabled(overview.isMarkingRead || overview.isLoading)
        }
        Button("Close threads", systemImage: "xmark", action: close)
          .labelStyle(.iconOnly).buttonStyle(.borderless).help("Close threads")
      }.padding(16)
      Divider()
      ScrollView {
        LazyVStack(alignment: .leading, spacing: 4) {
          if overview.isLoading, overview.items.isEmpty {
            ProgressView("Loading threads…").frame(maxWidth: .infinity).padding()
          } else if let failure = overview.failure {
            VStack(alignment: .leading, spacing: 8) {
              Text(friendlyMessage(for: failure)).foregroundStyle(.secondary)
              Button("Retry", action: retry)
            }.padding()
          } else if overview.items.isEmpty {
            Text("No threads yet.").foregroundStyle(.secondary).padding()
          }
          if groups.showsUnreadHeading {
            Section {
              if groups.isCaughtUp {
                Text("All caught up")
                  .font(.caption).foregroundStyle(.secondary)
                  .frame(maxWidth: .infinity).padding(.vertical, 8)
              } else {
                ForEach(groups.unread, id: \.parentMessage.id, content: row)
              }
            } header: {
              RoomThreadOverviewGroupHeading(title: "Unread", threadCount: groups.unread.count)
            }
          }
          if groups.showsEarlierHeading {
            Section {
              ForEach(groups.earlier, id: \.parentMessage.id, content: row)
            } header: {
              RoomThreadOverviewGroupHeading(title: "Earlier")
            }
          }
          if overview.nextCursor != nil {
            Button(overview.isLoading ? "Loading…" : "Load older threads", action: older)
              .disabled(overview.isLoading || overview.isMarkingRead)
              .frame(maxWidth: .infinity).padding(8)
          }
        }.padding(8)
      }
    }.font(.callout)
  }

  private func row(_ item: Components.Schemas.ChatRoomThread) -> some View {
    let isUnread = RoomThreadOverviewGroups.isUnread(item)
    let starter = messageSenderName(item.parentMessage.sender)
    return Button { open(item.parentMessage) } label: {
      HStack(alignment: .top, spacing: 10) {
        RoomThreadOverviewMark(isUnread: isUnread)
        VStack(alignment: .leading, spacing: 4) {
          HStack(alignment: .top) {
            Text(preview(for: item.parentMessage))
              .lineLimit(2)
              .fontWeight(isUnread ? .semibold : .regular)
              .foregroundStyle(isUnread ? HierarchicalShapeStyle.primary : .secondary)
            Spacer(minLength: 4)
            if item.mutedAt != nil {
              Image(systemName: "bell.slash")
                .font(.caption).foregroundStyle(.secondary)
                .help("Muted").accessibilityLabel("Muted")
            }
            Text(item.lastReplyAt, format: .relative(presentation: .numeric, unitsStyle: .abbreviated))
              .font(.caption).fontWeight(isUnread ? .medium : .regular).monospacedDigit().lineLimit(1)
              .foregroundStyle(isUnread ? Color.accentColor : Color.secondary)
          }
          Group {
            if isUnread {
              // What is new leads, tinted; the starter drops to a trailing name.
              Text("\(Text(threadNewRepliesLabel(item.unreadReplyCount)).fontWeight(.medium).foregroundStyle(.tint)) · \(Text(verbatim: starter))")
            } else {
              Text("Started by \(starter) · \(threadRepliesLabel(item.replyCount))")
            }
          }
          .font(.caption).foregroundStyle(.secondary).lineLimit(1)
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading).padding(10)
      .background(rowBackground(unread: isUnread, hovered: hoveredId == item.parentMessage.id), in: .rect(cornerRadius: 8))
      .contentShape(.rect)
    }
    .buttonStyle(.plain)
    .onHover { hovering in
      // Only this row's own exit clears it: moving between rows can deliver the next row's enter first.
      if hovering {
        hoveredId = item.parentMessage.id
      } else if hoveredId == item.parentMessage.id {
        hoveredId = nil
      }
    }
  }

  /// Web's `threadListRowClassName`: the unread rows are the one place the list spends the accent, deepening
  /// on hover; a read row only shows the neutral hover.
  private func rowBackground(unread: Bool, hovered: Bool) -> Color {
    if unread {
      return Color.accentColor.opacity(hovered ? 0.15 : 0.08)
    }
    return hovered ? Color.primary.opacity(0.1) : .clear
  }

  private func preview(for message: Components.Schemas.ChatRoomMessage) -> String {
    guard let text = overview.previews[message.id], !text.isEmpty else { return messageSenderName(message.sender) }
    return text
  }
}

/// Web's `UnreadThreads.newReplies`: "1 new", "2 new".
private func threadNewRepliesLabel(_ count: Int) -> String {
  "\(max(0, count)) new"
}

/// Web's `Thread.replyCount`: "1 reply", "2 replies".
private func threadRepliesLabel(_ count: Int) -> String {
  count == 1 ? "1 reply" : "\(count) replies"
}

/// A group heading in the thread overview, read as a heading by VoiceOver like web's `h3`. A count above
/// zero is drawn as a tinted pill, capped like the room counts and hidden from VoiceOver, as on web: the
/// rows under it say how many.
private struct RoomThreadOverviewGroupHeading: View {
  let title: LocalizedStringKey
  var threadCount = 0

  var body: some View {
    HStack(spacing: 6) {
      Text(title)
        .font(.subheadline.weight(.semibold)).foregroundStyle(.secondary)
        .accessibilityAddTraits(.isHeader)
      if threadCount > 0 {
        Text(roomCountLabel(threadCount))
          .font(.caption2.weight(.semibold)).monospacedDigit().foregroundStyle(.tint)
          .padding(.horizontal, 6).padding(.vertical, 1)
          .background(Color.accentColor.opacity(0.15), in: .capsule)
          .accessibilityHidden(true)
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding(.horizontal, 10).padding(.top, 8).padding(.bottom, 2)
  }
}

/// The leading thread mark, web's `ThreadIconCircle`: the accent tint in a circle while the thread has
/// unread replies, a bare secondary glyph once read. Hidden from VoiceOver; the second line says it.
private struct RoomThreadOverviewMark: View {
  let isUnread: Bool

  var body: some View {
    Image(systemName: "bubble.left")
      .font(.caption)
      .foregroundStyle(isUnread ? Color.accentColor : Color.secondary)
      .frame(width: 22, height: 22)
      .background(isUnread ? Color.accentColor.opacity(0.15) : .clear, in: .circle)
      .accessibilityHidden(true)
  }
}
