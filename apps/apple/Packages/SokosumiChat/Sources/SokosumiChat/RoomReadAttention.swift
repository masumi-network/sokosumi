import Combine
import CoreAPI
import Foundation

/// Visibility-gated room reads and attention overlays shared by native clients.
/// Thread look writes belong to the thread feature; Core's residual counters
/// are retained verbatim when a room read settles.
@MainActor
public final class RoomReadAttention: ObservableObject {
  public struct Message: Equatable, Sendable {
    public let id: String
    public let content: String
    public init(id: String, content: String) {
      self.id = id
      self.content = content
    }
  }

  private struct Marker: Equatable {
    let roomId: String
    let messages: [Message]
  }

  private struct Fields {
    let unreadCount: Int
    let unreadMentionCount: Int
    let markedUnread: Bool
    init(_ room: Components.Schemas.ChatRoom) {
      unreadCount = room.unreadCount
      unreadMentionCount = room.unreadMentionCount
      markedUnread = room.markedUnread
    }

    func applying(to room: Components.Schemas.ChatRoom) -> Components.Schemas.ChatRoom {
      var room = room
      room.unreadCount = unreadCount
      room.unreadMentionCount = unreadMentionCount
      room.markedUnread = markedUnread
      return room
    }
  }

  private struct Overlay {
    var fields: Fields
    var revision: Int
    var rollback: Fields?
    var expiresAt: Date?
  }

  @Published private var overlays: [String: Overlay] = [:]
  @Published public private(set) var errorMessage: String?
  private var revision = 0
  private var generation = 0
  private var marker: Marker?
  private var visibleWindows: Set<UUID> = []
  private let now: () -> Date

  public init(now: @escaping () -> Date = Date.init) {
    self.now = now
  }

  public var isVisible: Bool {
    !visibleWindows.isEmpty
  }

  public func setVisible(_ visible: Bool, window: UUID) {
    if visible {
      visibleWindows.insert(window)
    } else {
      visibleWindows.remove(window)
    }
  }

  public func reset() {
    generation += 1
    revision += 1
    marker = nil
    overlays = [:]
    errorMessage = nil
  }

  public func clearError() {
    errorMessage = nil
  }

  public func roomChanged() {
    marker = nil
    // A mark-unread failure belongs to the room it targeted; don't let its
    // alert survive navigation.
    errorMessage = nil
  }

  public func applying(to rooms: [Components.Schemas.ChatRoom]) -> [Components.Schemas.ChatRoom] {
    rooms.map { room in overlays[room.id]?.fields.applying(to: room) ?? room }
  }

  public func beginRefresh() -> Int {
    expirePending()
    revision += 1
    return revision
  }

  /// A request started before a read/unread mutation cannot undo it.
  public func reconcile(_ rooms: [Components.Schemas.ChatRoom], requestRevision: Int) -> [Components.Schemas.ChatRoom] {
    expirePending()
    for room in rooms {
      if let overlay = overlays[room.id], overlay.rollback != nil || overlay.revision > requestRevision {
        continue
      }
      overlays[room.id] = Overlay(fields: Fields(room), revision: requestRevision)
    }
    return applying(to: rooms)
  }

  private func expirePending() {
    for (id, overlay) in overlays {
      if let expiry = overlay.expiresAt, expiry <= now(), let rollback = overlay.rollback {
        overlays[id] = Overlay(fields: rollback, revision: overlay.revision)
      }
    }
  }

  private func begin(_ room: Components.Schemas.ChatRoom, unread: Bool) -> Int {
    expirePending()
    let previous = overlays[room.id]
    let rollback = previous?.rollback ?? previous?.fields ?? Fields(room)
    var optimistic = room
    if unread {
      optimistic.markedUnread = true
    } else {
      optimistic.unreadCount = 0
      optimistic.unreadMentionCount = 0
      optimistic.markedUnread = false
    }
    revision += 1
    overlays[room.id] = Overlay(fields: Fields(optimistic), revision: revision, rollback: rollback, expiresAt: now().addingTimeInterval(30))
    errorMessage = nil
    return revision
  }

  @discardableResult
  private func settle(roomId: String, token: Int, result: Components.Schemas.ChatRoom?) -> Bool {
    expirePending()
    guard let overlay = overlays[roomId], overlay.revision == token, let rollback = overlay.rollback else { return false }
    revision += 1
    overlays[roomId] = Overlay(fields: result.map(Fields.init) ?? rollback, revision: revision)
    return true
  }

  @discardableResult
  public func readIfNeeded(room: Components.Schemas.ChatRoom, messages: [Message], historyReadable: Bool, client: Client, organizationSlug: String?) async throws -> Bool {
    guard isVisible, historyReadable else { return false }
    let next = Marker(roomId: room.id, messages: messages)
    guard marker != next else { return false }
    marker = next
    let attempt = generation
    let token = begin(room, unread: false)
    do {
      let result = try await ChatService().markRoomRead(client: client, roomId: room.id, organizationSlug: organizationSlug)
      guard attempt == generation else { return false }
      settle(roomId: room.id, token: token, result: result)
      return true
    } catch {
      guard attempt == generation else { return false }
      guard settle(roomId: room.id, token: token, result: nil) else { return false }
      if marker == next {
        marker = nil
      }
      // Background reads fail silently (web parity: `readRoom` returns
      // false and the reset marker retries on the next change). Only
      // user-initiated mark-unread surfaces `errorMessage`. The error
      // still throws so callers can sign out on 401.
      throw error
    }
  }

  public func markUnread(room: Components.Schemas.ChatRoom, activeRoomId: String?, client: Client, organizationSlug: String?) async throws {
    guard room.id != activeRoomId, room.mutedAt == nil else { return }
    let attempt = generation
    let token = begin(room, unread: true)
    do {
      let result = try await ChatService().markRoomUnread(client: client, roomId: room.id, organizationSlug: organizationSlug)
      guard attempt == generation else { return }
      settle(roomId: room.id, token: token, result: result)
    } catch {
      guard attempt == generation else { return }
      guard settle(roomId: room.id, token: token, result: nil), !Task.isCancelled else { return }
      errorMessage = friendlyMessage(for: error)
      throw error
    }
  }
}
