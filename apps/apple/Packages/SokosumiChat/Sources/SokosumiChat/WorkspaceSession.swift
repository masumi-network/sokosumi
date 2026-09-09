import Combine
import CoreAPI
import Foundation

/// Portable workspace identity, access gate and selection lifecycle.
@MainActor
public final class WorkspaceSession: ObservableObject {
  public struct Option: Identifiable, Hashable {
    public var id: String
    public var title: String
    public var workspace: WorkspaceSelection
  }

  public enum Phase: Equatable {
    case idle
    case loading
    case blocked(gate: Components.Schemas.WorkspaceGateStatus)
    case ready
    case failed(message: String)
  }

  @Published public private(set) var phase: Phase = .idle
  @Published public private(set) var options: [Option] = []
  @Published public private(set) var selectionId: String?
  @Published public private(set) var currentUser: Components.Schemas.User?
  @Published public private(set) var errorMessage: String?
  @Published public private(set) var isSwitching = false
  private var generation = 0
  private var switchTask: Task<[Components.Schemas.ChatRoom], Error>?
  private let service = ChatService()

  public init() {}

  public var selection: Option? {
    options.first { $0.id == selectionId }
  }

  public func reset() {
    generation += 1
    switchTask?.cancel()
    switchTask = nil
    phase = .idle
    options = []
    selectionId = nil
    currentUser = nil
    errorMessage = nil
    isSwitching = false
  }

  /// A stale completion returns nil and cannot restore a previous account.
  public func load(client: Client) async throws -> [Components.Schemas.ChatRoom]? {
    reset()
    phase = .loading
    let attempt = generation
    do {
      let initial = try await service.loadInitialState(client: client)
      guard attempt == generation, !Task.isCancelled else { return nil }
      let rooms = try await service.listRooms(client: client, organizationSlug: initial.defaultSelection.organizationSlug)
      guard attempt == generation, !Task.isCancelled else { return nil }
      currentUser = initial.currentUser
      options = initial.organizations.map {
        Option(id: $0.id, title: $0.name, workspace: .organization(id: $0.id, slug: $0.slug))
      }
      if initial.access.hasPersonalWorkspace {
        options.insert(Option(id: "personal", title: "Personal", workspace: .personal), at: 0)
      }
      selectionId = options.first { $0.workspace == initial.defaultSelection }?.id
      phase = .ready
      return rooms
    } catch {
      guard attempt == generation, !Task.isCancelled else { return nil }
      if case let ChatServiceError.blocked(gate) = error {
        phase = .blocked(gate: gate)
      } else {
        phase = .failed(message: friendlyMessage(for: error))
      }
      throw error
    }
  }

  /// The old selection remains usable when a switch fails.
  public func select(_ option: Option, client: Client) async throws -> [Components.Schemas.ChatRoom]? {
    guard phase == .ready, !isSwitching, options.contains(option), option.id != selectionId else { return nil }
    isSwitching = true
    let attempt = generation
    defer {
      if attempt == generation {
        isSwitching = false
        switchTask = nil
      }
    }
    do {
      let previous = selection?.workspace
      let task = Task { try await service.switchWorkspace(client: client, selection: option.workspace, previous: previous) }
      switchTask = task
      let rooms = try await withTaskCancellationHandler {
        try await task.value
      } onCancel: {
        task.cancel()
      }
      guard attempt == generation, !Task.isCancelled else { return nil }
      selectionId = option.id
      errorMessage = nil
      return rooms
    } catch {
      guard attempt == generation, !Task.isCancelled else { return nil }
      errorMessage = friendlyMessage(for: error)
      throw error
    }
  }
}
