import CoreAPI
import SokosumiAuth
import SokosumiChat

public extension WorkspaceState {
  var canUsePins: Bool {
    rooms.first { $0.id == transcriptRoomId }?.kind == .channel
  }

  func isPinned(_ message: Components.Schemas.ChatRoomMessage) -> Bool {
    guard message.deletedAt == nil else { return false }
    return timeline.pinOverrides[message.id] ?? (message.pinnedAt != nil)
  }

  func isUpdatingPin(_ messageId: String) -> Bool {
    pendingPins.contains(messageId)
  }

  func loadPins(auth: AuthState, older: Bool = false) async throws {
    guard canUsePins else { return }
    guard let client = resolveClient(auth: auth) else {
      throw ChatServiceError.unauthorized("Sign in to view pinned messages.")
    }
    try await pins.load(client: client, organizationSlug: selection?.workspace.organizationSlug, older: older)
  }

  func setPinned(_ pinned: Bool, messageId: String, auth: AuthState) async throws {
    guard canUsePins, let roomId = transcriptRoomId, !pendingPins.contains(messageId) else { return }
    guard let client = resolveClient(auth: auth) else {
      throw ChatServiceError.unauthorized("Sign in to update pinned messages.")
    }
    let generation = pins.roomGeneration
    let revision = pins.revision
    pendingPins.insert(messageId)
    defer {
      if generation == pins.roomGeneration {
        pendingPins.remove(messageId)
      }
    }
    do {
      let response = try await pinned
        ? ChatService().pinMessage(client: client, roomId: roomId, messageId: messageId, organizationSlug: selection?.workspace.organizationSlug)
        : ChatService().unpinMessage(client: client, roomId: roomId, messageId: messageId, organizationSlug: selection?.workspace.organizationSlug)
      guard generation == pins.roomGeneration, !Task.isCancelled else { return }
      // A live event may already carry a newer count or opposite action.
      guard revision == pins.revision else { pins.invalidate()
        return
      }
      timeline.applyPin(roomId: roomId, messageId: messageId, isPinned: pinned)
      if let index = rooms.firstIndex(where: { $0.id == roomId }) {
        rooms[index].pinnedMessageCount = response.pinnedMessageCount
      }
      if pinned {
        pins.invalidate()
      } else {
        pins.remove(messageId: messageId)
      }
    } catch {
      guard generation == pins.roomGeneration, !Task.isCancelled else { return }
      if let error = error as? ChatServiceError {
        signOutIfUnauthorized(error, auth: auth)
      }
      throw error
    }
  }

  func jumpToMessage(_ messageId: String, auth: AuthState) async throws -> Bool {
    if displayedTranscript.contains(where: { $0.id == messageId }) {
      return true
    }
    guard let client = resolveClient(auth: auth) else {
      throw ChatServiceError.unauthorized("Sign in to view this message.")
    }
    return try await timeline.loadPage(.around(messageId), client: client,
                                       organizationSlug: selection?.workspace.organizationSlug, generation: timeline.generation)
  }

  func returnToLatest(auth: AuthState) async throws -> Bool {
    guard timeline.historicalAnchor != nil else { return true }
    guard let client = resolveClient(auth: auth) else {
      throw ChatServiceError.unauthorized("Sign in to load messages.")
    }
    return try await timeline.loadPage(.returnToLatest, client: client,
                                       organizationSlug: selection?.workspace.organizationSlug, generation: timeline.generation)
  }
}
