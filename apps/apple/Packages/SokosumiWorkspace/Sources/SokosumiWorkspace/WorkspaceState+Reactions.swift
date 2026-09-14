import CoreAPI
import SokosumiAuth
import SokosumiChat

struct ReactionRequest: Hashable {
  let generation: Int
  let messageId: String
  let emoji: String
}

public extension WorkspaceState {
  func pendingReactionEmoji(for messageId: String) -> Set<String> {
    Set(pendingReactions.filter { $0.generation == timeline.generation && $0.messageId == messageId }.map(\.emoji))
  }

  func toggleReaction(_ source: Components.Schemas.ChatRoomMessage, emoji: String, auth: AuthState) async throws {
    guard source.roomId == transcriptRoomId, canReactToMessage(source) else { return }
    let request = ReactionRequest(generation: timeline.generation, messageId: source.id, emoji: emoji)
    guard !pendingReactions.contains(request) else { return }
    guard let client = resolveClient(auth: auth) else {
      throw ChatServiceError.unauthorized("Sign in to react to messages.")
    }
    let initialReaction = currentReaction(messageId: source.id, emoji: emoji)
    let organizationSlug = selection?.workspace.organizationSlug
    pendingReactions.insert(request)
    defer { pendingReactions.remove(request) }
    do {
      var message = try await ChatService().toggleReaction(client: client, roomId: source.roomId, messageId: source.id,
                                                           emoji: emoji, organizationSlug: organizationSlug)
      guard request.generation == timeline.generation, message.roomId == transcriptRoomId, !Task.isCancelled else { return }
      let current = currentReaction(messageId: source.id, emoji: emoji)
      if current != initialReaction, current != message.reactions.first(where: { $0.emoji == emoji }) {
        // Realtime changed this emoji during the request. Reconcile once instead of rolling it back.
        message = try await ChatService().getMessage(client: client, roomId: source.roomId, messageId: source.id,
                                                     organizationSlug: organizationSlug)
        guard request.generation == timeline.generation, !Task.isCancelled,
              currentReaction(messageId: source.id, emoji: emoji) == current else { return }
      }
      timeline.messages = timeline.messages.map { applyingReactionResponse(message, emoji: emoji, to: $0) }
      if let parent = thread.parent {
        thread.apply(eventType: .update, message: applyingReactionResponse(message, emoji: emoji, to: parent))
      }
      thread.timeline.messages = thread.timeline.messages.map { applyingReactionResponse(message, emoji: emoji, to: $0) }
    } catch {
      guard request.generation == timeline.generation, !Task.isCancelled else { return }
      if let error = error as? ChatServiceError {
        signOutIfUnauthorized(error, auth: auth)
      }
      throw error
    }
  }
}

private extension WorkspaceState {
  func currentReaction(messageId: String, emoji: String) -> Components.Schemas.ChatRoomMessageReaction? {
    let message = timeline.messages.first { $0.id == messageId }
      ?? (thread.parent?.id == messageId ? thread.parent : nil)
      ?? thread.timeline.messages.first { $0.id == messageId }
    return message?.reactions.first { $0.emoji == emoji }
  }
}
