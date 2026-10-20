import Combine
import CoreAPI
import Foundation

/// A channel's shared pin list. Request identity prevents another room's response from entering the panel.
@MainActor
public final class PinnedMessages: ObservableObject {
  @Published public private(set) var roomId: String?
  /// The pins and the paging around them. A failed older page keeps them and shows `errorMessage`; its
  /// `.failed` status is never drawn.
  @Published private(set) var pages = CursorPages<Components.Schemas.ChatRoomPinnedMessageListItem>()
  @Published public private(set) var errorMessage: String?
  @Published public private(set) var revision = 0
  public private(set) var roomGeneration = 0
  private var loadTask: Task<Void, Error>?

  public init() {}

  public var items: [Components.Schemas.ChatRoomPinnedMessageListItem] {
    pages.items
  }

  public var nextCursor: String? {
    pages.nextCursor
  }

  /// A page of pins is out, the first or an older one.
  public var isLoading: Bool {
    pages.isLoadingFirstPage || pages.olderPageStatus == .loading
  }

  /// The first page is out: the panel's Loading line (web's `isLoading`); an older page only holds its button.
  public var isLoadingFirstPage: Bool {
    pages.isLoadingFirstPage
  }

  public func reset(roomId: String? = nil) {
    roomGeneration += 1
    invalidate()
    self.roomId = roomId
    pages.reset()
    errorMessage = nil
  }

  public func invalidate() {
    loadTask?.cancel()
    loadTask = nil
    pages.supersede()
    revision += 1
  }

  public func remove(messageId: String) {
    pages.removeAll { $0.messageId == messageId }
    invalidate()
  }

  public func load(client: Client, organizationSlug: String?, older: Bool = false) async throws {
    if let loadTask {
      try await loadTask.value
      return
    }
    guard let roomId, let request = pages.begin(older: older) else { return }
    errorMessage = nil
    let task = Task {
      try await self.loadPage(client: client, roomId: roomId, organizationSlug: organizationSlug, request: request)
    }
    loadTask = task
    try await task.value
  }

  private func loadPage(client: Client, roomId: String, organizationSlug: String?,
                        request: CursorPages<Components.Schemas.ChatRoomPinnedMessageListItem>.Request) async throws {
    defer {
      if pages.isCurrent(request) {
        pages.settle(request)
        loadTask = nil
      }
    }
    do {
      let page = try await ChatService().listPinnedMessages(client: client, roomId: roomId, cursor: request.cursor, organizationSlug: organizationSlug)
      guard pages.isCurrent(request), !Task.isCancelled else { return }
      pages.answer(request, items: page.items, nextCursor: page.nextCursor, id: \.messageId)
    } catch {
      guard pages.isCurrent(request), !Task.isCancelled else { return }
      pages.fail(request)
      errorMessage = friendlyMessage(for: error)
      throw error
    }
  }
}
