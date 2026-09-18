import Combine
import CoreAPI
import Foundation

public enum ChannelLifecycleAction: Sendable {
  case leave, archive, restore, delete
}

/// One lifecycle request at a time, per workspace.
public struct ChannelLifecycleRequest: Equatable, Sendable {
  public let roomId: String
  public let action: ChannelLifecycleAction

  public init(roomId: String, action: ChannelLifecycleAction) {
    self.roomId = roomId
    self.action = action
  }
}

public extension ChannelEditPermissions {
  /// Web `rooms-client.tsx`: archiving shares the owner/admin settings gate.
  var canArchive: Bool {
    canManageSettings
  }

  /// Web `rooms-client.tsx` / `chat-room-sidebar-row.tsx`: guests and matched channels may always leave;
  /// a host-org channel keeps its last host member so the roster cannot empty before an archive.
  static func canLeave(_ room: Components.Schemas.ChatRoom) -> Bool {
    guard room.kind == .channel else { return false }
    return room.myAccess == .guest || room.discoverability == .matched
      || room.userMembers.count(where: { $0.access?.value1 == .member }) > 1
  }
}

public struct ArchivedChannelList: Sendable {
  public let rooms: [Components.Schemas.ChatRoom]
  public let canDelete: Bool

  public init(rooms: [Components.Schemas.ChatRoom], canDelete: Bool) {
    self.rooms = rooms
    self.canDelete = canDelete
  }
}

/// Web `organization-chat-list.client.tsx` Archived section: name-sorted archived channels, Delete for owners/admins.
/// Loads fail soft (the previous list stays); local archive/restore/delete edits invalidate an in-flight load.
@MainActor
public final class ArchivedChannels: ObservableObject {
  @Published public private(set) var rooms: [Components.Schemas.ChatRoom] = []
  @Published public private(set) var canDelete = false
  private var generation = 0

  public init() {}

  public func load(using fetch: () async throws -> ArchivedChannelList) async {
    generation += 1
    let attempt = generation
    guard let list = try? await fetch(), attempt == generation, !Task.isCancelled else { return }
    rooms = Self.sorted(list.rooms)
    canDelete = list.canDelete
  }

  public func reset() {
    generation += 1
    rooms = []
    canDelete = false
  }

  public func insert(_ room: Components.Schemas.ChatRoom) {
    generation += 1
    rooms = Self.sorted(rooms.filter { $0.id != room.id } + [room])
  }

  public func remove(roomId: String) {
    generation += 1
    rooms.removeAll { $0.id == roomId }
  }

  private static func sorted(_ rooms: [Components.Schemas.ChatRoom]) -> [Components.Schemas.ChatRoom] {
    rooms.sorted { $0.name.compare($1.name, options: [.caseInsensitive, .diacriticInsensitive], locale: .current) == .orderedAscending }
  }
}
