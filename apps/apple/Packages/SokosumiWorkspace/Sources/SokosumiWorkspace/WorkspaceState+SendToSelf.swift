import CoreAPI
import SokosumiChat

public extension WorkspaceState {
  /// Same eligibility as Copy link, hidden inside the Self Direct itself.
  func canSendToSelf(_ message: Components.Schemas.ChatRoomMessage) -> Bool {
    canQuoteMessage(message) && rooms.first { $0.id == message.roomId }?.isSelfDirect != true
  }

  /// Quotes the message into the caller's Self Direct and returns the saved message there.
  func sendMessageToSelf(_ message: Components.Schemas.ChatRoomMessage) async throws -> Components.Schemas.ChatRoomMessage {
    let saved = try await request(signIn: "Log in to send messages to yourself.") { service, client, slug in
      try await service.sendMessageToSelf(client: client, roomId: message.roomId, messageId: message.id, organizationSlug: slug)
    }
    // Open uses openRoomLink, which only selects listed rooms; Core's chat_rooms_changed for the Self Direct may land after the alert.
    if !rooms.contains(where: { $0.id == saved.roomId }) {
      await refreshRoomsAfterChange()
    }
    return saved
  }
}
