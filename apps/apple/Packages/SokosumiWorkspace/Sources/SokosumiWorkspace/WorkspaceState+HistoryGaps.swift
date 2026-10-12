import CoreAPI
import Foundation
import SokosumiAuth
import SokosumiChat

/// History gap rows (row 04a): the page between two loaded ranges that a
/// jump left apart. One loading path, `RoomTimeline.loadPage(.boundary)`;
/// the row's state lives in `RoomTimeline.boundaryLoads`.
extension WorkspaceState {
  /// A gap row scrolled into or out of view (web's `useLoadWhenVisible`):
  /// in view and idle, it loads itself once.
  public func setHistoryGapVisible(before messageId: String, _ isVisible: Bool, auth: AuthState) {
    guard transcriptRoomId != nil else { return }
    room.timeline.boundaryLoads.setVisible(messageId, isVisible)
    loadNextVisibleHistoryGap(auth: auth)
  }

  /// A tap on the row, or Try again after a failure. The outcome stays on the row.
  public func loadHistoryGap(before messageId: String, auth: AuthState) {
    guard transcriptRoomId != nil, room.timeline.historyGapMessageIds.contains(messageId),
          let client = resolveClient(auth: auth), room.timeline.boundaryLoads.begin(messageId) else { return }
    startHistoryGapLoad(messageId, client: client, auth: auth)
  }

  private func loadNextVisibleHistoryGap(auth: AuthState) {
    guard let client = resolveClient(auth: auth), room.timeline.boundaryLoads.loadingCursorMessageId == nil,
          let messageId = room.timeline.boundaryLoads.nextAutomaticLoad() else { return }
    guard room.timeline.historyGapMessageIds.contains(messageId) else {
      room.timeline.boundaryLoads.release(messageId)
      return
    }
    startHistoryGapLoad(messageId, client: client, auth: auth)
  }

  /// Gap pages queue behind whatever transcript request is in flight (the
  /// timeline admits one page at a time) and behind each other, so a tap on a
  /// second gap is not refused. When one settles, the next visible idle gap follows.
  private func startHistoryGapLoad(_ messageId: String, client: Client, auth: AuthState) {
    let generation = room.timeline.generation
    historyGapRequest += 1
    let request = historyGapRequest
    historyGapTask = Task { [previous = historyGapTask] in
      await previous?.value
      defer {
        if historyGapRequest == request {
          historyGapTask = nil
        }
      }
      while generation == room.timeline.generation,
            let task = transcriptLoadTask ?? olderPageTask ?? transcriptRefreshTask {
        await task.value
      }
      guard generation == room.timeline.generation, !Task.isCancelled else { return }
      do {
        let applied = try await room.timeline.loadPage(
          .boundary(messageId), client: client,
          organizationSlug: selection?.workspace.organizationSlug, generation: generation
        )
        if !applied, generation == room.timeline.generation {
          // Refused by an untracked page (a jump in flight): the row goes
          // back to Load missing messages for a tap.
          room.timeline.boundaryLoads.release(messageId)
        }
      } catch {
        if let error = error as? ChatServiceError {
          signOutIfUnauthorized(error, auth: auth)
        }
      }
      guard generation == room.timeline.generation, !Task.isCancelled else { return }
      loadNextVisibleHistoryGap(auth: auth)
    }
  }
}
