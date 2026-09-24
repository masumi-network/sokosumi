import CoreAPI
import SokosumiChat
import SwiftUI

/// The room's thread overview, web's `ThreadListPanel`: the rows under Unread and Earlier (row 24d), and
/// paging and failures as web shows them (row 24e). The paging row after the last thread loads the next page
/// by itself once it scrolls into view, keeps a failed page on that row with a retry, and a failed first page
/// replaces the list.
struct RoomThreadOverviewView: View {
  @ObservedObject var overview: RoomThreadOverview
  let open: (Components.Schemas.ChatRoomMessage) -> Void
  let older: () -> Void
  let markAllRead: () -> Void
  let retry: () -> Void
  let close: () -> Void

  var body: some View {
    let groups = overview.groups
    VStack(spacing: 0) {
      HStack {
        Text("Threads").font(.headline)
        Spacer()
        if !groups.unread.isEmpty {
          // Web's button reads its loading label while Mark all and the reload after it run.
          Button(overview.isMarkingRead ? "Loading threads…" : "Mark all as read", action: markAllRead)
            .disabled(overview.isMarkingRead || overview.isLoading || overview.olderPageStatus == .loading)
        }
        Button("Close threads", systemImage: "xmark", action: close)
          .labelStyle(.iconOnly).buttonStyle(.borderless).help("Close threads")
      }.padding(16)
      Divider()
      ScrollView {
        LazyVStack(alignment: .leading, spacing: 4) {
          if overview.isLoading, overview.items.isEmpty {
            ProgressView("Loading threads…").frame(maxWidth: .infinity).padding()
          } else if let failure = overview.failureMessage {
            listFailure(failure)
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
              ThreadGroupHeading(title: "Unread", threadCount: groups.unread.count)
            }
          }
          if groups.showsEarlierHeading {
            Section {
              ForEach(groups.earlier, id: \.parentMessage.id, content: row)
            } header: {
              ThreadGroupHeading(title: "Earlier")
            }
          }
          if overview.nextCursor != nil {
            pagingRow
          }
        }.padding(8)
      }
    }.font(.callout)
  }

  /// Web's `ThreadListLoadMore`: asks for the next page once it is in view, once per arming. It re-arms when
  /// it goes idle again or the last row changes, and a failed page waits for the reader's click.
  private var pagingRow: some View {
    PageBoundaryRow(copy: .olderThreads, status: overview.olderPageStatus, load: older)
      // `load` ignores a click while the first page loads or Mark all runs; do not offer one.
      .disabled(overview.isLoading || overview.isMarkingRead)
      .loadsWhenVisible(armed: overview.loadsOlderAutomatically, boundaryKey: overview.items.last?.parentMessage.id, load: older)
  }

  /// The list's own error in place of the rows (a failed first page) or over them (a failed Mark all), centred
  /// as web shows it. Web offers no control for a failed first page; Apple keeps its Retry there, as the
  /// transcript keeps one for a failed latest page (row 04a). A failed Mark all is retried by Mark all itself.
  private func listFailure(_ message: String) -> some View {
    VStack(spacing: 8) {
      Text(message).foregroundStyle(.secondary).multilineTextAlignment(.center)
      if overview.items.isEmpty {
        Button("Retry", action: retry)
      }
    }
    .frame(maxWidth: .infinity).padding(.horizontal, 8).padding(.vertical, 16)
  }

  private func row(_ item: Components.Schemas.ChatRoomThread) -> some View {
    let isUnread = RoomThreadOverviewGroups.isUnread(item)
    let starter = messageSenderName(item.parentMessage.sender)
    return ThreadListRow(
      isUnread: isUnread,
      label: preview(for: item.parentMessage),
      time: item.lastReplyAt,
      newReplies: isUnread ? item.unreadReplyCount : nil,
      meta: isUnread ? starter : "Started by \(starter) · \(threadRepliesLabel(item.replyCount))",
      isMuted: item.mutedAt != nil
    ) { open(item.parentMessage) }
  }

  private func preview(for message: Components.Schemas.ChatRoomMessage) -> String {
    guard let text = overview.previews[message.id], !text.isEmpty else { return messageSenderName(message.sender) }
    return text
  }
}
