import CoreAPI
import SokosumiAuth
import SokosumiChat

public extension WorkspaceState {
  /// Shows the tap at once and tells Core the end state (ADR 0032). Requests
  /// for one message and emoji run one at a time and only the newest intent
  /// is sent; a tap that lands while one is running returns at once. The
  /// request outlives leaving the room. Returns whether this call's requests
  /// ended with the viewer's reaction on the message; a failure drops only
  /// this emoji's intent and rethrows.
  @discardableResult
  func toggleReaction(_ source: Components.Schemas.ChatRoomMessage, emoji: String, auth: AuthState) async throws -> Bool {
    guard source.roomId == transcriptRoomId, canReactToMessage(source) else { return false }
    guard let client = resolveClient(auth: auth) else {
      throw ChatServiceError.unauthorized("Sign in to react to messages.")
    }
    let confirmed = confirmedMessage(source.id) ?? source
    let confirmedReacted = confirmed.reactions.contains { $0.emoji == emoji && $0.reactedByCurrentUser }
    guard var sent = pendingReactions.tap(messageId: source.id, emoji: emoji, confirmedReacted: confirmedReacted) else { return false }
    defer { pendingReactions.settle(messageId: source.id, emoji: emoji) }
    let organizationSlug = selection?.workspace.organizationSlug
    let service = ChatService()
    do {
      while true {
        let sendReaction = sent ? service.addReaction : service.removeReaction
        let response = try await sendReaction(client, source.roomId, source.id, emoji, organizationSlug)
        // Matched by message and room id, so a room left meanwhile is untouched.
        timeline.messages = timeline.messages.map { applyingReactionResponse(response, emoji: emoji, to: $0) }
        if let parent = thread.parent {
          thread.apply(eventType: .update, message: applyingReactionResponse(response, emoji: emoji, to: parent))
        }
        thread.timeline.messages = thread.timeline.messages.map { applyingReactionResponse(response, emoji: emoji, to: $0) }
        guard let next = pendingReactions.intent(messageId: source.id, emoji: emoji, after: sent) else { return sent }
        sent = next
      }
    } catch {
      if let error = error as? ChatServiceError {
        signOutIfUnauthorized(error, auth: auth)
      }
      throw error
    }
  }

  /// The thread parent with the viewer's Pending reactions on top.
  var displayedThreadParent: Components.Schemas.ChatRoomMessage? {
    thread.parent.map { pendingReactions.overlaying($0, viewer: reactionViewer) }
  }
}

extension WorkspaceState {
  /// Listed among the reactors under the name the open room shows, else the account name.
  var reactionViewer: PendingReactionViewer {
    let roomName = rooms.first { $0.id == transcriptRoomId }?.userMembers.first { $0.id == currentUserId }?.name
    let name = roomName ?? currentUserName
    return .init(id: currentUserId, name: name.isEmpty ? nil : name)
  }
}

private extension WorkspaceState {
  func confirmedMessage(_ messageId: String) -> Components.Schemas.ChatRoomMessage? {
    timeline.messages.first { $0.id == messageId }
      ?? (thread.parent?.id == messageId ? thread.parent : nil)
      ?? thread.timeline.messages.first { $0.id == messageId }
  }
}
