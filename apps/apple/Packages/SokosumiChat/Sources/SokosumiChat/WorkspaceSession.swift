import Combine
import CoreAPI
import Foundation

/// Portable workspace identity, access gate and selection lifecycle.
@MainActor
public final class WorkspaceSession: ObservableObject {
  public struct Option: Identifiable, Hashable, Sendable {
    /// Organization id, or `personal`: scopes saved rooms and drafts.
    public var id: String
    public var title: String
    public var workspace: WorkspaceSelection
    /// Core's workspace id, sent when this option becomes the preference.
    public var workspaceId: String
  }

  public enum Phase: Equatable {
    case idle
    case loading
    case blocked(gate: WorkspaceGate)
    case ready
    case failed(message: String)
    /// Core turned this build away (ADR 0053).
    case updateRequired
  }

  @Published public private(set) var phase: Phase = .idle
  @Published public private(set) var options: [Option] = []
  @Published public private(set) var selectionId: String?
  @Published public private(set) var currentUser: Components.Schemas.User?
  @Published public private(set) var errorMessage: String?
  @Published public private(set) var isSwitching = false
  private var generation = 0
  private var switchTask: Task<[Components.Schemas.ChatRoom], Error>?
  private var revokedDuringSwitch: Set<String> = []
  private let service = ChatService()

  public init() {}

  public var selection: Option? {
    options.first { $0.id == selectionId }
  }

  public func reset() {
    generation += 1
    switchTask?.cancel()
    switchTask = nil
    revokedDuringSwitch = []
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
      let rooms = try await service.listRooms(client: client, organizationSlug: initial.defaultSelection.workspace.organizationSlug)
      guard attempt == generation, !Task.isCancelled else { return nil }
      currentUser = initial.currentUser
      options = initial.options
      selectionId = initial.defaultSelection.id
      phase = .ready
      return rooms
    } catch {
      guard attempt == generation, !Task.isCancelled else { return nil }
      if case let ChatServiceError.blocked(gate) = error {
        phase = .blocked(gate: gate)
      } else if updateRequired(in: error) != nil {
        phase = .updateRequired
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
    revokedDuringSwitch = []
    let attempt = generation
    defer {
      if attempt == generation {
        isSwitching = false
        switchTask = nil
        revokedDuringSwitch = []
      }
    }
    do {
      let previous = selection
      let task = Task { try await service.switchWorkspace(client: client, to: option, previous: previous) }
      switchTask = task
      let rooms = try await withTaskCancellationHandler {
        try await task.value
      } onCancel: {
        task.cancel()
      }
      guard attempt == generation, !Task.isCancelled else { return nil }
      selectionId = option.id
      errorMessage = nil
      return rooms.filter { !revokedDuringSwitch.contains($0.id) }
    } catch {
      guard attempt == generation, !Task.isCancelled else { return nil }
      errorMessage = friendlyMessage(for: error)
      throw error
    }
  }

  /// User-control events can revoke destination rooms while their list is
  /// loading. A snapshot started before that event must not restore them.
  public func applyMembershipRevoked(roomId: String) {
    if isSwitching {
      revokedDuringSwitch.insert(roomId)
    }
  }
}

extension WorkspaceSession.Option {
  /// Nil for an organization row without its id or slug.
  init?(_ workspace: Components.Schemas.UserWorkspace) {
    switch workspace.kind {
    case .personal:
      self.init(id: "personal", title: "Personal", workspace: .personal, workspaceId: workspace.id)
    case .organization:
      guard let organizationId = workspace.organizationId, let slug = workspace.slug else { return nil }
      self.init(
        id: organizationId,
        title: workspace.name,
        workspace: .organization(id: organizationId, slug: slug),
        workspaceId: workspace.id
      )
    }
  }
}
