import Foundation
@testable import SokosumiChat
import Testing

@MainActor
struct ChatRefreshSchedulerTests {
  @Test func stoppingCancelsAReadWaitingForCooldown() async {
    let scheduler = ChatRefreshScheduler()
    var started = false
    var cancelled = false
    scheduler.start(foreground: true, healthy: true, refreshOnMount: true) {
      started = true
      do {
        try await Task.sleep(for: .seconds(300))
      } catch is CancellationError {
        cancelled = true
      } catch {}
    }
    await waitUntil { started }
    scheduler.stop()
    await waitUntil { cancelled }
    #expect(!scheduler.isRefreshing)
  }

  @Test func stopBeforeTaskStartsPreventsRead() async {
    let clock = RefreshClock()
    let scheduler = ChatRefreshScheduler(sleep: clock.sleep)
    var reads = 0
    scheduler.start(foreground: true, healthy: true, refreshOnMount: true) { reads += 1 }
    scheduler.stop()
    await Task.yield()
    #expect(reads == 0)
    #expect(clock.intervals.isEmpty)
  }

  /// Web `use-chat-refresh-scheduler.test.ts` "runs a queued explicit request as soon as the in-flight read finishes,
  /// even while hidden": a queued request stays explicit, and the return finds nothing stale.
  @Test func queuedExplicitRequestRunsWhileHidden() async {
    let clock = RefreshClock()
    let scheduler = ChatRefreshScheduler(sleep: clock.sleep)
    var reads = 0
    var finish: CheckedContinuation<Void, Never>?
    scheduler.start(foreground: true, healthy: true, refreshOnMount: true) {
      reads += 1
      if reads == 1 {
        await withCheckedContinuation { finish = $0 }
      }
    }
    await waitUntil { finish != nil }
    scheduler.setForeground(false)
    scheduler.requestRefresh()
    #expect(reads == 1)
    finish?.resume()
    await waitUntil { reads == 2 && clock.intervals.count == 1 }
    scheduler.setForeground(true)
    await Task.yield()
    #expect(reads == 2)
    scheduler.stop()
    clock.fireAll()
  }

  /// Web "runs an explicit request while hidden/blur": an id envelope, lost continuity or an invalidation reads at
  /// once while no chat window is active, and that read leaves nothing for the return to catch up.
  @Test func explicitRequestReadsWhileHidden() async {
    let clock = RefreshClock()
    let scheduler = ChatRefreshScheduler(sleep: clock.sleep)
    var reads = 0
    scheduler.start(foreground: false, healthy: false) { reads += 1 }
    await waitUntil { clock.intervals.count == 1 }
    scheduler.requestRefresh()
    await waitUntil { reads == 1 && clock.intervals.count == 2 }
    scheduler.setForeground(true)
    await Task.yield()
    #expect(reads == 1)
    scheduler.stop()
    clock.fireAll()
  }

  /// Web "reads once on return when a timer elapsed after an explicit read while away": the explicit read re-arms the
  /// timer, whose elapse while hidden is recorded as a need, not a read.
  @Test func timerAfterHiddenExplicitReadWaitsForReturn() async {
    let clock = RefreshClock()
    let scheduler = ChatRefreshScheduler(sleep: clock.sleep)
    var reads = 0
    scheduler.start(foreground: false, healthy: true) { reads += 1 }
    await waitUntil { clock.intervals.count == 1 }
    scheduler.requestRefresh()
    await waitUntil { reads == 1 && clock.intervals.count == 2 }
    clock.fireAll()
    await Task.yield()
    #expect(reads == 1)
    scheduler.setForeground(true)
    await waitUntil { reads == 2 }
    scheduler.stop()
    clock.fireAll()
  }

  /// Web runs the mount read (`run(true)`) and the recovery read (`requestRef.current()`) as explicit requests.
  @Test func mountAndRecoveryReadsRunWhileHidden() async {
    let clock = RefreshClock()
    let scheduler = ChatRefreshScheduler(sleep: clock.sleep)
    var reads = 0
    scheduler.start(foreground: false, healthy: true, refreshOnMount: true, refreshOnRecovery: true) { reads += 1 }
    await waitUntil { reads == 1 && !scheduler.isRefreshing }
    scheduler.setHealthy(false)
    scheduler.setHealthy(true)
    await waitUntil { reads == 2 }
    scheduler.stop()
    clock.fireAll()
  }

  @Test func cadenceChangesWithHealthAndWaitsForCompletion() async {
    let clock = RefreshClock()
    let scheduler = ChatRefreshScheduler(sleep: clock.sleep)
    var reads = 0
    var finish: CheckedContinuation<Void, Never>?
    scheduler.start(foreground: true, healthy: true) {
      reads += 1
      await withCheckedContinuation { finish = $0 }
    }
    await waitUntil { clock.intervals.count == 1 }
    #expect(clock.intervals == [.seconds(60)])
    scheduler.setHealthy(false)
    await waitUntil { clock.intervals.count == 2 }
    #expect(clock.intervals.last == .seconds(3))
    clock.fireAll()
    await waitUntil { reads == 1 && finish != nil }
    #expect(clock.intervals.count == 2)
    finish?.resume()
    await waitUntil { clock.intervals.count == 3 }
    #expect(clock.intervals.last == .seconds(3))
    scheduler.stop()
    clock.fireAll()
  }

  /// Web "starts no timer read while hidden and reads once on return".
  @Test func backgroundTimerNeedCollapsesOnForegroundReturn() async {
    let clock = RefreshClock()
    let scheduler = ChatRefreshScheduler(sleep: clock.sleep)
    var reads = 0
    scheduler.start(foreground: false, healthy: false) { reads += 1 }
    await waitUntil { clock.intervals.count == 1 }
    clock.fireAll()
    await Task.yield()
    #expect(reads == 0)
    #expect(clock.intervals.count == 1)
    scheduler.setForeground(true)
    scheduler.setForeground(true)
    await waitUntil { reads == 1 && clock.intervals.count == 2 }
    scheduler.setForeground(false)
    scheduler.setForeground(true)
    await Task.yield()
    #expect(reads == 1)
    scheduler.stop()
    clock.fireAll()
  }

