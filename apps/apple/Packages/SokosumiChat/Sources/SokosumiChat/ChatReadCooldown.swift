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
      // Jitter the whole window once; chunking must not consume that spread.
      let resumeAt = now().addingTimeInterval(remaining * (1 + jitter()))
      while resumeAt > now() {
        // Bound Duration conversion even for very large server delays.
        try await sleep(.seconds(min(resumeAt.timeIntervalSince(now()), 60)))
        try Task.checkCancellation()
        guard await currentScope() == expected else { throw CancellationError() }
      }
      // Another reader may have extended the shared deadline while we slept.
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
