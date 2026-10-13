import CoreAPI
import Foundation
import SokosumiAuth
import SokosumiChat

struct MentionRetryRequest: Hashable {
  let generation: Int
  let shellId: String
}

public extension WorkspaceState {
  /// Retry is offered to the mentioner only, and only while the source human
  /// message is loaded in the room or the open thread (web `mentionRetrySourceMessages`).
  func canRetryMention(_ shell: Components.Schemas.ChatRoomMessage) -> Bool {
    // Ordinary rows reach this while scrolling; reject them before copying the transcript.
    guard shell.roomId == transcriptRoomId,
          case .failed(_, _?) = MentionThoughtShell(message: shell) else { return false }
    return MentionThoughtShell.canRetry(shell, currentUserId: currentUserId, sources: mentionRetrySources)
  }

  /// Flip the failed shell back to a live Thought, then `POST …/mentions/{mentionId}/retry`.
  /// Success merges the returned source message (mentions reset to pending);
  /// the shell's own progress returns over realtime. Any failure restores the
  /// failed shell and rethrows so the row can show Core's reason.
  func retryMention(_ shell: Components.Schemas.ChatRoomMessage, now: Date) async throws {
    guard shell.roomId == transcriptRoomId,
          case let .failed(mentionId, sourceMessageId?) = MentionThoughtShell(message: shell) else { return }
    let request = MentionRetryRequest(generation: room.timeline.generation, shellId: shell.id)
    guard !pendingMentionRetries.contains(request) else { return }
    guard let client = resolveClient() else {
      throw ChatServiceError.unauthorized("Log in to retry mentions.")
    }
    pendingMentionRetries.insert(request)
    defer { pendingMentionRetries.remove(request) }
    replaceLoaded(MentionThoughtShell.retrying(shell, startedAt: now))
    do {
      let source = try await ChatService().retryMention(
        client: client, roomId: shell.roomId, messageId: sourceMessageId, mentionId: mentionId,
        organizationSlug: selection?.workspace.organizationSlug
      )
      guard request.generation == room.timeline.generation, !Task.isCancelled else { return }
      replaceLoaded(source)
    } catch {
      guard request.generation == room.timeline.generation, !Task.isCancelled else { return }
      replaceLoaded(shell)
      if let error = error as? ChatServiceError {
        signOutIfUnauthorized(error)
      }
      throw error
    }
  }
}

private extension WorkspaceState {
  var mentionRetrySources: [Components.Schemas.ChatRoomMessage] {
    loaded.all
  }

  /// Update-only: a row that is not loaded stays absent, unlike a realtime create.
  func replaceLoaded(_ message: Components.Schemas.ChatRoomMessage) {
    loaded.update(message.id) { _ in message }
  }
}
