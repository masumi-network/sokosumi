import Foundation

/// The socket a gated channel authorizes against: its state, its reconnects and a fresh token. `ARTRealtime` in the
/// app, a fake in tests.
protocol GatedChannelHost: AnyObject {
  /// False while the connection closes or has failed: no token can be minted.
  var canAuthorize: Bool { get }
  /// Calls `handler` on every `connected` transition; returns the listener `removeListener` takes.
  func onConnected(_ handler: @escaping @Sendable () -> Void) -> AnyObject?
  func removeListener(_ listener: AnyObject)
  /// Mints a token: its capability JSON, or `failed` when the mint failed.
  func authorize(_ completion: @escaping @Sendable (_ capability: String?, _ failed: Bool) -> Void)
}

/// What one gated channel does with its grant. Called on the engine's queue only.
protocol GatedChannelPolicy: AnyObject, Sendable {
  associatedtype Grant: Equatable & Sendable
  /// The grant `capability` gives on `target`'s channel; nil when it gives none.
  func grant(in capability: String?, target: String) -> Grant?
  /// A fresh token grants `target`'s channel: attach it, or keep it after a reconnect.
  func attach(_ target: String, grant: Grant)
  /// The token does not grant `target`'s channel, or its mint failed: the channel is off.
  func denied(_ target: String)
  /// Leave the channel: another target, or `stop`.
  func detach()
}

/// One target's channel (a room, an organization) under one token at a time. A request made while an authorization
/// is in flight is queued and runs when that one settles, and an answer from before the target changed is stale.
struct GatedScope<Grant: Equatable> {
  enum Outcome: Equatable {
    case stale
    case granted(target: String, grant: Grant)
    /// The token lacks the grant, or its mint failed; `failed` says which.
    case denied(target: String, failed: Bool)
  }

  private(set) var target: String?
  private(set) var grant: Grant?
  private var turn = AuthorizationTurn()
  private let read: (String?, String) -> Grant?

  /// `read` is the channel's grant: what a token's capability gives on a target's channel.
  init(read: @escaping (_ capability: String?, _ target: String) -> Grant?) {
    self.read = read
  }

  mutating func setTarget(_ target: String?) {
    self.target = target
    grant = nil
    turn.reset()
  }

  /// Nil without a target, or while another authorization is in flight (the request is queued).
  mutating func requestAuthorization() -> UUID? {
    guard target != nil else { return nil }
    return turn.begin()
  }

  mutating func finishAuthorization(_ id: UUID, capability: String?, failed: Bool) -> Outcome {
    guard let target, turn.finish(id) else { return .stale }
    grant = failed ? nil : read(capability, target)
    return grant.map { .granted(target: target, grant: $0) } ?? .denied(target: target, failed: failed)
  }

  /// True once when a request arrived during authorization.
  mutating func takeQueued() -> Bool {
    turn.takeQueued()
  }
}

/// One capability-gated channel over one socket lifetime (ADR 0003, ADR 0033). The channel is attached only after a
/// fresh token grants it, and every `connected` transition authorizes again, because a grant is a snapshot of
/// membership at mint time. Token renewal reports `update` while still connected and authorizes nothing, or each
/// renewal would mint another. A failed mint retries after `retryDelay`; a missing grant stays off until the next
/// connection.
final class GatedChannel<Policy: GatedChannelPolicy>: @unchecked Sendable {
  static var retryDelay: Duration {
    .seconds(15)
  }

  let queue: DispatchQueue
  private let host: any GatedChannelHost
  private let policy: Policy
  private let sleep: @Sendable (Duration) async throws -> Void
  private var scope: GatedScope<Policy.Grant>
  private var active = true
  private var retry: Task<Void, Never>?
  private var connectionListener: AnyObject?

  init(queue: DispatchQueue, host: any GatedChannelHost, policy: Policy,
       sleep: @escaping @Sendable (Duration) async throws -> Void) {
    self.queue = queue
    self.host = host
    self.policy = policy
    self.sleep = sleep
    scope = GatedScope { [policy] capability, target in policy.grant(in: capability, target: target) }
    connectionListener = host.onConnected { [weak self] in
      self?.queue.async { [weak self] in
        guard let self, active, scope.target != nil else { return }
        synchronize()
      }
    }
  }

  /// Authorizes `target`'s channel (nil: none), leaving the previous one first.
  func setTarget(_ target: String?) {
    queue.async { [self] in
      guard active, scope.target != target else { return }
      policy.detach()
      retry?.cancel()
      retry = nil
      scope.setTarget(target)
      if target != nil {
        synchronize()
      }
    }
  }

  /// Runs `body` on the queue with the target and its grant, while the channel is granted.
  func withGrant(_ body: @escaping @Sendable (_ target: String, _ grant: Policy.Grant) -> Void) {
    queue.async { [self] in
      guard active, let target = scope.target, let grant = scope.grant else { return }
      body(target, grant)
    }
  }

  /// Synchronous, so a socket closes only after the detach is issued.
  func stop() {
    queue.sync { [self] in
      active = false
      retry?.cancel()
      retry = nil
      if let connectionListener {
        host.removeListener(connectionListener)
      }
      connectionListener = nil
      policy.detach()
      scope.setTarget(nil)
    }
  }

  private func synchronize() {
    guard active, host.canAuthorize else { return }
    retry?.cancel()
    retry = nil
    guard let id = scope.requestAuthorization() else { return }
    host.authorize { [weak self] capability, failed in
      self?.queue.async { [weak self] in
        self?.settle(id, capability: capability, failed: failed)
      }
    }
  }

  private func settle(_ id: UUID, capability: String?, failed: Bool) {
    guard active else { return }
    switch scope.finishAuthorization(id, capability: capability, failed: failed) {
    case .stale:
      return
    case let .granted(target, grant):
      policy.attach(target, grant: grant)
    case let .denied(target, failed):
      policy.denied(target)
      if failed {
        retry = Task { [weak self, sleep] in
          do { try await sleep(Self.retryDelay) } catch { return }
          guard !Task.isCancelled else { return }
          self?.queue.async { [weak self] in self?.synchronize() }
        }
      }
    }
    if scope.takeQueued() {
      synchronize()
    }
  }
}
