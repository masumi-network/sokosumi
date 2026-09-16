import Combine
import Foundation

@MainActor
public final class DirectRecipientPicker: ObservableObject {
  @Published public private(set) var roster = DirectRecipientRoster(targets: [])
  @Published public private(set) var selection: DirectConversationSelection
  @Published public var query = ""
  @Published public private(set) var loading = false
  @Published public private(set) var creating = false
  @Published public private(set) var errorMessage: String?
  @Published public private(set) var creationError: String?
  private var generation = 0

  public init(hasOrganization: Bool) {
    selection = DirectConversationSelection(hasOrganization: hasOrganization)
  }

  public var candidates: [DirectRecipientTarget] {
    roster.candidates(query: query, selection: selection)
  }

  public var selectedTargets: [DirectRecipientTarget] {
    selection.recipients.compactMap { id in roster.targets.first { $0.id == id } }
  }

  public func add(_ target: DirectRecipientTarget) {
    guard !creating, !loading, roster.targets.contains(target), selection.disabledReason(for: target.id) == nil else { return }
    selection.add(target.id)
    query = ""
    creationError = nil
  }

  public func remove(_ id: DirectRecipient) {
    guard !creating else { return }
    selection.remove(id)
    creationError = nil
  }

  public func load(using fetch: () async throws -> DirectRecipientRoster) async {
    guard !creating else { return }
    generation += 1
    let current = generation
    loading = true
    errorMessage = nil
    defer {
      if current == generation {
        loading = false
      }
    }
    do {
      let result = try await fetch()
      guard current == generation, !Task.isCancelled else { return }
      roster = result
      for id in selection.recipients where !result.targets.contains(where: { $0.id == id }) {
        selection.remove(id)
      }
    } catch {
      guard current == generation, !Task.isCancelled, !(error is CancellationError) else { return }
      errorMessage = Self.message(for: error)
    }
  }

  public func create(using open: (DirectConversationSelection) async throws -> Bool) async -> Bool {
    guard !creating, !loading, errorMessage == nil, !selectedTargets.isEmpty else { return false }
    creating = true
    creationError = nil
    defer { creating = false }
    do {
      let opened = try await open(selection)
      if !opened, !Task.isCancelled {
        creationError = "Couldn’t open this Direct. Try again."
      }
      return opened
    } catch {
      if !(error is CancellationError), !Task.isCancelled {
        creationError = Self.message(for: error)
      }
      return false
    }
  }

  private static func message(for error: Error) -> String {
    switch error {
    case let ChatServiceError.unauthorized(message), let ChatServiceError.unprocessable(_, message),
         let ChatServiceError.unexpectedResponse(message): message
    default: friendlyMessage(for: error)
    }
  }
}
