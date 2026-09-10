import Combine
import CoreAPI
import Foundation

/// Visibility-gated room reads and attention overlays shared by native clients.
/// Open-thread attention precedes room reads; Core's residual counters
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

  public struct Content: Equatable, Sendable {
    public let messages: [Message]
    public let parentMessageId: String?
    public let replies: [Message]

    public init(messages: [Message], parentMessageId: String? = nil, replies: [Message] = []) {
      self.messages = messages
      self.parentMessageId = parentMessageId
      self.replies = replies
    }
  }

  private struct Marker: Equatable {
    let roomId: String
    let content: Content
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

  private func begin(_ room: Components.Schemas.ChatRoom, unread: Bool, optimisticRead: Bool = true) -> Int {
    expirePending()
    let previous = overlays[room.id]
    let rollback = previous?.rollback ?? previous?.fields ?? Fields(room)
    var optimistic = room
    if unread {
      optimistic.markedUnread = true
    } else if optimisticRead {
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
  public func readIfNeeded(room: Components.Schemas.ChatRoom, content: Content, historyReadable: Bool, client: Client, organizationSlug: String?) async throws -> Bool {
    let next = Marker(roomId: room.id, content: content)
    if marker != next || !historyReadable {
      marker = nil
    }
    guard isVisible, historyReadable, marker != next else { return false }
    marker = next
    let attempt = generation
    let lookError = await lookThread(roomId: room.id, content: content, client: client, organizationSlug: organizationSlug)
    guard attempt == generation, marker == next, isVisible, !Task.isCancelled else {
      clearMarker(matching: next)
      return false
    }
    do {
      guard try await readRoom(room, optimistic: true, client: client, organizationSlug: organizationSlug) else { return false }
    } catch {
      clearMarker(matching: next)
      throw error
    }
    if let lookError {
      clearMarker(matching: next)
      throw lookError
    }
    return true
  }

  /// Explicit thread opens preserve unread chrome until Core returns its
  /// residual counters. Automatic content attention remains optimistic.
  @discardableResult
  public func readAfterThreadLook(room: Components.Schemas.ChatRoom, client: Client, organizationSlug: String?) async throws -> Bool {
    try await readRoom(room, optimistic: false, client: client, organizationSlug: organizationSlug)
  }

  private func readRoom(_ room: Components.Schemas.ChatRoom, optimistic: Bool, client: Client, organizationSlug: String?) async throws -> Bool {
    guard isVisible, !Task.isCancelled else { return false }
    let attempt = generation
    let token = begin(room, unread: false, optimisticRead: optimistic)
    do {
      let result = try await ChatService().markRoomRead(client: client, roomId: room.id, organizationSlug: organizationSlug)
      guard attempt == generation else { return false }
      settle(roomId: room.id, token: token, result: result)
      return true
    } catch {
      guard attempt == generation, settle(roomId: room.id, token: token, result: nil) else { return false }
      throw error
    }
  }

  private func clearMarker(matching expected: Marker) {
    if marker == expected {
      marker = nil
    }
  }

  private func lookThread(roomId: String, content: Content, client: Client, organizationSlug: String?) async -> Error? {
    guard let parentMessageId = content.parentMessageId else { return nil }
    do {
      _ = try await ChatService().markThreadRead(client: client, roomId: roomId,
                                                 parentMessageId: parentMessageId, organizationSlug: organizationSlug)
      return nil
    } catch {
      return error
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
