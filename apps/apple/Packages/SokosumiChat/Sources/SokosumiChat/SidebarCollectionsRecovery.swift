import Foundation

/// One sidebar collection Core can name as stale in `chat_rooms_changed` (`@sokosumi/utils` `CHAT_ROOM_COLLECTIONS`):
/// the live room list, the Archived section and the pending invitations.
public enum ChatRoomCollection: String, CaseIterable, Sendable {
  case active, archived, invitations
}

/// The sidebar's collections, each recovered by its own `ChatRefreshScheduler` (web `use-organization-chat-rooms.ts`,
/// SOK-986): a request reads exactly the collections it names, and one collection's read never waits on or repeats
/// another's. A collection that was not started ignores requests, as web runs no Archived reader in a personal workspace.
@MainActor
public final class SidebarCollectionsRecovery {
  private let schedulers: [ChatRoomCollection: ChatRefreshScheduler]

  public var isRefreshing: Bool {
    schedulers.values.contains(where: \.isRefreshing)
  }

  public init(sleep: @escaping (Duration) async throws -> Void = { try await Task.sleep(for: $0) }) {
    schedulers = Dictionary(uniqueKeysWithValues: ChatRoomCollection.allCases.map { ($0, ChatRefreshScheduler(sleep: sleep)) })
  }

  /// Web's cadence for every collection: 60 s while realtime is healthy, 15 s while it is not, and one read when it
  /// recovers. The first read is the caller's (the workspace load and the sidebar's own load), not a timer's.
  public func start(
    _ collections: Set<ChatRoomCollection>,
    foreground: Bool,
    healthy: Bool,
    refresh: @escaping (ChatRoomCollection) async -> Void
  ) {
    stop()
    for collection in collections {
      schedulers[collection]?.start(foreground: foreground, healthy: healthy, fallbackInterval: .seconds(15),
                                    refreshOnRecovery: true) { await refresh(collection) }
    }
  }

  /// `chat_rooms_changed` and foreign-room activity: read the named collections and no others.
  public func requestRefresh(_ collections: Set<ChatRoomCollection>) {
    for collection in ChatRoomCollection.allCases where collections.contains(collection) {
      schedulers[collection]?.requestRefresh()
    }
  }

  public func setForeground(_ value: Bool) {
    for scheduler in schedulers.values {
      scheduler.setForeground(value)
    }
  }

  public func setHealthy(_ value: Bool) {
    for scheduler in schedulers.values {
      scheduler.setHealthy(value)
    }
  }

  public func stop() {
    for scheduler in schedulers.values {
      scheduler.stop()
    }
  }
}
