import CoreAPI
import SokosumiAuth
import SokosumiChat

public extension WorkspaceState {
  /// A turn's thumbs: the rating Core stored in this session and whether one is
  /// on its way. Web keeps this in the row; here it survives scrolling and room
  /// switches until sign-out.
  func sokoBotFeedback(forTurn turnId: String) -> SokoBotFeedback {
    SokoBotFeedback(turnId: turnId, rating: sokoBotFeedback[turnId], isSending: pendingSokoBotFeedback.contains(turnId))
  }

  /// The thumbs a message's toolbar and right-click menu carry, or nil when it has none.
  func sokoBotFeedback(for message: Components.Schemas.ChatRoomMessage) -> SokoBotFeedback? {
    SokoBotFeedback.turnId(for: message).map(sokoBotFeedback(forTurn:))
  }

  /// `POST /soko-bots/me/turns/{id}/feedback`, once per turn: a second tap
  /// while the request is in flight, or after a rating stuck, sends nothing.
  /// Web ignores a rejected rating (the thumbs simply return); a 401 signs out
  /// like every other chat request. Rethrows so a row could still tell.
  func sendSokoBotFeedback(turnId: String, useful: Bool, auth: AuthState) async throws {
    guard !turnId.isEmpty, sokoBotFeedback[turnId] == nil, !pendingSokoBotFeedback.contains(turnId) else { return }
    guard let client = resolveClient(auth: auth) else {
      throw ChatServiceError.unauthorized("Sign in to rate replies.")
    }
    let context = compositionContext
    pendingSokoBotFeedback.insert(turnId)
    defer { pendingSokoBotFeedback.remove(turnId) }
    do {
      let stored = try await ChatService().sendSokoBotTurnFeedback(client: client, turnId: turnId, useful: useful)
      guard context == compositionContext, !Task.isCancelled else { return }
      sokoBotFeedback[turnId] = stored
    } catch {
      guard context == compositionContext, !Task.isCancelled else { return }
      if let error = error as? ChatServiceError {
        signOutIfUnauthorized(error, auth: auth)
      }
      throw error
    }
  }
}
