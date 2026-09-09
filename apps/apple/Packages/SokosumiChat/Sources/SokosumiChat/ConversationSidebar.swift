import Combine
import CoreAPI
import Foundation

/// Portable room list, selection, and disclosure state. The app composes
/// transcript navigation and authentication around this state.
@MainActor
public final class ConversationSidebar: ObservableObject {
  public enum Section: String, CaseIterable, Sendable {
    case channels, external, directs
  }

  @Published public var rooms: [Components.Schemas.ChatRoom] = []
  @Published public var selectedRoomId: String?
  @Published public var isLoading = false
  @Published public private(set) var errorMessage: String?
  @Published public private(set) var collapsedSections: Set<Section> = []
  private let savedRoom: SavedRoomSelection
  private var generation = 0

  public init(savedRoom: SavedRoomSelection = SavedRoomSelection()) {
    self.savedRoom = savedRoom
  }

  public var partitioned: PartitionedSidebarRooms {
    partitionRoomsForSidebar(rooms)
  }

  public func setExpanded(_ expanded: Bool, section: Section) {
    if expanded {
      collapsedSections.remove(section)
    } else {
      collapsedSections.insert(section)
    }
  }

  public func reset() {
    invalidateRefresh()
    rooms = []
    selectedRoomId = nil
    collapsedSections = []
  }

  /// A workspace transition invalidates any in-flight list response.
  public func invalidateRefresh() {
    generation += 1
    isLoading = false
    errorMessage = nil
  }

  public func select(_ id: String?, userId: String, organizationId: String?) {
    selectedRoomId = id.flatMap { candidate in rooms.contains { $0.id == candidate } ? candidate : nil }
    if let selectedRoomId {
      savedRoom.save(selectedRoomId, userId: userId, organizationId: organizationId)
    }
  }

  public func restoredSelection(userId: String, organizationId: String?) -> String? {
    let current = selectedRoomId.flatMap { id in rooms.contains { $0.id == id } ? id : nil }
    let saved = savedRoom.load(userId: userId, organizationId: organizationId)
      .flatMap { id in rooms.contains { $0.id == id } ? id : nil }
    let sections = partitioned
    return current ?? saved ?? (sections.channels + sections.external + sections.directMessages).first?.id
  }

  /// Refresh commits a complete list. Failed or stale pages never replace
  /// the visible list or selected room; callers handle authentication errors.
  @discardableResult
  public func refresh(client: Client, organizationSlug: String?) async throws -> Bool {
    guard !isLoading else { return false }
    generation += 1
    let attempt = generation
    isLoading = true
    errorMessage = nil
    defer {
      if generation == attempt {
        isLoading = false
      }
    }
    do {
      let loaded = try await ChatService().listRooms(client: client, organizationSlug: organizationSlug)
      guard generation == attempt, !Task.isCancelled else { return false }
      rooms = loaded
      return true
    } catch {
      guard generation == attempt, !Task.isCancelled else { return false }
      errorMessage = friendlyMessage(for: error)
      throw error
    }
  }
}
