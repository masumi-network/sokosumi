import CoreAPI
import SokosumiChat
import SokosumiWorkspace
import SwiftUI

/// The chat-level Threads view, web's `UnreadThreadsView` on `/chat/threads` (row 24f1, SOK-1159): every
/// Thread the reader is part of across the workspace's rooms, the unread ones under "Unread" and the rest
/// under "Earlier", each row naming its room. It stands in the detail column where the room was; a row opens
/// its Thread in its room. Each group pages on its own and reads Core again whenever the rooms' Thread
/// counts move, keeping its rows until the new page answers.
struct CrossRoomThreadsView: View {
  @ObservedObject var threads: CrossRoomThreads
  let rooms: [Components.Schemas.ChatRoom]
  /// The rooms are Core's answer rather than an empty list still loading.
  let roomsLive: Bool
  let currentUserId: String
  /// The workspace the lists answer; a switch reads both again.
  let scope: String?
  let load: (WorkspaceState.CrossRoomThreadsAction) async -> Void
  let open: (_ roomId: String, _ messageId: String) -> Void

  private struct LoadKey: Equatable {
    let scope: String?
    let fingerprint: String
  }

  var body: some View {
    let roomsById = Dictionary(rooms.map { ($0.id, $0) }) { first, _ in first }
    ScrollView {
      // A reading column, as web's `max-w-3xl`: a thread's name and its time on one line the eye can cross.
      LazyVStack(alignment: .leading, spacing: 4) {
        Section {
          unreadGroup(roomsById)
        } header: {
          ThreadGroupHeading(title: "Unread", threadCount: resolveUnreadThreadsAttention(rooms).threadCount)
        }
        if threads.showsEarlier(rooms: rooms) {
          Section {
            earlierGroup(roomsById)
          } header: {
            ThreadGroupHeading(title: "Earlier")
          }
        }
      }
      .padding(8)
      .frame(maxWidth: 768)
      .frame(maxWidth: .infinity)
    }
    .font(.callout)
    .task(id: LoadKey(scope: scope, fingerprint: unreadThreadsFingerprint(rooms))) {
      await load(.unread)
    }
    .task(id: LoadKey(scope: scope, fingerprint: earlierThreadsFingerprint(rooms))) {
      await load(.earlier)
    }
  }

  @ViewBuilder
  private func unreadGroup(_ roomsById: [String: Components.Schemas.ChatRoom]) -> some View {
    switch threads.unreadState(rooms: rooms, roomsLive: roomsLive) {
    case .caughtUp:
      Text("All caught up")
        .font(.caption).foregroundStyle(.secondary)
        .frame(maxWidth: .infinity).padding(.vertical, 8)
    case .failed:
      groupFailure("Could not load unread threads.") { Task { await load(.unread) } }
    case .loading:
      ProgressView()
        .controlSize(.small)
        .accessibilityLabel("Unread threads")
        .frame(maxWidth: .infinity).padding()
    case .rows:
      // The rows are already the ones whose room is listed; pairing them keeps one view per row.
      let rows = threads.unreadRows(rooms: rooms)
      ForEach(rows.compactMap { thread in roomsById[thread.roomId].map { (thread: thread, room: $0) } },
              id: \.thread.parentMessageId) { entry in
        unreadRow(entry.thread, room: entry.room)
      }
      if threads.unread.nextCursor != nil {
        pagingRow(.unreadThreads, pages: threads.unread.olderPageStatus, armed: threads.unread.loadsOlderAutomatically,
                  boundaryKey: rows.last?.parentMessageId, action: .olderUnread)
      }
    }
  }

  @ViewBuilder
  private func earlierGroup(_ roomsById: [String: Components.Schemas.ChatRoom]) -> some View {
    let rows = threads.earlierRows(rooms: rooms)
    if threads.earlier.firstPageFailed, rows.isEmpty {
      groupFailure("Could not load threads. Try again.") { Task { await load(.earlier) } }
    } else {
      ForEach(rows.compactMap { thread in roomsById[thread.roomId].map { (thread: thread, room: $0) } },
              id: \.thread.parentMessageId) { entry in
        earlierRow(entry.thread, room: entry.room)
      }
      if threads.earlier.nextCursor != nil {
        pagingRow(.earlierThreads, pages: threads.earlier.olderPageStatus, armed: threads.earlier.loadsOlderAutomatically,
                  boundaryKey: rows.last?.parentMessageId, action: .olderEarlier)
      }
    }
  }

  /// Web's `UnreadThreadLink`: the room names the row where the room's own list names the starter, and it
  /// opens at the Thread's first unread reply, which Looks it through the thread's existing path.
  private func unreadRow(_ thread: Components.Schemas.ChatUnreadThread, room: Components.Schemas.ChatRoom) -> some View {
    ThreadListRow(
      isUnread: true,
      label: threads.label(for: thread.parentMessageId),
      time: thread.lastUnreadAt,
      newReplies: thread.unreadReplyCount,
      meta: roomLabel(room),
      mentionCount: thread.unreadMentionCount ?? 0
    ) { open(thread.roomId, thread.firstUnreadReplyId) }
  }

  /// Web's `EarlierThreadLink`: the room and the reply count, opening at the newest reply.
  private func earlierRow(_ thread: Components.Schemas.ChatEarlierThread, room: Components.Schemas.ChatRoom) -> some View {
    ThreadListRow(
      isUnread: false,
      label: threads.label(for: thread.parentMessageId),
      time: thread.lastReplyAt,
      meta: "\(roomLabel(room)) · \(threadRepliesLabel(thread.replyCount))"
    ) { open(thread.roomId, thread.lastReplyId) }
  }

  private func pagingRow(_ copy: PageBoundaryRow.Copy, pages status: PageBoundaryStatus, armed: Bool, boundaryKey: String?,
                         action: WorkspaceState.CrossRoomThreadsAction) -> some View {
    PageBoundaryRow(copy: copy, status: status) { Task { await load(action) } }
      .loadsWhenVisible(armed: armed, boundaryKey: boundaryKey) { Task { await load(action) } }
  }

  /// Web's first-read failure under a group: the message, then Try again, which reads the first page again.
  private func groupFailure(_ message: String, retry: @escaping () -> Void) -> some View {
    VStack(alignment: .leading, spacing: 8) {
      Text(message).foregroundStyle(.secondary)
      Button("Try again", action: retry)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding(.horizontal, 10).padding(.vertical, 8)
  }

  /// Web's `useThreadRowNames`: a channel reads `#name`; a Direct its display name.
  private func roomLabel(_ room: Components.Schemas.ChatRoom) -> String {
    let name = roomDisplayName(room, currentUserId: currentUserId)
    return room.kind == .channel ? "#\(name)" : name
  }
}
