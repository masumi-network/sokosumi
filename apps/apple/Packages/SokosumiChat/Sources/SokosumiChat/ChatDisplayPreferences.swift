import Combine
import CoreAPI
import Foundation

/// Account-synced chat display preferences (web Account → Notifications →
/// "Chat display"). One owner for the sidebar rows, the room Threads toolbar
/// count and the Settings toggle. Off until Core answers, like web's unloaded
/// session, so no count flashes that the reader did not ask for.
@MainActor
public final class ChatDisplayPreferences: ObservableObject {
  @Published public private(set) var showsRoomUnreadCount = false
  @Published public private(set) var isSaving = false
  private var generation = 0
  private var refreshGeneration = 0

  public init() {}

  public func reset() {
    generation += 1
    refreshGeneration += 1
    showsRoomUnreadCount = false
    isSaving = false
  }

  /// A refresh that lands during or after a newer write is dropped, so it
  /// cannot overwrite the optimistic value with a stale read.
  public func refresh(client: Client) async throws {
    refreshGeneration += 1
    let request = refreshGeneration
    let value = try await ChatService().showRoomUnreadCount(client: client)
    guard request == refreshGeneration, !isSaving, !Task.isCancelled else { return }
    showsRoomUnreadCount = value
  }

  /// Optimistic write with rollback, web `handleToggle`: the switch flips at
  /// once, a second change waits for the first, and a failure puts the
  /// previous value back before rethrowing.
  public func setShowsRoomUnreadCount(_ enabled: Bool, client: Client) async throws {
    guard !isSaving, enabled != showsRoomUnreadCount else { return }
    let previous = showsRoomUnreadCount
    generation += 1
    refreshGeneration += 1
    let request = generation
    showsRoomUnreadCount = enabled
    isSaving = true
    do {
      let stored = try await ChatService().updateShowRoomUnreadCount(client: client, enabled: enabled)
      guard request == generation else { return }
      showsRoomUnreadCount = stored
      isSaving = false
    } catch {
      guard request == generation else { return }
      showsRoomUnreadCount = previous
      isSaving = false
      throw error
    }
  }
}
