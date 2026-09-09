import Combine
import CoreAPI
import Foundation

/// A room's in-memory classic sends. A timeout frees the queue but retains
/// the same client message ID for retry, since Core may have accepted it.
@MainActor
public final class RoomOutbox: ObservableObject {
  public typealias Message = Components.Schemas.ChatRoomMessage
  private struct Job {
    let send: () async throws -> Message
    let confirmed: (Message) -> Void
    let failed: (Error) -> Void
  }

  @Published public private(set) var shells: [OutboundShell] = []
  @Published private var active: UUID?
  public var isSending: Bool {
    active != nil
  }

  private var jobs: [String: Job] = [:]
  private var queue: [String] = []
  private var request: Task<Void, Never>?
  private var timer: Task<Void, Never>?
  private let timeout: Duration

  public init(timeout: Duration = .seconds(30)) {
    self.timeout = timeout
  }

  public func enqueue(
    _ shell: OutboundShell,
    send: @escaping () async throws -> Message,
    confirmed: @escaping (Message) -> Void,
    failed: @escaping (Error) -> Void
  ) {
    guard jobs[shell.clientTurnId] == nil else { return }
    shells.append(shell)
    jobs[shell.clientTurnId] = Job(send: send, confirmed: confirmed, failed: failed)
    queue.append(shell.clientTurnId)
    startNext()
  }

  public func retry(_ id: String) {
    guard jobs[id] != nil, shells.contains(where: { $0.clientTurnId == id && $0.status == .failed }) else { return }
    shells = markOutboundPending(shells: shells, clientTurnId: id)
    queue.append(id)
    startNext()
  }

  public func remove(_ id: String) {
    guard shells.contains(where: { $0.clientTurnId == id && $0.status == .failed }) else { return }
    shells = removeOutbound(shells: shells, clientTurnId: id)
    jobs[id] = nil
  }

  /// Realtime confirmation can remove a shell before its HTTP result arrives.
  public func reconcile(_ remaining: [OutboundShell]) {
    shells = remaining
  }

  public func reset() {
    active = nil
    // Leave `request` running. Web releases the local queue without aborting
    // the POST; Core may already have the row. Isolation is `active` / `jobs`.
    timer?.cancel()
    request = nil
    timer = nil
    queue = []
    jobs = [:]
    shells = []
  }

  private func startNext() {
    guard active == nil else { return }
    while !queue.isEmpty {
      let id = queue.removeFirst()
      guard let job = jobs[id], shells.contains(where: { $0.clientTurnId == id }) else {
        jobs[id] = nil
        continue
      }
      let attempt = UUID()
      active = attempt
      request = Task { [weak self] in
        let result: Result<Message, Error>
        do {
          result = try await .success(job.send())
        } catch {
          result = .failure(error)
        }
        self?.settle(id, attempt: attempt, result: result)
      }
      timer = Task { [weak self, timeout] in
        do {
          try await Task.sleep(for: timeout)
        } catch { return }
        self?.settle(id, attempt: attempt, result: .failure(SendTimeout()))
      }
      return
    }
  }

  private func settle(_ id: String, attempt: UUID, result: Result<Message, Error>) {
    guard active == attempt, let job = jobs[id] else { return }
    active = nil
    timer?.cancel()
    timer = nil
    // Do not cancel `request`. Timeout frees the queue; the POST may still land.
    request = nil
    if shells.contains(where: { $0.clientTurnId == id }) {
      switch result {
      case let .success(message):
        shells.removeAll { $0.clientTurnId == id }
        jobs[id] = nil
        job.confirmed(message)
      case let .failure(error):
        shells = failOutbound(
          shells: shells,
          clientTurnId: id,
          errorMessage: (error as? SendTimeout)?.errorDescription ?? friendlyMessage(for: error)
        )
        job.failed(error)
      }
    } else {
      jobs[id] = nil
    }
    startNext()
  }
}

private struct SendTimeout: LocalizedError {
  var errorDescription: String? {
    "Sending timed out. Retry to check or send this message again."
  }
}
