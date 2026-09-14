import Combine
import CoreAPI
import Foundation

/// A channel's shared pin list. Request identity prevents another room's response from entering the panel.
@MainActor
public final class PinnedMessages: ObservableObject {
  @Published public private(set) var roomId: String?
  @Published public private(set) var items: [Components.Schemas.ChatRoomPinnedMessageListItem] = []
  @Published public private(set) var nextCursor: String?
  @Published public private(set) var isLoading = false
  @Published public private(set) var errorMessage: String?
  @Published public private(set) var revision = 0
  public private(set) var roomGeneration = 0
  private var generation = 0
  private var loadTask: Task<Void, Error>?

  public init() {}

  public func reset(roomId: String? = nil) {
    roomGeneration += 1
    invalidate()
    self.roomId = roomId
    items = []
    nextCursor = nil
    isLoading = false
    errorMessage = nil
  }

  public func invalidate() {
    loadTask?.cancel()
    loadTask = nil
    generation += 1
    revision += 1
    isLoading = false
  }

  public func remove(messageId: String) {
    items.removeAll { $0.messageId == messageId }
    invalidate()
  }

  public func load(client: Client, organizationSlug: String?, older: Bool = false) async throws {
    if let loadTask {
      try await loadTask.value
      return
    }
    guard let roomId, !older || nextCursor != nil else { return }
    let requestedGeneration = generation
    let cursor = older ? nextCursor : nil
    isLoading = true
    errorMessage = nil
    let task = Task {
      try await self.loadPage(client: client, roomId: roomId, organizationSlug: organizationSlug,
                              cursor: cursor, requestedGeneration: requestedGeneration)
    }
    loadTask = task
    try await task.value
  }

  private func loadPage(client: Client, roomId: String, organizationSlug: String?, cursor: String?,
                        requestedGeneration: Int) async throws {
    defer {
      if requestedGeneration == generation {
        isLoading = false
        loadTask = nil
      }
    }
    do {
      let page = try await ChatService().listPinnedMessages(client: client, roomId: roomId, cursor: cursor, organizationSlug: organizationSlug)
      guard requestedGeneration == generation, !Task.isCancelled else { return }
      if cursor != nil {
        let known = Set(items.map(\.messageId))
        items += page.items.filter { !known.contains($0.messageId) }
      } else {
        items = page.items
      }
      nextCursor = page.nextCursor == cursor ? nil : page.nextCursor
    } catch {
      guard requestedGeneration == generation, !Task.isCancelled else { return }
      errorMessage = friendlyMessage(for: error)
      throw error
    }
  }
}
