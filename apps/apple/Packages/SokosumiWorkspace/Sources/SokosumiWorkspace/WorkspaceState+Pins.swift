import CoreAPI
import SokosumiAuth
import SokosumiChat

public extension WorkspaceState {
  var canUsePins: Bool {
    rooms.first { $0.id == transcriptRoomId }?.kind == .channel
  }

  func isPinned(_ message: Components.Schemas.ChatRoomMessage) -> Bool {
    guard message.deletedAt == nil else { return false }
    return room.timeline.pinOverrides[message.id] ?? (message.pinnedAt != nil)
  }

  func isUpdatingPin(_ messageId: String) -> Bool {
    pendingPins.contains(messageId)
  }

  func loadPins(older: Bool = false) async throws {
    guard canUsePins else { return }
    try await request(signIn: "Log in to view pinned messages.") { _, client, slug in
      try await pins.load(client: client, organizationSlug: slug, older: older)
    }
  }

  func setPinned(_ pinned: Bool, messageId: String) async throws {
    guard canUsePins, let roomId = transcriptRoomId, !pendingPins.contains(messageId) else { return }
    let generation = pins.roomGeneration
    let revision = pins.revision
    pendingPins.insert(messageId)
    defer {
      if generation == pins.roomGeneration {
        pendingPins.remove(messageId)
      }
    }
    do {
      let response = try await request(signIn: "Log in to update pinned messages.") { service, client, slug in
        try await pinned
          ? service.pinMessage(client: client, roomId: roomId, messageId: messageId, organizationSlug: slug)
          : service.unpinMessage(client: client, roomId: roomId, messageId: messageId, organizationSlug: slug)
      }
      guard generation == pins.roomGeneration, !Task.isCancelled else { return }
      // A live event may already carry a newer count or opposite action.
      guard revision == pins.revision else { pins.invalidate()
        return
      }
      // The same change a live pin event makes (one reducer for both).
      applyPin(roomId: roomId, messageId: messageId, isPinned: pinned, count: response.pinnedMessageCount)
    } catch {
      guard generation == pins.roomGeneration, !Task.isCancelled else { return }
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
    return try await room.loadAround(messageId)
  }

  func returnToLatest() async throws -> Bool {
    guard room.timeline.historicalAnchor != nil else { return true }
    guard resolveClient() != nil else {
      throw ChatServiceError.unauthorized("Log in to load messages.")
    }
    return try await room.returnToLatest()
  }
}
