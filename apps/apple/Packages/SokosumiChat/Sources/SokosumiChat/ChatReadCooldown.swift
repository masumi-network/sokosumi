import Foundation

/// One account-lifetime deadline shared by chat HTTP readers. Realtime delivery
/// and writes do not consult this clock. A later 429 can only extend the wait.
public actor ChatReadCooldown {
  private var scope: Int?
  private var deadline = Date.distantPast
  private let now: @Sendable () -> Date
  private let sleep: @Sendable (Duration) async throws -> Void
  private let jitter: @Sendable () -> Double

  public init() {
    now = Date.init
    sleep = { try await Task.sleep(for: $0) }
    jitter = { Double.random(in: 0 ... 0.25) }
  }

  init(now: @escaping @Sendable () -> Date,
       sleep: @escaping @Sendable (Duration) async throws -> Void,
       jitter: @escaping @Sendable () -> Double) {
    self.now = now
    self.sleep = sleep
    self.jitter = jitter
  }

  public func wait(scope expected: Int, currentScope: @Sendable () async -> Int) async throws {
    try Task.checkCancellation()
    guard await currentScope() == expected else { throw CancellationError() }
    if let scope, scope > expected {
      throw CancellationError()
    }
    if scope != expected {
      scope = expected
      deadline = .distantPast
    }
    while deadline > now() {
      let remaining = deadline.timeIntervalSince(now())
      // Chunk very large server delays so Duration conversion cannot overflow.
      // Recheck the deadline after every sleep: another reader may extend it.
      let seconds = min(remaining, 60) * (1 + jitter())
      try await sleep(.seconds(seconds))
      try Task.checkCancellation()
      guard await currentScope() == expected else { throw CancellationError() }
    }
    try Task.checkCancellation()
  }

  public func note(delay: Double?, scope expected: Int) {
    guard scope == expected else { return }
    let delay = delay.flatMap(Self.validDelay) ?? 5
    deadline = max(deadline, now().addingTimeInterval(delay))
  }

  static func validDelay(_ value: Double) -> Double? {
    guard value.isFinite, value > 0 else { return nil }
    return ceil(value)
  }
}
