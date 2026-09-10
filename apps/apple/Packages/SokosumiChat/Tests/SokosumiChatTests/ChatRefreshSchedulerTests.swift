import Foundation
@testable import SokosumiChat
import Testing

@MainActor
struct ChatRefreshSchedulerTests {
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

  @Test func queuedReadDefersIfWindowBecomesHidden() async {
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
    scheduler.requestRefresh()
    scheduler.setForeground(false)
    finish?.resume()
    await Task.yield()
    #expect(reads == 1)
    scheduler.setForeground(true)
    await waitUntil { reads == 2 && clock.intervals.count == 1 }
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

  @Test func backgroundNeedsCollapseOnForegroundReturn() async {
    let clock = RefreshClock()
    let scheduler = ChatRefreshScheduler(sleep: clock.sleep)
    var reads = 0
    scheduler.start(foreground: false, healthy: false) { reads += 1 }
    await waitUntil { clock.intervals.count == 1 }
    clock.fireAll()
    scheduler.requestRefresh()
    scheduler.requestRefresh()
    await Task.yield()
    #expect(reads == 0)
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