  @Test func concurrentNeedsQueueOnlyOneFollowUp() async {
    let clock = RefreshClock()
    let scheduler = ChatRefreshScheduler(sleep: clock.sleep)
    var reads = 0
    var finish: CheckedContinuation<Void, Never>?
    scheduler.start(foreground: true, healthy: true, refreshOnMount: true) {
      reads += 1
      await withCheckedContinuation { finish = $0 }
    }
    await waitUntil { finish != nil }
    for _ in 0 ..< 10 {
      scheduler.requestRefresh()
    }
    #expect(reads == 1)
    finish?.resume()
    finish = nil
    await waitUntil { reads == 2 && finish != nil }
    #expect(clock.intervals.isEmpty)
    finish?.resume()
    await waitUntil { clock.intervals.count == 1 }
    #expect(reads == 2)
    scheduler.stop()
    clock.fireAll()
  }

  @Test func oldCompletionCannotScheduleForNewRoom() async {
    let clock = RefreshClock()
    let scheduler = ChatRefreshScheduler(sleep: clock.sleep)
    var oldFinish: CheckedContinuation<Void, Never>?
    scheduler.start(foreground: true, healthy: true, refreshOnMount: true) {
      await withCheckedContinuation { oldFinish = $0 }
    }
    await waitUntil { oldFinish != nil }
    scheduler.requestRefresh()
    var reads = 0
    scheduler.start(foreground: true, healthy: false) { reads += 1 }
    await waitUntil { clock.intervals.count == 1 }
    oldFinish?.resume()
    await Task.yield()
    #expect(reads == 0)
    #expect(clock.intervals.count == 1)
    clock.fireAll()
    await waitUntil { reads == 1 && clock.intervals.count == 2 }
    scheduler.stop()
    clock.fireAll()
  }

  @Test func firstConnectionIsNotRecovery() async {
    let clock = RefreshClock()
    let scheduler = ChatRefreshScheduler(sleep: clock.sleep)
    var reads = 0
    scheduler.start(foreground: true, healthy: false, refreshOnRecovery: true) { reads += 1 }
    scheduler.setHealthy(true)
    await Task.yield()
    #expect(reads == 0)
    scheduler.setHealthy(false)
    scheduler.setHealthy(true)
    await waitUntil { reads == 1 }
    scheduler.stop()
    await Task.yield()
    clock.fireAll()
  }

  /// Web `requestCollections`: an invalidation naming one collection never re-reads the other two.
  @Test func sidebarRequestReadsExactlyTheNamedCollections() async {
    let clock = RefreshClock()
    let recovery = SidebarCollectionsRecovery(sleep: clock.sleep)
    var reads: [ChatRoomCollection] = []
    recovery.start(Set(ChatRoomCollection.allCases), foreground: true, healthy: true) { reads.append($0) }
    recovery.requestRefresh([.archived])
    await waitUntil { reads == [.archived] && !recovery.isRefreshing }
    recovery.requestRefresh([.active, .invitations])
    await waitUntil { reads.count == 3 && !recovery.isRefreshing }
    #expect(reads == [.archived, .active, .invitations])
    recovery.stop()
    clock.fireAll()
  }

  /// A personal workspace starts no Archived reader, so a request for it reads nothing.
  @Test func sidebarCollectionNotStartedIgnoresRequests() async {
    let clock = RefreshClock()
    let recovery = SidebarCollectionsRecovery(sleep: clock.sleep)
    var reads: [ChatRoomCollection] = []
    recovery.start([.active, .invitations], foreground: true, healthy: true) { reads.append($0) }
    await waitUntil { clock.intervals.count == 2 }
    #expect(clock.intervals == [.seconds(60), .seconds(60)])
    recovery.requestRefresh([.archived])
    await Task.yield()
    #expect(reads.isEmpty)
    recovery.requestRefresh([.archived, .invitations])
    await waitUntil { reads == [.invitations] }
    recovery.stop()
    clock.fireAll()
  }

  /// A burst of events while a collection reads queues one follow-up for it and leaves the others alone.
  @Test func sidebarBurstCoalescesPerCollection() async {
    let clock = RefreshClock()
    let recovery = SidebarCollectionsRecovery(sleep: clock.sleep)
    var reads: [ChatRoomCollection] = []
    var finish: CheckedContinuation<Void, Never>?
    recovery.start(Set(ChatRoomCollection.allCases), foreground: true, healthy: true) { collection in
      reads.append(collection)
      if reads.count == 1 {
        await withCheckedContinuation { finish = $0 }
      }
    }
    recovery.requestRefresh([.active])
    await waitUntil { finish != nil }
    recovery.requestRefresh([.active])
    recovery.requestRefresh([.active])
    #expect(reads == [.active])
    finish?.resume()
    await waitUntil { reads == [.active, .active] && !recovery.isRefreshing }
    await Task.yield()
    #expect(reads == [.active, .active])
    recovery.stop()
    clock.fireAll()
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
}

@MainActor
private final class RefreshClock {
  var intervals: [Duration] = []
  private var pending: [CheckedContinuation<Void, Never>] = []

  func sleep(_ duration: Duration) async throws {
    intervals.append(duration)
    await withCheckedContinuation { pending.append($0) }
  }

  func fireAll() {
    let callbacks = pending
    pending = []
    for callback in callbacks {
      callback.resume()
    }
  }
}
