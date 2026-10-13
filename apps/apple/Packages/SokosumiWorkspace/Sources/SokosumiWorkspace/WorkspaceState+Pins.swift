import CoreAPI
import SokosumiAuth
import SokosumiChat

public extension WorkspaceState {
  var canUsePins: Bool {
    rooms.first { $0.id == transcriptRoomId }?.kind == .channel
  }

  func isPinned(_ message: Components.Schemas.ChatRoomMessage) -> Bool {
    guard message.deletedAt == nil else { return false }
    return openRoom.room.timeline.pinOverrides[message.id] ?? (message.pinnedAt != nil)
  }

  func isUpdatingPin(_ messageId: String) -> Bool {
    openRoom.pendingPins.contains(messageId)
  }

  func loadPins(older: Bool = false) async throws {
    guard canUsePins else { return }
    try await request(signIn: "Log in to view pinned messages.") { _, client, slug in
      try await openRoom.pins.load(client: client, organizationSlug: slug, older: older)
    }
  }

  func setPinned(_ pinned: Bool, messageId: String) async throws {
    guard canUsePins, let roomId = transcriptRoomId, openRoom.startPinChange(messageId) else { return }
    let generation = openRoom.pins.roomGeneration
    let revision = openRoom.pins.revision
    defer {
      if generation == openRoom.pins.roomGeneration {
        openRoom.finishPinChange(messageId)
      }
    }
    do {
      let response = try await request(signIn: "Log in to update pinned messages.") { service, client, slug in
        try await pinned
          ? service.pinMessage(client: client, roomId: roomId, messageId: messageId, organizationSlug: slug)
          : service.unpinMessage(client: client, roomId: roomId, messageId: messageId, organizationSlug: slug)
      }
      guard generation == openRoom.pins.roomGeneration, !Task.isCancelled else { return }
      // A live event may already carry a newer count or opposite action.
      guard revision == openRoom.pins.revision else { openRoom.pins.invalidate()
        return
      }
      // The same change a live pin event makes (one reducer for both).
      applyPin(roomId: roomId, messageId: messageId, isPinned: pinned, count: response.pinnedMessageCount)
    } catch {
      guard generation == openRoom.pins.roomGeneration, !Task.isCancelled else { return }
      throw error
    }
  }

  func jumpToMessage(_ messageId: String) async throws -> Bool {
    if displayedTranscript.contains(where: { $0.id == messageId }) {
      return true
    }
    guard resolveClient() != nil else {
      throw ChatServiceError.unauthorized("Log in to view this message.")
    }
    return try await openRoom.room.loadAround(messageId)
  }
}
