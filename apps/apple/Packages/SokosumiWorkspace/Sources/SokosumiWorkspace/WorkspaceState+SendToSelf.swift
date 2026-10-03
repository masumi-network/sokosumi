import CoreAPI
import SokosumiAuth
import SokosumiChat

public extension WorkspaceState {
  /// Same eligibility as Copy link, hidden inside the Self Direct itself.
  func canSendToSelf(_ message: Components.Schemas.ChatRoomMessage) -> Bool {
    canQuoteMessage(message) && rooms.first { $0.id == message.roomId }?.isSelfDirect != true
  }

  /// Quotes the message into the caller's Self Direct and returns the saved message there.
  func sendMessageToSelf(_ message: Components.Schemas.ChatRoomMessage, auth: AuthState) async throws -> Components.Schemas.ChatRoomMessage {
    guard let client = resolveClient(auth: auth) else {
      throw ChatServiceError.unauthorized("Log in to send messages to yourself.")
    }
    do {
      let saved = try await ChatService().sendMessageToSelf(client: client, roomId: message.roomId, messageId: message.id,
                                                            organizationSlug: selection?.workspace.organizationSlug)
      // Open uses openRoomLink, which only selects listed rooms; Core's chat_rooms_changed for the Self Direct may land after the alert.
      if !rooms.contains(where: { $0.id == saved.roomId }) {
        await refreshRooms(auth: auth)
      }
      return saved
    } catch {
      if let error = error as? ChatServiceError {
        signOutIfUnauthorized(error, auth: auth)
      }
      throw error
    }
  }
}
