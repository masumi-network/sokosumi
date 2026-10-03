import Combine
import CoreAPI
import Foundation
@testable import SokosumiChat
import Testing

/// Row 07e: web's `use-open-room-unread-recheck.test.ts`, case for case, plus the signal and the coalesced watch.
@MainActor
struct OpenRoomUnreadRecheckTests {
  private static let roomId = "550e8400-e29b-41d4-a716-446655440070"
  private static let changedAt = Date(timeIntervalSince1970: 1_790_000_000)

  private static func room(
    _ channelUnread: Int?, id: String = roomId, updatedAt: Date = changedAt
  ) -> Components.Schemas.ChatRoom {
    .init(
      id: id, name: "general", kind: .channel, isSelfDirect: false, isGroupDirect: false, isReadOnly: false,
      discoverability: ._public, createdByUserId: "user_1", createdAt: changedAt, updatedAt: updatedAt,
      unreadCount: channelUnread ?? 0, channelUnreadCount: channelUnread, unreadMentionCount: 0, markedUnread: false,
      myAccess: .init(value1: .member, value2: "member"), userMembers: [], formerUserMembers: [], coworkerMembers: [],
      sokoBotMembers: []
    )
  }

  private static func signal(_ channelUnread: Int?, updatedAt: Date = changedAt) -> OpenRoomUnreadRecheck.Signal? {
    .init(room: room(channelUnread, updatedAt: updatedAt), historyLoading: false)
  }

  /// Web "reads once when the open room stays unread": nothing before the delay, one read at it, none after.
  @Test func readsOnceWhenTheOpenRoomStaysUnread() async {
    let clock = RecheckClock()
    let recheck = OpenRoomUnreadRecheck(sleep: clock.sleep)
    var requests = 0
    recheck.update(Self.signal(1)) { requests += 1 }
    await waitUntil { clock.pending == 1 }
    #expect(clock.intervals == [OpenRoomUnreadRecheck.delay])
    #expect(OpenRoomUnreadRecheck.delay == .seconds(4), "Web's OPEN_ROOM_UNREAD_RECHECK_MS.")
    #expect(requests == 0)
    clock.fireAll()
    await waitUntil { requests == 1 }
    recheck.update(Self.signal(1)) { requests += 1 }
    await settle()
    clock.fireAll()
    await settle()
    #expect(requests == 1)
    #expect(clock.intervals.count == 1, "The same signal does not wait again.")
  }

  /// Web "does nothing when read attention clears the count in time".
  @Test func doesNothingWhenReadAttentionClearsTheCountInTime() async {
    let clock = RecheckClock()
    let recheck = OpenRoomUnreadRecheck(sleep: clock.sleep)
    var requests = 0
    recheck.update(Self.signal(1)) { requests += 1 }
    await waitUntil { clock.pending == 1 }
    recheck.update(Self.signal(0)) { requests += 1 }
    clock.fireAll()
    await settle()
    #expect(requests == 0)
    #expect(clock.intervals.count == 1)
  }

  /// Web "checks again for a newer unread message".
  @Test func checksAgainForANewerUnreadMessage() async {
    let clock = RecheckClock()
    let recheck = OpenRoomUnreadRecheck(sleep: clock.sleep)
    var requests = 0
    recheck.update(Self.signal(1)) { requests += 1 }
    await waitUntil { clock.pending == 1 }
    clock.fireAll()
    await waitUntil { requests == 1 }
    recheck.update(Self.signal(2, updatedAt: Self.changedAt.addingTimeInterval(60))) { requests += 1 }
    await waitUntil { clock.pending == 1 }
    clock.fireAll()
    await waitUntil { requests == 2 }
    #expect(clock.intervals == [.seconds(4), .seconds(4)])
  }

