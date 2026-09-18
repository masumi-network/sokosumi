import Combine
import CoreAPI
import Foundation

/// Portable room list, selection, and disclosure state. The app composes
/// transcript navigation and authentication around this state.
@MainActor
public final class ConversationSidebar: ObservableObject {
  public enum Section: String, CaseIterable, Sendable {
    case pinned, channels, external, archived, directs

    /// Web opens every section except Archived.
    static let initiallyCollapsed: Set<Section> = [.archived]
  }

  public enum Action: Sendable {
    case pin, unpin, mute, unmute, markUnread

    var dateField: WritableKeyPath<Components.Schemas.ChatRoom, Date?>? {
      switch self {
      case .pin, .unpin: \.starredAt
      case .mute, .unmute: \.mutedAt
      case .markUnread: nil
      }
    }
  }

  private struct PendingAction {
    let token: UUID
    let action: Action
    let previousDate: Date?
    let optimisticDate: Date?
  }

  @Published private var pendingActions: [String: PendingAction] = [:]
  @Published public private(set) var actionError: String?
  @Published public var rooms: [Components.Schemas.ChatRoom] = [] {
    didSet { endPinnedReorderModeIfUnavailable() }
  }

  /// The reader asked to reorder Pinned. Ends with the change that makes reordering unavailable, so it
  /// cannot come back by itself the next time a second room is pinned.
  @Published public private(set) var pinnedReorderMode = false
  @Published public var selectedRoomId: String?
  @Published public var isLoading = false
  @Published public private(set) var errorMessage: String?
  @Published public private(set) var collapsedSections = Section.initiallyCollapsed
  public let readAttention = RoomReadAttention()
  private let savedRoom: SavedRoomSelection
  private var generation = 0
  private var refreshInFlight = false
  private var reorderRequest = 0
  /// Sort keys of the newest reorder Core has not answered yet; a list read meanwhile keeps them.
  private var pendingPinnedOrder: [String: Date] = [:]

  public init(savedRoom: SavedRoomSelection = SavedRoomSelection()) {
    self.savedRoom = savedRoom
  }

  public var partitioned: PartitionedSidebarRooms {
    partitionRoomsForSidebar(readAttention.applying(to: rooms))
  }

  public func setExpanded(_ expanded: Bool, section: Section) {
    if expanded {
      collapsedSections.remove(section)
    } else {
      collapsedSections.insert(section)
    }
    endPinnedReorderModeIfUnavailable()
  }

  /// Web's `canReorderPinned`: the section is open and holds at least two rooms.
  public var canReorderPinned: Bool {
    !collapsedSections.contains(.pinned) && rooms.count { $0.starredAt != nil } > 1
  }

  public func setPinnedReorderMode(_ enabled: Bool) {
    pinnedReorderMode = enabled && canReorderPinned
  }

  private func endPinnedReorderModeIfUnavailable() {
    if pinnedReorderMode, !canReorderPinned {
      pinnedReorderMode = false
    }
  }

  public func reset() {
    invalidateRequests()
    readAttention.reset()
    rooms = []
    selectedRoomId = nil
    collapsedSections = Section.initiallyCollapsed
  }

  /// Workspace reset rolls back optimistic pin/mute so a stale HTTP
  /// completion cannot commit on a later workspace.
  public func invalidateRequests() {
    for (id, pending) in pendingActions {
      patchDate(roomId: id, action: pending.action, date: pending.previousDate)
    }
    dropPendingActions()
    invalidateRefresh()
  }

  /// A workspace transition invalidates any in-flight list response.
  /// Pending pin/mute stay until a successful switch or an explicit rollback.
  public func invalidateRefresh() {
    invalidateListResponse()
    isLoading = false
    errorMessage = nil
  }

  /// Successful workspace switch: drop tokens so completions cannot patch the new list.
  public func dropPendingActions() {
    reorderRequest += 1
    pendingPinnedOrder = [:]
    pinnedReorderMode = false
    pendingActions = [:]
    actionError = nil
  }

  /// Membership revoke of this room. Other in-flight pin/mute stay.
  public func rollbackPendingAction(roomId: String) {
    guard let pending = pendingActions.removeValue(forKey: roomId) else { return }
    patchDate(roomId: roomId, action: pending.action, date: pending.previousDate)
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
    return current ?? saved ?? (sections.pinned + sections.channels + sections.external + sections.directMessages).first?.id
  }

  /// Refresh commits a complete list. Failed or stale pages never replace
  /// the visible list or selected room; callers handle authentication errors.
  @discardableResult
  public func refresh(client: Client, organizationSlug: String?) async throws -> Bool {
    guard !isLoading else { return false }
    generation += 1
    let attempt = generation
    let attentionRevision = readAttention.beginRefresh()
    isLoading = true
    refreshInFlight = true
    errorMessage = nil
    defer {
      if generation == attempt {
        refreshInFlight = false
        isLoading = false
      }
    }
    do {
      let loaded = try await ChatService().listRooms(client: client, organizationSlug: organizationSlug)
      guard generation == attempt, !Task.isCancelled else { return false }
      rooms = readAttention.reconcile(loaded, requestRevision: attentionRevision).map { room in
        var room = room
        if let pending = pendingActions[room.id], let field = pending.action.dateField {
          room[keyPath: field] = pending.optimisticDate
        }
        // A room unpinned meanwhile stays unpinned.
        if room.starredAt != nil, let starredAt = pendingPinnedOrder[room.id] {
          room.starredAt = starredAt
        }
        return room
      }
      return true
    } catch {
      guard generation == attempt, !Task.isCancelled else { return false }
      errorMessage = friendlyMessage(for: error)
      throw error
    }
  }

