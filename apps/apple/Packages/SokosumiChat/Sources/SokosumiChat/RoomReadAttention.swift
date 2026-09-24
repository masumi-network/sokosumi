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

  /// What a room holds about what is unread in it (web `RoomReadOverlay`): both halves of `unreadCount`
  /// (ADR 0037), the badge, the mark and the room's unread Threads, which a Look changes as it does the
  /// counts. Bold follows the channel half, so an overlay that kept only the total would re-bold a room it
  /// exists to keep read.
  private struct Fields {
    let snapshot: Components.Schemas.ChatRoom
    init(_ room: Components.Schemas.ChatRoom) {
      snapshot = room
    }

    func applying(to room: Components.Schemas.ChatRoom) -> Components.Schemas.ChatRoom {
      var room = room
      room.unreadCount = snapshot.unreadCount
      room.channelUnreadCount = snapshot.channelUnreadCount
      room.threadUnreadCount = snapshot.threadUnreadCount
      room.unreadMentionCount = snapshot.unreadMentionCount
      room.markedUnread = snapshot.markedUnread
      // A snapshot without the list says nothing about it, so the room's own list stands.
      room.unreadThreadCount = snapshot.unreadThreadCount ?? room.unreadThreadCount
      room.unreadThreadMentionCount = snapshot.unreadThreadMentionCount ?? room.unreadThreadMentionCount
      room.unreadThreads = snapshot.unreadThreads ?? room.unreadThreads
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
      optimistic = roomAttentionAfterRead(optimistic)
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

  /// With a thread open this Looks it first. `threadLooked` runs as soon as a Look reaches Core, whatever
  /// happens to the room read after it (web's `onThreadLooked`), so the Threads trigger re-counts.
  @discardableResult
  public func readIfNeeded(room: Components.Schemas.ChatRoom, content: Content, historyReadable: Bool, client: Client, organizationSlug: String?,
                           threadLooked: () -> Void = {}) async throws -> Bool {
    let next = Marker(roomId: room.id, content: content)
    if marker != next || !historyReadable {
      marker = nil
    }
    guard isVisible, historyReadable, marker != next else { return false }
    marker = next
    let attempt = generation
    let lookError = await lookThread(roomId: room.id, content: content, client: client, organizationSlug: organizationSlug)
    if content.parentMessageId != nil, lookError == nil {
      threadLooked()
    }
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
