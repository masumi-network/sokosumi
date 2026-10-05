import Combine
import CoreAPI
import Foundation

/// Web's `useOpenRoomUnreadRecheck` (row 07e): realtime can miss a message (an id envelope whose read the shared
/// cooldown held, an event a reattach dropped). The room list still counts it unread for the open room, and read
/// attention never clears it, because it never reaches the transcript. So once the open room's count has held for
/// `delay` after its last change, the room is asked for one explicit read. A newer signal restarts the wait; no
/// signal cancels it; the same signal never asks twice.
@MainActor
public final class OpenRoomUnreadRecheck {
  /// Web's `OPEN_ROOM_UNREAD_RECHECK_MS`: longer than a read-attention write takes to clear the count.
  public static let delay: Duration = .seconds(4)

  /// What the wait follows (web's `signal`): the open room, its Room unread and its last update.
  public struct Signal: Equatable, Sendable {
    public let roomId: String
    public let unreadCount: Int
    public let updatedAt: Date

    /// Nil, which asks for nothing, while no room is open, its first history page is loading, or it counts no Room
    /// unread. Web reads `channelUnreadCount ?? 0`: Thread replies alone never ask (ADR 0037).
    public init?(room: Components.Schemas.ChatRoom?, historyLoading: Bool) {
      guard let room, !historyLoading else { return nil }
      let unread = room.channelUnreadCount ?? 0
      guard unread > 0 else { return nil }
      roomId = room.id
      unreadCount = unread
      updatedAt = room.updatedAt
    }
  }

  private let sleep: (Duration) async throws -> Void
  private var signal: Signal?
  private var timer: Task<Void, Never>?
  private var observation: AnyCancellable?
  private var evaluationQueued = false

  public init(sleep: @escaping (Duration) async throws -> Void = { try await Task.sleep(for: $0) }) {
    self.sleep = sleep
  }

  /// Reads `signal` after each burst of `changes`, once they have landed (an `objectWillChange` fires before the
  /// change), and asks `request` once `delay` after the signal last changed.
  public func watch(
    _ changes: some Publisher<Void, Never>,
    signal: @escaping @MainActor () -> Signal?,
    request: @escaping @MainActor () -> Void
  ) {
    observation = changes.sink { [weak self] in
      guard let self, !evaluationQueued else { return }
      evaluationQueued = true
      Task { @MainActor [weak self] in
        guard let self else { return }
        evaluationQueued = false
        update(signal(), request: request)
      }
    }
  }

  func update(_ next: Signal?, request: @escaping @MainActor () -> Void) {
    guard next != signal else { return }
    signal = next
    timer?.cancel()
    timer = nil
    guard let next else { return }
    timer = Task { [weak self, sleep] in
      do {
        try await sleep(Self.delay)
      } catch { return }
      guard !Task.isCancelled, let self, signal == next else { return }
      timer = nil
      request()
    }
  }
}
