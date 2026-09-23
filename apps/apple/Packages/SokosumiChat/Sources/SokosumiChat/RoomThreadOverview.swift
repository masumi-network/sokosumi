import Combine
import CoreAPI
import Foundation

/// The selected room's thread list. Merely loading the overview never marks it read.
@MainActor
public final class RoomThreadOverview: ObservableObject {
  @Published public private(set) var items: [Components.Schemas.ChatRoomThread] = []
  @Published public private(set) var previews: [String: String] = [:]
  @Published public private(set) var nextCursor: String?
  @Published public private(set) var unreadCount = 0
  @Published public private(set) var isLoading = false
  @Published public private(set) var isMarkingRead = false
  @Published public private(set) var failure: (any Error)?
  private var generation = 0
  private var countGeneration = 0
  private var loadGeneration = 0

  public init() {}

  /// The loaded threads under Unread and Earlier.
  public var groups: RoomThreadOverviewGroups {
    RoomThreadOverviewGroups(threads: items)
  }

  public func reset() {
    generation += 1
    countGeneration += 1
    loadGeneration += 1
    items = []
    previews = [:]
    nextCursor = nil
    unreadCount = 0
    isLoading = false
    isMarkingRead = false
    failure = nil
  }

  public func refreshCount(client: Client, roomId: String, organizationSlug: String?) async throws {
    countGeneration += 1
    let request = countGeneration
    let count = try await ChatService().countUnreadThreads(client: client, roomId: roomId, organizationSlug: organizationSlug)
    guard request == countGeneration, !Task.isCancelled else { return }
    unreadCount = max(0, count)
  }

  public func load(client: Client, roomId: String, organizationSlug: String?, older: Bool = false, mentions: MessageMentions? = nil) async throws {
    guard !isMarkingRead else { return }
    try await loadPage(client: client, roomId: roomId, organizationSlug: organizationSlug, older: older, mentions: mentions)
  }

  private func loadPage(client: Client, roomId: String, organizationSlug: String?, older: Bool = false, mentions: MessageMentions? = nil) async throws {
    guard !older || (!isLoading && nextCursor != nil), !Task.isCancelled else { return }
    loadGeneration += 1
    let request = loadGeneration
    let cursor = older ? nextCursor : nil
    isLoading = true
    failure = nil
    defer {
      if request == loadGeneration {
        isLoading = false
      }
    }
    do {
      let page = try await ChatService().listThreads(client: client, roomId: roomId, cursor: cursor, organizationSlug: organizationSlug)
      guard request == loadGeneration, !Task.isCancelled else { return }
      var seen = Set<String>()
      let incoming = page.items.filter { $0.parentMessage.roomId == roomId && seen.insert($0.parentMessage.id).inserted }
      let labels = await Task.detached {
        let names = mentions?.previewNames ?? [:]
        return Dictionary(uniqueKeysWithValues: incoming.map { item in
          (item.parentMessage.id, ChatMessagePreview.text(item.parentMessage.content, names: names))
        })
      }.value
      guard request == loadGeneration, !Task.isCancelled else { return }
      if older {
        previews.merge(labels) { _, new in new }
        let known = Set(items.map(\.parentMessage.id))
        items += incoming.filter { !known.contains($0.parentMessage.id) }
      } else {
        previews = labels
        items = incoming
      }
      nextCursor = page.nextCursor == cursor ? nil : page.nextCursor
    } catch {
      guard request == loadGeneration, !Task.isCancelled else { return }
      failure = error
      throw error
    }
  }

  /// Once Core accepted, `looked` tells the room before the first page reloads, as web's
  /// `onAllThreadsLooked`: the room re-counts the Threads trigger and posts its read. The count here waits
  /// for that re-count, because Mark all skips a muted thread with an unread mention.
  public func markAllRead(client: Client, roomId: String, organizationSlug: String?, mentions: MessageMentions? = nil,
                          looked: () async -> Void) async throws {
    guard !isMarkingRead, !isLoading, !Task.isCancelled else { return }
    let request = generation
    isMarkingRead = true
    failure = nil
    defer {
      if request == generation {
        isMarkingRead = false
      }
    }
    do {
      try await ChatService().markAllThreadsRead(client: client, roomId: roomId, organizationSlug: organizationSlug)
      guard request == generation, !Task.isCancelled else { return }
      countGeneration += 1
      await looked()
      guard request == generation, !Task.isCancelled else { return }
      try await loadPage(client: client, roomId: roomId, organizationSlug: organizationSlug, mentions: mentions)
    } catch {
      guard request == generation, !Task.isCancelled else { return }
      failure = error
      throw error
    }
  }
}
