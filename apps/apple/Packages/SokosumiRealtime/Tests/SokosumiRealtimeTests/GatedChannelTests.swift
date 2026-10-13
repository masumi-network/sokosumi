import Foundation
@testable import SokosumiRealtime
import Testing

/// A socket that never connects: the test reconnects it and answers each token mint.
private final class FakeHost: GatedChannelHost, @unchecked Sendable {
  private let lock = NSLock()
  private var mints: [@Sendable (String?, Bool) -> Void] = []
  private var connected: (@Sendable () -> Void)?
  var canAuthorize = true

  var mintCount: Int {
    lock.withLock { mints.count }
  }

  var isListening: Bool {
    lock.withLock { connected != nil }
  }

  func onConnected(_ handler: @escaping @Sendable () -> Void) -> AnyObject? {
    lock.withLock { connected = handler }
    return NSObject()
  }

  func removeListener(_: AnyObject) {
    lock.withLock { connected = nil }
  }

  func authorize(_ completion: @escaping @Sendable (String?, Bool) -> Void) {
    lock.withLock { mints.append(completion) }
  }

  func reconnect() {
    lock.withLock { connected }?()
  }

  /// Answers mint `index`: a token granting `target`, one granting nothing, or a failed mint.
  func answer(_ index: Int, granting target: String?, failed: Bool = false) {
    let mint = lock.withLock { mints[index] }
    mint(target.map { "grant:\($0)" }, failed)
  }
}

/// Records what the engine asks of its channel.
private final class RecordingPolicy: GatedChannelPolicy, @unchecked Sendable {
  private let lock = NSLock()
  private var recorded: [String] = []

  var events: [String] {
    lock.withLock { recorded }
  }

  func grant(in capability: String?, target: String) -> String? {
    capability == "grant:\(target)" ? "granted" : nil
  }

  func attach(_ target: String, grant _: String) {
    lock.withLock { recorded.append("attach \(target)") }
  }

  func denied(_ target: String) {
    lock.withLock { recorded.append("denied \(target)") }
  }

  func detach() {
    lock.withLock { recorded.append("detach") }
  }
}

private final class Ran: @unchecked Sendable {
  private let lock = NSLock()
  private var recorded: [String] = []

  var values: [String] {
    lock.withLock { recorded }
  }

  func append(_ value: String) {
    lock.withLock { recorded.append(value) }
  }
}

/// A retry clock the test fires.
private final class ManualSleep: @unchecked Sendable {
  private let lock = NSLock()
  private var waiters: [CheckedContinuation<Void, Never>] = []

  var pending: Int {
    lock.withLock { waiters.count }
  }

  func sleep(_: Duration) async throws {
    await withCheckedContinuation { continuation in
      lock.withLock { waiters.append(continuation) }
    }
  }

  func fire() {
    lock.withLock { waiters.isEmpty ? nil : waiters.removeFirst() }?.resume()
  }
}

/// The capability-gated lifecycle presence and typing share (ADR 0003, ADR 0033), on a fake socket: one mint at a
/// time, stale answers dropped, reconnects re-authorizing, and a failed mint retried on the engine's clock.
struct GatedChannelTests {
  private let host = FakeHost()
  private let policy = RecordingPolicy()
  private let clock = ManualSleep()
  private let engine: GatedChannel<RecordingPolicy>

  init() {
    engine = GatedChannel(queue: DispatchQueue(label: "test.gated-channel"), host: host, policy: policy, sleep: clock.sleep)
  }

  /// Everything the engine queued so far has run.
  private func settle() {
    engine.queue.sync {}
  }

  private func waitFor(_ condition: () -> Bool) async {
    for _ in 0 ..< 1000 where !condition() {
      settle()
      await Task.yield()
    }
  }

  @Test func aGrantedTokenAttachesTheTarget() {
    engine.setTarget("a")
    settle()
    #expect(host.mintCount == 1)
    host.answer(0, granting: "a")
    settle()
    #expect(policy.events == ["detach", "attach a"])
  }

  @Test func aReconnectDuringAMintRunsOneMoreAfterIt() {
    engine.setTarget("a")
    settle()
    host.reconnect()
    host.reconnect()
    settle()
    #expect(host.mintCount == 1, "One mint at a time.")
    host.answer(0, granting: "a")
    settle()
    #expect(host.mintCount == 2, "The reconnects queued exactly one more.")
    host.answer(1, granting: "a")
    settle()
    #expect(policy.events == ["detach", "attach a", "attach a"])
  }

  @Test func anAnswerForAnEarlierTargetIsDropped() {
    engine.setTarget("a")
    settle()
    engine.setTarget("b")
    settle()
    host.answer(0, granting: "a")
    settle()
    #expect(policy.events == ["detach", "detach"], "The token minted for a attaches nothing.")
    #expect(host.mintCount == 2)
    host.answer(1, granting: "b")
    settle()
    #expect(policy.events.last == "attach b")
  }

  @Test func aMissingGrantStaysOffUntilTheNextConnection() {
    engine.setTarget("a")
    settle()
    host.answer(0, granting: nil)
    settle()
    #expect(policy.events.last == "denied a")
    #expect(clock.pending == 0, "Nothing retries a token that simply lacks the grant.")
    host.reconnect()
    settle()
    #expect(host.mintCount == 2)
  }

  @Test func aFailedMintRetriesAfterTheDelay() async {
    engine.setTarget("a")
    settle()
    host.answer(0, granting: nil, failed: true)
    settle()
    #expect(policy.events.last == "denied a")
    await waitFor { clock.pending == 1 }
    #expect(host.mintCount == 1, "The retry waits for its delay.")
    clock.fire()
    await waitFor { host.mintCount == 2 }
    #expect(host.mintCount == 2)
    host.answer(1, granting: "a")
    settle()
    #expect(policy.events.last == "attach a")
  }

  @Test func aMintAnsweredAfterStopAttachesNothing() {
    engine.setTarget("a")
    settle()
    #expect(host.mintCount == 1)
    engine.stop()
    host.answer(0, granting: "a")
    settle()
    #expect(policy.events == ["detach", "detach"], "The answer lands on a stopped channel.")
  }

  @Test func stopCancelsTheRetry() async {
    engine.setTarget("a")
    settle()
    host.answer(0, granting: nil, failed: true)
    await waitFor { clock.pending == 1 }
    engine.stop()
    #expect(!host.isListening)
    clock.fire()
    host.reconnect()
    for _ in 0 ..< 20 {
      await Task.yield()
    }
    settle()
    #expect(host.mintCount == 1, "A stopped channel mints nothing more.")
    #expect(policy.events.last == "detach")
  }

  @Test func aClosingSocketMintsNothing() {
    host.canAuthorize = false
    engine.setTarget("a")
    settle()
    #expect(host.mintCount == 0)
  }

  @Test func onlyAGrantedChannelRunsItsWork() {
    let ran = Ran()
    engine.setTarget("a")
    engine.withGrant { ran.append("\($0) \($1)") }
    settle()
    host.answer(0, granting: "a")
    engine.withGrant { ran.append("\($0) \($1)") }
    settle()
    #expect(ran.values == ["a granted"])
  }
}