  /// Web "waits while history is still loading": no signal, so no wait.
  @Test func waitsWhileHistoryIsStillLoading() async {
    let clock = RecheckClock()
    let recheck = OpenRoomUnreadRecheck(sleep: clock.sleep)
    var requests = 0
    let loading = OpenRoomUnreadRecheck.Signal(room: Self.room(1), historyLoading: true)
    #expect(loading == nil)
    recheck.update(loading) { requests += 1 }
    await settle()
    #expect(clock.intervals.isEmpty && requests == 0)
  }

  /// A newer change restarts the wait instead of reading at the first one's deadline (web's effect cleanup).
  @Test func aChangeWhileWaitingRestartsTheWait() async {
    let clock = RecheckClock()
    let recheck = OpenRoomUnreadRecheck(sleep: clock.sleep)
    var requests = 0
    recheck.update(Self.signal(1)) { requests += 1 }
    await waitUntil { clock.pending == 1 }
    recheck.update(Self.signal(2, updatedAt: Self.changedAt.addingTimeInterval(1))) { requests += 1 }
    await waitUntil { clock.pending == 2 }
    clock.fireAll()
    await waitUntil { requests == 1 }
    await settle()
    #expect(requests == 1, "Only the newer wait reads.")
  }

  /// Web's signal: the room id, its Room unread (`channelUnreadCount ?? 0`, never the total) and its `updatedAt`.
  @Test func theSignalIsTheRoomItsRoomUnreadAndItsUpdate() throws {
    #expect(OpenRoomUnreadRecheck.Signal(room: nil, historyLoading: false) == nil)
    #expect(Self.signal(0) == nil)
    var threadsOnly = Self.room(nil)
    threadsOnly.unreadCount = 3
    threadsOnly.threadUnreadCount = 3
    #expect(OpenRoomUnreadRecheck.Signal(room: threadsOnly, historyLoading: false) == nil,
            "Thread replies alone, or a payload without the Room half, ask for nothing.")
    let signal = try #require(Self.signal(2))
    #expect(signal.roomId == Self.roomId && signal.unreadCount == 2 && signal.updatedAt == Self.changedAt)
    #expect(Self.signal(2, updatedAt: Self.changedAt.addingTimeInterval(1)) != signal)
    #expect(OpenRoomUnreadRecheck.Signal(room: Self.room(2, id: "550e8400-e29b-41d4-a716-446655440071"), historyLoading: false) != signal)
  }

  /// Every change in one turn is read once, after it has landed: the publisher announces a change before it happens.
  @Test func watchReadsTheSignalOnceAfterABurstOfChanges() async {
    let clock = RecheckClock()
    let recheck = OpenRoomUnreadRecheck(sleep: clock.sleep)
    let changes = PassthroughSubject<Void, Never>()
    let room = WatchedRoom()
    recheck.watch(changes, signal: {
      room.reads += 1
      return Self.signal(room.unread)
    }, request: { room.requests += 1 })
    changes.send()
    room.unread = 1
    changes.send()
    changes.send()
    await waitUntil { clock.pending == 1 }
    #expect(room.reads == 1)
    clock.fireAll()
    await waitUntil { room.requests == 1 }
  }

  private func waitUntil(_ condition: () -> Bool) async {
    for _ in 0 ..< 1000 {
      if condition() {
        return
      }
      await Task.yield()
    }
    #expect(condition(), "Scheduled work did not complete")
  }

  private func settle() async {
    for _ in 0 ..< 50 {
      await Task.yield()
    }
  }
}

/// What `watch` sees and does: the room's count, how often the signal was read, how often a read was asked for.
@MainActor
private final class WatchedRoom {
  var unread = 0
  var reads = 0
  var requests = 0
}

/// Records each wait and holds it until the test fires it, so no test depends on wall time.
@MainActor
private final class RecheckClock {
  var intervals: [Duration] = []
  private var waiting: [CheckedContinuation<Void, Never>] = []

  var pending: Int {
    waiting.count
  }

  func sleep(_ duration: Duration) async throws {
    intervals.append(duration)
    await withCheckedContinuation { waiting.append($0) }
  }

  func fireAll() {
    let callbacks = waiting
    waiting = []
    for callback in callbacks {
      callback.resume()
    }
  }
}