  public func clearActionError() {
    actionError = nil
  }

  public func isPending(roomId: String) -> Bool {
    pendingActions[roomId] != nil
  }

  public func canPerform(_ action: Action, roomId: String) -> Bool {
    guard !isPending(roomId: roomId), let room = rooms.first(where: { $0.id == roomId }) else { return false }
    switch action {
    case .pin: return room.starredAt == nil && room.mutedAt == nil
    case .unpin: return room.starredAt != nil && room.mutedAt == nil
    case .mute: return room.mutedAt == nil && room.starredAt == nil
    case .unmute: return room.mutedAt != nil && room.starredAt == nil
    case .markUnread: return room.id != selectedRoomId && room.mutedAt == nil
    }
  }

  public func perform(_ action: Action, roomId: String, client: Client, organizationSlug: String?) async throws {
    guard canPerform(action, roomId: roomId), let room = rooms.first(where: { $0.id == roomId }) else { return }
    let token = UUID()
    let previousDate = action.dateField.flatMap { room[keyPath: $0] }
    let optimisticDate: Date? = action == .pin || action == .mute ? Date() : nil
    pendingActions[roomId] = PendingAction(token: token, action: action, previousDate: previousDate, optimisticDate: optimisticDate)
    actionError = nil
    patchDate(roomId: roomId, action: action, date: optimisticDate)
    defer {
      if pendingActions[roomId]?.token == token {
        pendingActions[roomId] = nil
        // A list requested before this action settled may contain its old flags.
        invalidateListResponse()
      }
    }
    do {
      let resultDate = try await performRequest(action, room: room, client: client, organizationSlug: organizationSlug)
      guard pendingActions[roomId]?.token == token else { return }
      // Preserve newer attention, membership and room details from realtime.
      patchDate(roomId: roomId, action: action, date: resultDate)
    } catch {
      guard pendingActions[roomId]?.token == token else { return }
      patchDate(roomId: roomId, action: action, date: previousDate)
      guard !Task.isCancelled else { return }
      if action != .markUnread {
        actionError = friendlyMessage(for: error)
      }
      throw error
    }
  }

  /// Web's `handleReorderPinned`: the order shows at once, the latest reorder wins, and a failure of the
  /// latest one throws so the coordinator reloads the list, because an earlier overlapping reorder may
  /// have landed and no local snapshot is safe to put back.
  public func reorderPinned(_ roomIds: [String], client: Client, organizationSlug: String?) async throws {
    reorderRequest += 1
    let request = reorderRequest
    // Local sort keys, one millisecond apart and all in the past like Core's, so a room pinned right
    // after still lands at the end.
    let base = Date().addingTimeInterval(-Double(roomIds.count) / 1000)
    pendingPinnedOrder = Dictionary(
      roomIds.enumerated().map { ($1, base.addingTimeInterval(Double($0) / 1000)) }, uniquingKeysWith: { first, _ in first }
    )
    actionError = nil
    // A list read already in flight predates this order.
    invalidateListResponse()
    applyPinnedOrder(pendingPinnedOrder)
    do {
      let order = try await ChatService().reorderPinnedRooms(client: client, roomIds: roomIds, organizationSlug: organizationSlug)
      // A newer reorder, or another workspace, owns the list now.
      guard request == reorderRequest else { return }
      pendingPinnedOrder = [:]
      // A list requested before Core answered may still carry the old order.
      invalidateListResponse()
      applyPinnedOrder(Dictionary(order.map { ($0.roomId, $0.starredAt) }, uniquingKeysWith: { first, _ in first }))
    } catch {
      guard request == reorderRequest else { return }
      pendingPinnedOrder = [:]
      guard !Task.isCancelled else { return }
      actionError = friendlyMessage(for: error)
      throw error
    }
  }

  /// Pin and unpin own their room's `starredAt` while they run.
  private func applyPinnedOrder(_ starredAtByRoomId: [String: Date]) {
    var next = rooms
    for index in next.indices where next[index].starredAt != nil && pendingActions[next[index].id] == nil {
      if let starredAt = starredAtByRoomId[next[index].id] {
        next[index].starredAt = starredAt
      }
    }
    rooms = next
  }

  private func performRequest(
    _ action: Action, room: Components.Schemas.ChatRoom, client: Client, organizationSlug: String?
  ) async throws -> Date? {
    let result: Components.Schemas.ChatRoom
    let service = ChatService()
    switch action {
    case .pin: result = try await service.pinRoom(client: client, roomId: room.id, organizationSlug: organizationSlug)
    case .unpin: result = try await service.unpinRoom(client: client, roomId: room.id, organizationSlug: organizationSlug)
    case .mute: result = try await service.muteRoom(client: client, roomId: room.id, organizationSlug: organizationSlug)
    case .unmute: result = try await service.unmuteRoom(client: client, roomId: room.id, organizationSlug: organizationSlug)
    case .markUnread:
      try await readAttention.markUnread(room: room, activeRoomId: selectedRoomId, client: client, organizationSlug: organizationSlug)
      return nil
    }
    return action.dateField.flatMap { result[keyPath: $0] }
  }

  private func invalidateListResponse() {
    generation += 1
    // The coordinator also uses isLoading for workspace switches. An action
    // may finish during a switch; only clear loading owned by a list refresh.
    if refreshInFlight {
      refreshInFlight = false
      isLoading = false
    }
  }

  private func patchDate(roomId: String, action: Action, date: Date?) {
    guard let field = action.dateField, let index = rooms.firstIndex(where: { $0.id == roomId }) else { return }
    rooms[index][keyPath: field] = date
  }
}
