import Foundation

/// Foreground-only recovery reads for one chat data set. Call `stop` when
/// its room, workspace, or account changes; old completions cannot re-arm it.
@MainActor
public final class ChatRefreshScheduler {
  private let sleep: (Duration) async throws -> Void
  private var refresh: (() async -> Void)?
  private var timer: Task<Void, Never>?
  private var generation = UUID()
  private var inFlight = false
  private var queued = false
  private var needed = false
  private var foreground = false
  private var healthy = false
  private var hadHealthy = false
  private var refreshOnRecovery = false
  private var fallbackInterval: Duration = .seconds(3)

  public var isRefreshing: Bool {
    inFlight
  }

  public init(sleep: @escaping (Duration) async throws -> Void = { try await Task.sleep(for: $0) }) {
    self.sleep = sleep
  }

  public func start(
    foreground: Bool,
    healthy: Bool,
    fallbackInterval: Duration = .seconds(3),
    refreshOnMount: Bool = false,
    refreshOnRecovery: Bool = false,
    refresh: @escaping () async -> Void
  ) {
    stop()
    self.foreground = foreground
    self.healthy = healthy
    hadHealthy = healthy
    self.fallbackInterval = fallbackInterval
    self.refreshOnRecovery = refreshOnRecovery
    self.refresh = refresh
    if refreshOnMount {
      requestRefresh()
    } else {
      schedule()
    }
  }

  public func stop() {
    generation = UUID()
    timer?.cancel()
    timer = nil
    refresh = nil
    inFlight = false
    queued = false
    needed = false
  }

  public func setForeground(_ value: Bool) {
    guard foreground != value else { return }
    foreground = value
    if value, needed {
      needed = false
      requestRefresh()
    }
  }

  public func setHealthy(_ value: Bool) {
    guard healthy != value else { return }
    let recovered = value && hadHealthy
    healthy = value
    hadHealthy = hadHealthy || value
    if !inFlight {
      schedule()
    }
    if recovered, refreshOnRecovery {
      requestRefresh()
    }
  }

  /// ID envelopes, continuity loss, and network recovery use the same gate.
  public func requestRefresh() {
    guard let refresh else { return }
    guard foreground else {
      needed = true
      return
    }
    guard !inFlight else {
      queued = true
      return
    }
    timer?.cancel()
    timer = nil
    inFlight = true
    let current = generation
    Task { [weak self] in
      guard self?.generation == current else { return }
      await refresh()
      guard let self, generation == current else { return }
      inFlight = false
      if queued {
        queued = false
        requestRefresh()
      } else {
        schedule()
      }
    }
  }

  private func schedule() {
    timer?.cancel()
    guard refresh != nil else { return }
    let current = generation
    let interval: Duration = healthy ? .seconds(60) : fallbackInterval
    timer = Task { [weak self, sleep] in
      guard !Task.isCancelled else { return }
      do {
        try await sleep(interval)
      } catch { return }
      guard !Task.isCancelled, let self, generation == current else { return }
      timer = nil
      requestRefresh()
    }
  }
}
